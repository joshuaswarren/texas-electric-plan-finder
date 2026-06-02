import * as pdfjsLib from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url'
import type { CustomEflPlan, EvChargingPlan, PowerToChoosePlan, TouPeriod, UsageCredit } from './types'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

const eflProxyBase = 'https://texas-electric-plan-finder-ptc.joshua-s-warren.workers.dev'
const eflFetchTimeoutMs = 20_000

function normalizeText(text: string): string {
  return text
    .replace(/\ue000/g, 'B')
    .replace(/\ue001/g, 'E')
    .replace(/\ue002/g, 'S')
    .replace(/\ue003/g, 'b')
    .replace(/\ue004/g, 's')
    .replace(/\ue005/g, 'w')
    .replace(/\ue006/g, 'y')
    .replace(/\u00a0/g, ' ')
    .replace(/[¢￠]/g, ' cents ')
    .replace(/\s+/g, ' ')
    .trim()
}

function firstNumber(patterns: RegExp[], text: string): number | undefined {
  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match?.[1]) {
      const value = Number(match[1].replace(/,/g, ''))
      if (Number.isFinite(value)) {
        return value
      }
    }
  }
  return undefined
}

function firstCentsPerKwh(
  text: string,
  centsPatterns: RegExp[],
  dollarPatterns: RegExp[],
): number | undefined {
  const cents = firstNumber(centsPatterns, text)
  if (cents !== undefined) {
    return cents
  }

  const dollars = firstNumber(dollarPatterns, text)
  if (dollars !== undefined) {
    return dollars * 100
  }

  return undefined
}

function dollarsPerKwhToCents(value: number): number {
  return value < 1 ? value * 100 : value
}

function normalizeUrl(value: string): string | undefined {
  const clean = value.replace(/\s+/g, '').replace(/[),.;]+$/g, '')
  const withProtocol = clean.startsWith('www.') ? `https://${clean}` : clean

  try {
    return new URL(withProtocol).toString()
  } catch {
    return undefined
  }
}

function tduAliases(tduName?: string): string[] {
  const normalized = (tduName ?? '').toLowerCase()
  if (normalized.includes('oncor')) return ['oncor']
  if (normalized.includes('centerpoint')) return ['centerpoint', 'center point']
  if (normalized.includes('aep texas north') || normalized.includes('aep north')) return ['aep north']
  if (normalized.includes('aep texas central') || normalized.includes('aep central')) return ['aep central']
  if (normalized.includes('tnmp') || normalized.includes('texas-new mexico')) return ['tnmp']
  if (normalized.includes('lubbock') || normalized.includes('lp&l') || normalized.includes('lp;l')) return ['lubbock', 'lp&l', 'lp&amp;l', 'lp l']
  return []
}

function extractTduDetailUrls(text: string): string[] {
  const urls = new Set<string>()
  const urlPattern = /\b(?:https?:\/\/|www\.)[^\s<>"']+(?:\s+[A-Za-z0-9/_-]*(?:tdu|tdsp)[A-Za-z0-9/_-]*)?/gi
  const bareDomainPattern = /\b[a-z0-9.-]+\.(?:com|net|org)\/\s*[A-Za-z0-9/_-]*(?:tdu|tdsp)[A-Za-z0-9/_-]*/gi

  for (const match of [...text.matchAll(urlPattern), ...text.matchAll(bareDomainPattern)]) {
    const normalized = normalizeUrl(match[0])
    if (!normalized) continue
    if (/(?:tdu|tdsp|delivery|transmission|charges?)/i.test(normalized)) {
      urls.add(normalized)
    }
  }

  return [...urls]
}

function parseTduChargeFromKnownColumnTable(text: string, aliases: string[]): { fixedDollars: number; centsPerKwh: number } | undefined {
  const tablePatterns = [
    {
      names: ['centerpoint', 'oncor', 'aep north', 'aep central', 'tnmp', 'lubbock'],
      pattern:
        /Center\s*point\s+Oncor\s+AEP\s+North\s+AEP\s+Central\s+TNMP\s+(?:LP(?:&|&amp;)?L|Lubbock).*?\$?\s*(\d+(?:\.\d{1,2})?)\s+\$?\s*(\d+(?:\.\d{1,2})?)\s+\$?\s*(\d+(?:\.\d{1,2})?)\s+\$?\s*(\d+(?:\.\d{1,2})?)\s+\$?\s*(\d+(?:\.\d{1,2})?)\s+\$?\s*(\d+(?:\.\d{1,2})?).*?\$?\s*(0?\.\d{4,6})\/kwh\s+\$?\s*(0?\.\d{4,6})\/kwh\s+\$?\s*(0?\.\d{4,6})\/kwh\s+\$?\s*(0?\.\d{4,6})\/kwh\s+\$?\s*(0?\.\d{4,6})\/kwh\s+\$?\s*(0?\.\d{4,6})\/kwh/i,
    },
    {
      names: ['centerpoint', 'oncor', 'aep central', 'aep north', 'tnmp', 'lubbock'],
      pattern:
        /TDSP\s+Delivery\s+Charges\s+CenterPoint\s+ONCOR\s+AEP\s+TX\s+Central\s+AEP\s+TX\s+North\s+TNMP\s+(?:LP(?:&|&amp;)?L|Lubbock).*?Total\s+Per\s+Month\s+Charges:\s+\$?\s*(\d+(?:\.\d{1,2})?)\s+\$?\s*(\d+(?:\.\d{1,2})?)\s+\$?\s*(\d+(?:\.\d{1,2})?)\s+\$?\s*(\d+(?:\.\d{1,2})?)\s+\$?\s*(\d+(?:\.\d{1,2})?)\s+\$?\s*(\d+(?:\.\d{1,2})?).*?Total\s+Per\s+kWh\s+Charges:\s+\$?\s*(0?\.\d{4,6})\s+\$?\s*(0?\.\d{4,6})\s+\$?\s*(0?\.\d{4,6})\s+\$?\s*(0?\.\d{4,6})\s+\$?\s*(0?\.\d{4,6})\s+\$?\s*(0?\.\d{4,6})/i,
    },
  ]

  for (const table of tablePatterns) {
    const match = text.match(table.pattern)
    if (!match) continue

    const index = table.names.findIndex((name) => aliases.includes(name))
    if (index < 0) continue

    const fixed = Number(match[1 + index])
    const rate = Number(match[7 + index])
    if (!Number.isFinite(fixed) || !Number.isFinite(rate)) continue

    return {
      fixedDollars: fixed,
      centsPerKwh: dollarsPerKwhToCents(rate),
    }
  }

  return undefined
}

function parseTduChargesFromText(tduName: string | undefined, text: string): { fixedDollars: number; centsPerKwh: number } | undefined {
  const normalized = normalizeText(text)
  const aliases = tduAliases(tduName)
  if (!aliases.length) return undefined

  const columnTableCharges = parseTduChargeFromKnownColumnTable(normalized, aliases)
  if (columnTableCharges) return columnTableCharges

  for (const alias of aliases) {
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const rowPatterns = [
      new RegExp(`${escaped}.{0,80}?\\$\\s*(\\d+(?:\\.\\d{1,2})?).{0,80}?(\\d+(?:\\.\\d{1,6})?)\\s*cents?(?:\\s*(?:per|\\/)\\s*kwh)?`, 'i'),
      new RegExp(`${escaped}.{0,80}?\\$\\s*(\\d+(?:\\.\\d{1,2})?).{0,80}?\\$\\s*(0?\\.\\d{4,6})\\s*(?:per|\\/)\\s*kwh`, 'i'),
      new RegExp(`${escaped}.{0,80}?\\$\\s*(\\d+(?:\\.\\d{1,2})?)\\s+\\$\\s*(0?\\.\\d{4,6})\\s*(?:per|\\/)\\s*kwh`, 'i'),
    ]

    for (const pattern of rowPatterns) {
      const match = normalized.match(pattern)
      if (!match) continue

      const fixed = Number(match[1])
      const rate = Number(match[2])
      if (Number.isFinite(fixed) && Number.isFinite(rate)) {
        return {
          fixedDollars: fixed,
          centsPerKwh: dollarsPerKwhToCents(rate),
        }
      }
    }
  }

  return undefined
}

function extractCompactChargeDetails(text: string): {
  baseChargeDollars?: number
  energyChargeCentsPerKwh?: number
} {
  const chargeDetails = text.match(
    /charge\s+details\s+base\s+charge\s+per\s+kwh\s+charge.{0,120}?\$\s*(\d+(?:\.\d{1,2})?)\s+(\d+(?:\.\d{1,6})?)\s*cents/i,
  )
  if (chargeDetails) {
    return {
      baseChargeDollars: Number(chargeDetails[1]),
      energyChargeCentsPerKwh: Number(chargeDetails[2]),
    }
  }

  const championChargeDetails = text.match(
    /energy\s+charge\s*\(per\s+kwh\)\s+base\s+charge\s+(\d+(?:\.\d{1,6})?)\s*cents\s*\/\s*kwh\s+\$\s*(\d+(?:\.\d{1,2})?)/i,
  )
  if (championChargeDetails) {
    return {
      energyChargeCentsPerKwh: Number(championChargeDetails[1]),
      baseChargeDollars: Number(championChargeDetails[2]),
    }
  }

  const unbundledRow = text.match(
    /(?:[A-Z]{3,}|ONCOR)(?:\s+(?:[A-Z]{3,}|ONCOR)){0,2}\s+(0?\.\d{4,6})\s+(\d+(?:\.\d{1,2})?)\s+(?:\d+\s+Months?|1\s+Month)/i,
  )
  if (unbundledRow) {
    return {
      energyChargeCentsPerKwh: dollarsPerKwhToCents(Number(unbundledRow[1])),
      baseChargeDollars: Number(unbundledRow[2]),
    }
  }

  return {}
}

function parseClockTime(hourText: string, ampmText: string): string {
  const [rawHour, rawMinute] = hourText.split(':')
  let hour = Number(rawHour)
  const minute = Number(rawMinute ?? 0)
  const ampm = ampmText.toLowerCase()

  if (ampm === 'pm' && hour !== 12) {
    hour += 12
  }
  if (ampm === 'am' && hour === 12) {
    hour = 0
  }

  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

function extractEligibleVehicleChargingPlan(text: string): EvChargingPlan | undefined {
  if (!/eligible\s+vehicle\s+charging|home\s+charging\s+fee|unlimited\s+vehicle\s+charging/i.test(text)) {
    return undefined
  }

  const monthlyFeeDollarsPerVehicle = firstNumber(
    [
      /home\s+charging\s+fee\s*:?\s*\$\s*(\d+(?:\.\d{1,2})?)\s*(?:\/|per)\s*month\s*(?:\/|per)\s*tesla\s+ev/i,
      /home\s+charging\s+fee\s*:?\s*\$\s*(\d+(?:\.\d{1,2})?)\s*(?:\/|per)\s*month/i,
    ],
    text,
  )
  if (monthlyFeeDollarsPerVehicle === undefined) {
    return undefined
  }

  const windowMatch = text.match(
    /eligible\s+hours\s+for\s+unlimited\s+vehicle\s+charging\s*:?\s*(\d{1,2}(?::\d{2})?)\s*(?:am|a\.m\.)\s*(?:\([^)]*\))?\s*[-–]\s*(\d{1,2}(?::\d{2})?)\s*(?:pm|p\.m\.)/i,
  )
  const eligiblePeriods = windowMatch
    ? [
        {
          label: 'Eligible Tesla vehicle charging',
          start: parseClockTime(windowMatch[1], 'am'),
          end: parseClockTime(windowMatch[2], 'pm'),
          days: 'all' as const,
        },
      ]
    : [
        {
          label: 'Eligible Tesla vehicle charging',
          start: '00:00',
          end: '12:00',
          days: 'all' as const,
        },
      ]

  const assumedMonthlyKwh = firstNumber(
    [/assumes\s+one\s+\(?1\)?\s+eligible\s+vehicle\s+that\s+consumes\s+(\d+(?:\.\d{1,2})?)\s*kwh\s+per\s+month/i],
    text,
  )

  return {
    monthlyFeeDollarsPerVehicle,
    eligiblePeriods,
    assumedMonthlyKwh,
    requiredDevice: 'Tesla EV',
  }
}

function findLabeledRate(text: string, labels: string[]): number | undefined {
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const patterns = [
      new RegExp(
        `${escaped}\\s*(?:energy\\s*)?charge\\s*:?\\s*(?:of\\s*)?(\\d+(?:\\.\\d{1,6})?)\\s*(?:cents?|¢)(?:\\s*cents?)?\\s*(?:per|\\/)\\s*kwh`,
        'i',
      ),
      new RegExp(
        `energy\\s*${escaped}\\s*charge\\s*:?\\s*(?:of\\s*)?(\\d+(?:\\.\\d{1,6})?)\\s*(?:cents?|¢)(?:\\s*cents?)?\\s*(?:per|\\/)\\s*kwh`,
        'i',
      ),
      new RegExp(
        `energy\\s+charge\\s*\\(\\s*${escaped}\\s*\\)\\s*(\\d+(?:\\.\\d{1,6})?)\\s*(?:cents?|¢)`,
        'i',
      ),
    ]
    const value = firstNumber(patterns, text)
    if (value !== undefined) {
      return value
    }
  }

  return undefined
}

function findLabeledTimeRange(text: string, labels: string[]): { start: string; end: string } | undefined {
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const pattern = new RegExp(
      `${escaped}.{0,80}?from\\s+(\\d{1,2}(?::\\d{2})?)\\s*(am|pm)\\s+to\\s+(\\d{1,2}(?::\\d{2})?)\\s*(am|pm)`,
      'i',
    )
    const match = text.match(pattern)
    if (match) {
      return {
        start: parseClockTime(match[1], match[2]),
        end: parseClockTime(match[3], match[4]),
      }
    }
  }

  return undefined
}

function extractTouPeriods(text: string): TouPeriod[] {
  const pairs = [
    { label: 'Daytime', labels: ['daytime', 'day'] },
    { label: 'Nighttime', labels: ['nighttime', 'night'] },
    { label: 'On-peak', labels: ['on-peak', 'on peak', 'peak'] },
    { label: 'Off-peak', labels: ['off-peak', 'off peak'] },
  ]
  const periods: TouPeriod[] = []

  for (const pair of pairs) {
    const rate = findLabeledRate(text, pair.labels)
    const range = findLabeledTimeRange(text, pair.labels)
    if (rate !== undefined && range) {
      periods.push({
        label: pair.label,
        energyChargeCentsPerKwh: rate,
        start: range.start,
        end: range.end,
        days: 'all',
      })
    }
  }

  return periods
}

function extractUsageCredits(text: string): UsageCredit[] {
  const credits: UsageCredit[] = []
  const patterns = [
    /\$(\d+(?:\.\d{1,2})?).{0,90}?(?:usage|use).{0,70}?(?:at least|above or equal to|greater than or equal to|>=|reaches)\s*(\d{3,5})\s*kwh/gi,
    /(?:usage|bill)\s+credit.{0,80}?\$(\d+(?:\.\d{1,2})?).{0,100}?(\d{3,5})\s*kwh/gi,
    /(?:credit|discount).{0,80}?\$(\d+(?:\.\d{1,2})?).{0,120}?(?:equal\s+or\s+greater\s+than|at\s+least|greater\s+than\s+or\s+equal\s+to|>=)\s*(\d{3,5})\s*kwh/gi,
  ]

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const amount = Number(match[1])
      const threshold = Number(match[2].replace(/,/g, ''))
      if (Number.isFinite(amount) && Number.isFinite(threshold)) {
        const duplicate = credits.some(
          (credit) => credit.amountDollars === amount && credit.thresholdKwh === threshold,
        )
        if (!duplicate) {
          credits.push({ amountDollars: amount, thresholdKwh: threshold })
        }
      }
    }
  }

  return credits
}

function parseEflText(plan: PowerToChoosePlan, text: string): { plan?: CustomEflPlan; notes: string[] } {
  const normalized = normalizeText(text)
  const notes: string[] = []
  const compactChargeDetails = extractCompactChargeDetails(normalized)
  const baseChargeDollars = compactChargeDetails.baseChargeDollars ?? firstNumber(
    [
      /base\s+charge\s*:?\s*\$?\s*(\d+(?:\.\d{1,2})?)\s*(?:\$?\s*)?(?:per billing cycle|per bill month|\/\s*month|per month)/i,
      /base\s+charge\s*\(\s*\$\s*\)\s*(?:per|\/)\s*month\s*:?\s*\$?\s*(\d+(?:\.\d{1,2})?)/i,
      /base\s+charge\s*\(\s*\$\s*(?:per|\/)\s*month\s*\)\s*\$?\s*(\d+(?:\.\d{1,2})?)/i,
      /base\s+usage\s+charge\s*:?\s*\$?\s*(\d+(?:\.\d{1,2})?)\s*(?:per billing cycle|per bill month|\/\s*month|per month)/i,
      /monthly\s+base\s+charge.{0,40}?\$?\s*(\d+(?:\.\d{1,2})?)/i,
      /customer\s+charge\s*:?\s*\$?\s*(\d+(?:\.\d{1,2})?)\s*(?:\$?\s*)?(?:per billing cycle|per bill month|\/\s*month|per month)/i,
    ],
    normalized,
  )
  const energyChargeCentsPerKwh = compactChargeDetails.energyChargeCentsPerKwh ?? firstCentsPerKwh(
    normalized,
    [
      /(?:fixed\s+)?energy\s+charge(?:s)?\s*:?\s*(?:of\s*)?(\d+(?:\.\d{1,6})?)\s*(?:cents?|¢)(?:\s*cents?)?\s*(?:per|\/)\s*kwh/i,
      /energy\s+rate\s*\(\s*cents?\s*\)\s*(?:per|\/)\s*kwh\s*:?\s*(\d+(?:\.\d{1,6})?)\s*cents?/i,
      /usage\s+charge\s*:?\s*(\d+(?:\.\d{1,6})?)\s*cents?\s*(?:per|\/)\s*kwh/i,
      /energy\s+charge\s*:?\s*(?:per|\/)\s*kwh\s*\(\s*cents?\s*\)\s*all\s+kwh\s*(\d+(?:\.\d{1,6})?)\s*cents?/i,
      /(?:fixed\s+)?energy\s+charge(?:s)?\s*\(\s*(?:cents?|¢)\s*(?:\/|per)\s*kwh\s*\)\s*(\d+(?:\.\d{1,6})?)\s*(?:cents?)?/i,
      /(?:retail|rep|smartenergy|provider)\s+fixed\s+charge\s*:?\s*(\d+(?:\.\d{1,6})?)\s*(?:cents?|¢)(?:\s*cents?)?\s*(?:per|\/)\s*kwh/i,
      /fixed\s+charge\s*:?\s*(\d+(?:\.\d{1,6})?)\s*(?:cents?|¢)(?:\s*cents?)?\s*(?:per|\/)\s*kwh/i,
    ],
    [
      /(?:fixed\s+)?energy\s+charge(?:s)?\s*:?\s*(?:of\s*)?\$(\d+(?:\.\d{1,6})?)\s*(?:per|\/)\s*kwh/i,
      /base\s+charge.{0,80}?\$\s*\d+(?:\.\d{1,2})?.{0,80}?charge\s+\$(0?\.\d{4,6})\s*(?:per|\/)\s*kwh\s+tdu\s+deliver/i,
    ],
  )
  const directDeliveryFixedDollars = firstNumber(
    [
      /(?:tdu|tdsp|delivery|distribution|oncor\s+delivery|centerpoint\s+delivery|aep\s+(?:north|central)?\s*delivery|tnmp\s+delivery).{0,140}?\$\s*(\d+(?:\.\d{1,2})?)\s*(?:\$?\s*)?(?:per billing cycle|per bill month|per month|\/\s*month)/i,
      /energy\s+delivery\s+charges\s*:?\s*\d+(?:\.\d{1,6})?\s*cents?\s*(?:per|\/)\s*kwh\s+and\s+\$\s*(\d+(?:\.\d{1,2})?)\s*per\s+month/i,
      /(?:oncor|centerpoint|aep|tnmp).{0,60}?delivery\s+charges\s*:?\s*\$\s*(\d+(?:\.\d{1,2})?)\s*per\s+month\s+and\s+\d+(?:\.\d{1,6})?\s*cents?\s*(?:per|\/)\s*kwh/i,
      /delivery\s+charges\s+from\s+(?:oncor|centerpoint|aep|tnmp).{0,80}?\d+(?:\.\d{1,6})?\s*cents?\s*\/\s*kwh\s+\$\s*(\d+(?:\.\d{1,2})?)/i,
      /(?:oncor|centerpoint|aep|tnmp)\s+delivery\s+charge\s*:?\s*\$\s*(\d+(?:\.\d{1,2})?)\s*per billing cycle/i,
      /(?:pass-through\s+)?tdsp\s+customer\s+charge\s*:?\s*\$\s*(\d+(?:\.\d{1,2})?)\s*(?:per billing cycle|per bill month|per month|\/\s*month)/i,
      /delivery\s+costs?\s*-\s*(?:oncor|centerpoint|aep|tnmp).{0,40}?\$\s*(\d+(?:\.\d{1,2})?)/i,
    ],
    normalized,
  )
  const directDeliveryChargeCentsPerKwh = firstCentsPerKwh(
    normalized,
    [
      /(?:tdu|tdsp|delivery|distribution|oncor\s+delivery|centerpoint\s+delivery|aep\s+(?:north|central)?\s*delivery|tnmp\s+delivery|transmission\s+and\s+distribution).{0,160}?(\d+(?:\.\d{1,6})?)\s*cents?(?:\s*cents?)?\s*(?:per|\/)\s*kwh/i,
      /energy\s+delivery\s+charges\s*:?\s*(\d+(?:\.\d{1,6})?)\s*cents?\s*(?:per|\/)\s*kwh\s+and\s+\$\s*\d+(?:\.\d{1,2})?\s*per\s+month/i,
      /(?:oncor|centerpoint|aep|tnmp).{0,60}?delivery\s+charges\s*:?\s*\$\s*\d+(?:\.\d{1,2})?\s*per\s+month\s+and\s+(\d+(?:\.\d{1,6})?)\s*cents?\s*(?:per|\/)\s*kwh/i,
      /delivery\s+charges\s+from\s+(?:oncor|centerpoint|aep|tnmp).{0,80}?(\d+(?:\.\d{1,6})?)\s*cents?\s*\/\s*kwh\s+\$\s*\d+(?:\.\d{1,2})?/i,
      /(?:oncor|centerpoint|aep|tnmp)\s+delivery\s+charge\s*:?\s*\$\s*\d+(?:\.\d{1,2})?\s*per billing cycle\s+(?:oncor|centerpoint|aep|tnmp)\s+delivery\s+charge\s*:?\s*(\d+(?:\.\d{1,6})?)\s*cents?\s*(?:per|\/)\s*kwh/i,
      /(?:pass-through\s+)?tdsp\s+distribution\s+charge\s*:?\s*(\d+(?:\.\d{1,6})?)\s*cents?(?:\s*cents?)?\s*(?:per|\/)\s*kwh/i,
      /delivery\s+costs?\s*-\s*(?:oncor|centerpoint|aep|tnmp).{0,80}?(\d+(?:\.\d{1,6})?)\s*cents/i,
    ],
    [
      /(?:tdu|tdsp|delivery|distribution|oncor\s+delivery|centerpoint\s+delivery|aep\s+(?:north|central)?\s*delivery|tnmp\s+delivery|transmission\s+and\s+distribution).{0,160}?\$(\d+(?:\.\d{1,6})?)\s*(?:per|\/)\s*kwh/i,
    ],
  )
  const fallbackTduCharges =
    directDeliveryFixedDollars === undefined || directDeliveryChargeCentsPerKwh === undefined
      ? parseTduChargesFromText(plan.company_tdu_name, normalized)
      : undefined
  const deliveryFixedDollars = directDeliveryFixedDollars ?? fallbackTduCharges?.fixedDollars
  const deliveryChargeCentsPerKwh = directDeliveryChargeCentsPerKwh ?? fallbackTduCharges?.centsPerKwh
  const touPeriods = extractTouPeriods(normalized)
  const evCharging = extractEligibleVehicleChargingPlan(normalized)
  const effectiveEnergyChargeCentsPerKwh =
    energyChargeCentsPerKwh ?? (touPeriods.length ? Math.max(...touPeriods.map((period) => period.energyChargeCentsPerKwh)) : undefined)
  const usageCredits = extractUsageCredits(normalized)

  if (effectiveEnergyChargeCentsPerKwh === undefined) {
    notes.push('Energy charge was not found in the EFL text.')
  }
  if (deliveryChargeCentsPerKwh === undefined) {
    notes.push('TDU delivery per-kWh charge was not found in the EFL text.')
  }
  if (deliveryFixedDollars === undefined) {
    notes.push('TDU fixed monthly delivery charge was not found in the EFL text.')
  }

  if (
    effectiveEnergyChargeCentsPerKwh === undefined ||
    deliveryChargeCentsPerKwh === undefined ||
    deliveryFixedDollars === undefined
  ) {
    return { notes }
  }

  if (
    effectiveEnergyChargeCentsPerKwh > 100 ||
    deliveryChargeCentsPerKwh > 100 ||
    (baseChargeDollars ?? 0) > 1000 ||
    (deliveryFixedDollars ?? 0) > 1000
  ) {
    return {
      notes: [
        ...notes,
        `Parsed EFL charges were outside expected residential ranges, so this document was not modeled. Parsed values: energy ${effectiveEnergyChargeCentsPerKwh} c/kWh, delivery ${deliveryChargeCentsPerKwh} c/kWh, base $${baseChargeDollars ?? 0}, delivery fixed $${deliveryFixedDollars}.`,
      ],
    }
  }

  return {
    notes,
    plan: {
      id: `efl-${plan.plan_id ?? `${plan.company_name}-${plan.plan_name}`}`,
      provider: plan.company_name,
      planName: plan.plan_name,
      tdu: plan.company_tdu_name,
      rateType: plan.rate_type ?? 'Fixed',
      termMonths: plan.term_value,
      advertisedCentsPerKwh: {
        kwh500: plan.price_kwh500,
        kwh1000: plan.price_kwh1000,
        kwh2000: plan.price_kwh2000,
      },
      baseChargeDollars,
      energyChargeCentsPerKwh: effectiveEnergyChargeCentsPerKwh,
      deliveryFixedDollars,
      deliveryChargeCentsPerKwh,
      usageCredits,
      touPeriods: touPeriods.length ? touPeriods : undefined,
      evCharging,
      cancellationFee: plan.pricing_details,
      renewable: plan.renewable_energy_description,
      notes: plan.special_terms,
    },
  }
}

async function extractPdfText(buffer: ArrayBuffer): Promise<string> {
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise
  const pages: string[] = []
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber)
    const content = await page.getTextContent()
    pages.push(content.items.map((item) => ('str' in item ? item.str : '')).join(' '))
  }
  await pdf.cleanup()
  return pages.join('\n')
}

async function extractResponseText(response: Response): Promise<string> {
  const contentType = response.headers.get('Content-Type') ?? ''
  const buffer = await response.arrayBuffer()
  const isPdfSignature = new Uint8Array(buffer.slice(0, 5)).every((byte, index) => byte === [37, 80, 68, 70, 45][index])
  if (isPdfSignature) {
    return extractPdfText(buffer)
  }

  const decoded = new TextDecoder().decode(buffer)
  if (contentType.includes('pdf') && !/^\s*<!doctype|^\s*<html|<body/i.test(decoded.slice(0, 500))) {
    return extractPdfText(buffer)
  }

  const doc = new DOMParser().parseFromString(decoded, 'text/html')
  return doc.body?.textContent ?? decoded
}

async function fetchEflDocument(url: string): Promise<Response> {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), eflFetchTimeoutMs)

  try {
    return await fetch(`${eflProxyBase}/efl?url=${encodeURIComponent(url)}`, {
      signal: controller.signal,
    })
  } finally {
    window.clearTimeout(timeout)
  }
}

async function fetchExternalTduText(sourceText: string): Promise<{ text: string; notes: string[] }> {
  const urls = extractTduDetailUrls(sourceText)
  const texts: string[] = []
  const notes: string[] = []

  for (const url of urls) {
    try {
      const response = await fetchEflDocument(url)
      if (!response.ok) {
        notes.push(`TDU detail URL ${url} returned HTTP ${response.status}.`)
        continue
      }
      texts.push(await extractResponseText(response))
      notes.push(`Loaded TDU detail URL ${url}.`)
    } catch (error) {
      notes.push(`TDU detail URL ${url} could not be loaded: ${error instanceof Error ? error.message : 'fetch failed'}.`)
    }
  }

  return { text: texts.join('\n'), notes }
}

export async function fetchAndParseEfl(plan: PowerToChoosePlan): Promise<PowerToChoosePlan> {
  if (!plan.fact_sheet) {
    return {
      ...plan,
      efl_parse_status: 'unsupported',
      efl_parse_notes: ['No EFL URL was provided by PowerToChoose.'],
    }
  }

  try {
    const response = await fetchEflDocument(plan.fact_sheet)
    if (!response.ok) {
      throw new Error(`EFL fetch returned HTTP ${response.status}.`)
    }
    const text = await extractResponseText(response)
    let parsed = parseEflText(plan, text)
    if (!parsed.plan && parsed.notes.some((note) => note.startsWith('TDU '))) {
      const externalTdu = await fetchExternalTduText(text)
      if (externalTdu.text) {
        const reparsed = parseEflText(plan, `${text}\n${externalTdu.text}`)
        parsed = {
          ...reparsed,
          notes: [...externalTdu.notes, ...reparsed.notes],
        }
      } else if (externalTdu.notes.length) {
        parsed = {
          ...parsed,
          notes: [...externalTdu.notes, ...parsed.notes],
        }
      }
    }
    if (!parsed.plan) {
      return {
        ...plan,
        efl_parse_status: 'unsupported',
        efl_parse_notes: parsed.notes,
      }
    }

    return {
      ...plan,
      parsed_efl: parsed.plan,
      efl_parse_status: 'parsed',
      efl_parse_notes: parsed.notes,
    }
  } catch (error) {
    return {
      ...plan,
      efl_parse_status: 'failed',
      efl_parse_notes: [error instanceof Error ? error.message : 'EFL parsing failed.'],
    }
  }
}

export async function hydratePlansWithEfl(
  plans: PowerToChoosePlan[],
  onProgress?: (done: number, total: number) => void,
): Promise<PowerToChoosePlan[]> {
  const results = [...plans]
  let nextIndex = 0
  let done = 0
  const workerCount = Math.min(6, plans.length)

  async function runWorker() {
    while (nextIndex < plans.length) {
      const index = nextIndex
      nextIndex += 1
      results[index] = await fetchAndParseEfl(plans[index])
      done += 1
      onProgress?.(done, plans.length)
    }
  }

  await Promise.all(Array.from({ length: workerCount }, runWorker))
  return results
}
