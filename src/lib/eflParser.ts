import * as pdfjsLib from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url'
import type { CustomEflPlan, PowerToChoosePlan, UsageCredit } from './types'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

const eflProxyBase = 'https://texas-electric-plan-finder-ptc.joshua-s-warren.workers.dev'

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

function extractUsageCredits(text: string): UsageCredit[] {
  const credits: UsageCredit[] = []
  const patterns = [
    /\$(\d+(?:\.\d{1,2})?).{0,90}?(?:usage|use).{0,70}?(?:at least|above or equal to|greater than or equal to|>=|reaches)\s*(\d{3,5})\s*kwh/gi,
    /(?:usage|bill)\s+credit.{0,80}?\$(\d+(?:\.\d{1,2})?).{0,100}?(\d{3,5})\s*kwh/gi,
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
  const baseChargeDollars = firstNumber(
    [
      /base\s+charge\s+\$?(\d+(?:\.\d{1,2})?)\s*(?:per billing cycle|\/\s*month|per month)/i,
      /customer\s+charge\s+\$?(\d+(?:\.\d{1,2})?)\s*(?:per billing cycle|\/\s*month|per month)/i,
    ],
    normalized,
  )
  const energyChargeCentsPerKwh = firstCentsPerKwh(
    normalized,
    [
      /(?:fixed\s+)?energy\s+charge\s+(\d+(?:\.\d{1,5})?)\s*(?:cents?|¢)\s*(?:per|\/)\s*kwh/i,
    ],
    [
      /(?:fixed\s+)?energy\s+charge\s+\$(\d+(?:\.\d{1,5})?)\s*(?:per|\/)\s*kwh/i,
    ],
  )
  const deliveryFixedDollars = firstNumber(
    [
      /(?:tdu|tdsp|delivery|oncor|centerpoint|aep|tnmp).{0,80}?\$?(\d+(?:\.\d{1,2})?)\s*(?:per billing cycle|per month|\/\s*month)/i,
    ],
    normalized,
  )
  const deliveryChargeCentsPerKwh = firstCentsPerKwh(
    normalized,
    [
      /(?:tdu|tdsp|delivery|oncor|centerpoint|aep|tnmp).{0,120}?(\d+(?:\.\d{1,5})?)\s*cents?\s*(?:per|\/)\s*kwh/i,
    ],
    [
      /(?:tdu|tdsp|delivery|oncor|centerpoint|aep|tnmp).{0,120}?\$(\d+(?:\.\d{1,5})?)\s*(?:per|\/)\s*kwh/i,
    ],
  )
  const usageCredits = extractUsageCredits(normalized)

  if (energyChargeCentsPerKwh === undefined) {
    notes.push('Energy charge was not found in the EFL text.')
  }
  if (deliveryChargeCentsPerKwh === undefined) {
    notes.push('TDU delivery per-kWh charge was not found in the EFL text.')
  }

  if (energyChargeCentsPerKwh === undefined || deliveryChargeCentsPerKwh === undefined) {
    return { notes }
  }

  if (
    energyChargeCentsPerKwh > 100 ||
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
      energyChargeCentsPerKwh,
      deliveryFixedDollars,
      deliveryChargeCentsPerKwh,
      usageCredits,
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

export async function fetchAndParseEfl(plan: PowerToChoosePlan): Promise<PowerToChoosePlan> {
  if (!plan.fact_sheet) {
    return {
      ...plan,
      efl_parse_status: 'unsupported',
      efl_parse_notes: ['No EFL URL was provided by PowerToChoose.'],
    }
  }

  try {
    const response = await fetch(`${eflProxyBase}/efl?url=${encodeURIComponent(plan.fact_sheet)}`)
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
