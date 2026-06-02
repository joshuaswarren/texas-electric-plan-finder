import * as pdfjsLib from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url'
import type { CustomEflPlan, PowerToChoosePlan, TouPeriod, UsageCredit } from './types'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

const eflProxyBase = 'https://texas-electric-plan-finder-ptc.joshua-s-warren.workers.dev'
const eflFetchTimeoutMs = 20_000

function normalizeText(text: string): string {
  return text
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

function normalizeMoney(value: number): number {
  return Math.round(value * 100) / 100
}

function normalizeCents(value: number): number {
  return Math.round(value * 100000) / 100000
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

function findLabeledRate(text: string, labels: string[]): number | undefined {
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const patterns = [
      new RegExp(
        `${escaped}\\s*(?:energy\\s*)?charge\\s*:?\\s*(?:of\\s*)?(\\d+(?:\\.\\d{1,5})?)\\s*(?:cents?|¢)(?:\\s*cents?)?\\s*(?:per|\\/)\\s*kwh`,
        'i',
      ),
      new RegExp(
        `energy\\s*${escaped}\\s*charge\\s*:?\\s*(?:of\\s*)?(\\d+(?:\\.\\d{1,5})?)\\s*(?:cents?|¢)(?:\\s*cents?)?\\s*(?:per|\\/)\\s*kwh`,
        'i',
      ),
      new RegExp(
        `energy\\s+charge\\s*\\(\\s*${escaped}\\s*\\)\\s*(\\d+(?:\\.\\d{1,5})?)\\s*(?:cents?|¢)`,
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

function inferChargesFromAveragePrices(
  plan: PowerToChoosePlan,
  energyChargeCentsPerKwh: number,
  baseChargeDollars: number | undefined,
): { deliveryFixedDollars?: number; deliveryChargeCentsPerKwh?: number } | undefined {
  const points = [
    { kwh: 500, cents: plan.price_kwh500 },
    { kwh: 1000, cents: plan.price_kwh1000 },
    { kwh: 2000, cents: plan.price_kwh2000 },
  ]
    .filter((point): point is { kwh: number; cents: number } => Number.isFinite(point.cents))
    .map((point) => ({ kwh: point.kwh, cost: (point.cents / 100) * point.kwh }))

  if (points.length < 2) {
    return undefined
  }

  const low = points[points.length - 2]
  const high = points[points.length - 1]
  const totalVariableDollarsPerKwh = (high.cost - low.cost) / (high.kwh - low.kwh)
  const deliveryChargeCentsPerKwh = totalVariableDollarsPerKwh * 100 - energyChargeCentsPerKwh
  const totalFixedDollars = high.cost - totalVariableDollarsPerKwh * high.kwh
  const deliveryFixedDollars = totalFixedDollars - (baseChargeDollars ?? 0)

  if (
    deliveryChargeCentsPerKwh < 0 ||
    deliveryChargeCentsPerKwh > 30 ||
    deliveryFixedDollars < -50 ||
    deliveryFixedDollars > 100
  ) {
    return undefined
  }

  return {
    deliveryFixedDollars: normalizeMoney(Math.max(0, deliveryFixedDollars)),
    deliveryChargeCentsPerKwh: normalizeCents(deliveryChargeCentsPerKwh),
  }
}

function parseEflText(plan: PowerToChoosePlan, text: string): { plan?: CustomEflPlan; notes: string[] } {
  const normalized = normalizeText(text)
  const notes: string[] = []
  const baseChargeDollars = firstNumber(
    [
      /base\s+charge\s*:?\s*\$?\s*(\d+(?:\.\d{1,2})?)\s*(?:\$?\s*)?(?:per billing cycle|per bill month|\/\s*month|per month)/i,
      /base\s+charge\s*\(\s*\$\s*(?:per|\/)\s*month\s*\)\s*\$?\s*(\d+(?:\.\d{1,2})?)/i,
      /monthly\s+base\s+charge.{0,40}?\$?\s*(\d+(?:\.\d{1,2})?)/i,
      /customer\s+charge\s*:?\s*\$?\s*(\d+(?:\.\d{1,2})?)\s*(?:\$?\s*)?(?:per billing cycle|per bill month|\/\s*month|per month)/i,
    ],
    normalized,
  )
  const energyChargeCentsPerKwh = firstCentsPerKwh(
    normalized,
    [
      /(?:fixed\s+)?energy\s+charge(?:s)?\s*:?\s*(?:of\s*)?(\d+(?:\.\d{1,5})?)\s*(?:cents?|¢)(?:\s*cents?)?\s*(?:per|\/)\s*kwh/i,
      /(?:fixed\s+)?energy\s+charge(?:s)?\s*\(\s*(?:cents?|¢)\s*(?:\/|per)\s*kwh\s*\)\s*(\d+(?:\.\d{1,5})?)\s*(?:cents?)?/i,
      /(?:retail|rep|smartenergy|provider)\s+fixed\s+charge\s*:?\s*(\d+(?:\.\d{1,5})?)\s*(?:cents?|¢)(?:\s*cents?)?\s*(?:per|\/)\s*kwh/i,
      /fixed\s+charge\s*:?\s*(\d+(?:\.\d{1,5})?)\s*(?:cents?|¢)(?:\s*cents?)?\s*(?:per|\/)\s*kwh/i,
    ],
    [
      /(?:fixed\s+)?energy\s+charge(?:s)?\s*:?\s*(?:of\s*)?\$(\d+(?:\.\d{1,5})?)\s*(?:per|\/)\s*kwh/i,
    ],
  )
  let deliveryFixedDollars = firstNumber(
    [
      /(?:tdu|tdsp|delivery|distribution|oncor|centerpoint|aep|tnmp).{0,140}?\$\s*(\d+(?:\.\d{1,2})?)\s*(?:\$?\s*)?(?:per billing cycle|per bill month|per month|\/\s*month)/i,
      /(?:pass-through\s+)?tdsp\s+customer\s+charge\s*:?\s*\$\s*(\d+(?:\.\d{1,2})?)\s*(?:per billing cycle|per bill month|per month|\/\s*month)/i,
    ],
    normalized,
  )
  let deliveryChargeCentsPerKwh = firstCentsPerKwh(
    normalized,
    [
      /(?:tdu|tdsp|delivery|distribution|oncor|centerpoint|aep|tnmp|transmission\s+and\s+distribution).{0,160}?(\d+(?:\.\d{1,5})?)\s*cents?(?:\s*cents?)?\s*(?:per|\/)\s*kwh/i,
      /(?:pass-through\s+)?tdsp\s+distribution\s+charge\s*:?\s*(\d+(?:\.\d{1,5})?)\s*cents?(?:\s*cents?)?\s*(?:per|\/)\s*kwh/i,
    ],
    [
      /(?:tdu|tdsp|delivery|distribution|oncor|centerpoint|aep|tnmp|transmission\s+and\s+distribution).{0,160}?\$(\d+(?:\.\d{1,5})?)\s*(?:per|\/)\s*kwh/i,
    ],
  )
  const touPeriods = extractTouPeriods(normalized)
  const effectiveEnergyChargeCentsPerKwh =
    energyChargeCentsPerKwh ?? (touPeriods.length ? Math.max(...touPeriods.map((period) => period.energyChargeCentsPerKwh)) : undefined)
  const usageCredits = extractUsageCredits(normalized)
  const canInferFromAveragePrices =
    !plan.minimum_usage && !plan.timeofuse && usageCredits.length === 0 && effectiveEnergyChargeCentsPerKwh !== undefined

  if (canInferFromAveragePrices && (deliveryChargeCentsPerKwh === undefined || deliveryFixedDollars === undefined)) {
    const inferred = inferChargesFromAveragePrices(plan, effectiveEnergyChargeCentsPerKwh, baseChargeDollars)
    if (inferred) {
      deliveryChargeCentsPerKwh ??= inferred.deliveryChargeCentsPerKwh
      deliveryFixedDollars ??= inferred.deliveryFixedDollars
      notes.push('Missing TDU charges were inferred from the published 500/1000/2000 kWh prices.')
    }
  }

  if (effectiveEnergyChargeCentsPerKwh === undefined) {
    notes.push('Energy charge was not found in the EFL text.')
  }
  if (deliveryChargeCentsPerKwh === undefined) {
    notes.push('TDU delivery per-kWh charge was not found in the EFL text.')
  }

  if (effectiveEnergyChargeCentsPerKwh === undefined || deliveryChargeCentsPerKwh === undefined) {
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
        'Parsed EFL charges were outside expected residential ranges, so this document was not modeled.',
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
  if (contentType.includes('pdf') || new Uint8Array(buffer.slice(0, 5)).every((byte, index) => byte === [37, 80, 68, 70, 45][index])) {
    return extractPdfText(buffer)
  }

  const decoded = new TextDecoder().decode(buffer)
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
    const parsed = parseEflText(plan, text)
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
