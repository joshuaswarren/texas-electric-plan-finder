import type { EvChargingMonthly, EvChargingProfile, TouPeriod, UsageSummary } from './types'

type EvSource = EvChargingProfile['source']

function normalizeHeader(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
}

function parseCsvRows(input: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index]
    const next = input[index + 1]

    if (char === '"') {
      if (inQuotes && next === '"') {
        field += '"'
        index += 1
      } else {
        inQuotes = !inQuotes
      }
      continue
    }

    if (!inQuotes && char === ',') {
      row.push(field)
      field = ''
      continue
    }

    if (!inQuotes && (char === '\n' || char === '\r')) {
      if (char === '\r' && next === '\n') {
        index += 1
      }
      row.push(field)
      if (row.some((value) => value.trim().length > 0)) {
        rows.push(row)
      }
      row = []
      field = ''
      continue
    }

    field += char
  }

  row.push(field)
  if (row.some((value) => value.trim().length > 0)) {
    rows.push(row)
  }

  return rows
}

function findIndex(headers: string[], candidates: string[]): number {
  return headers.findIndex((header) => candidates.includes(header))
}

function parseNumber(value: string | undefined): number | undefined {
  const parsed = Number((value ?? '').replace(/[$,\s]/g, ''))
  return Number.isFinite(parsed) ? parsed : undefined
}

function parseMonth(value: string): string | undefined {
  const clean = value.trim()
  const iso = clean.match(/^(\d{4})-(\d{2})/)
  if (iso) return `${iso[1]}-${iso[2]}`

  const us = clean.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  if (us) {
    return `${us[3]}-${String(Number(us[1])).padStart(2, '0')}`
  }

  const date = new Date(clean)
  if (!Number.isNaN(date.getTime())) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
  }

  return undefined
}

function parseMinutes(value: string): number | undefined {
  const match = value.trim().match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i)
  if (!match) return undefined

  let hour = Number(match[1])
  const minute = Number(match[2] ?? 0)
  const ampm = match[3]?.toLowerCase()
  if (ampm === 'pm' && hour !== 12) hour += 12
  if (ampm === 'am' && hour === 12) hour = 0
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return undefined
  return hour * 60 + minute
}

function timeToMinutes(time: string): number {
  const [hour, minute] = time.split(':').map(Number)
  return hour * 60 + minute
}

function periodContainsMinute(minute: number, period: Omit<TouPeriod, 'energyChargeCentsPerKwh'>): boolean {
  const start = timeToMinutes(period.start)
  const end = timeToMinutes(period.end)
  if (start <= end) {
    return minute >= start && minute < end
  }
  return minute >= start || minute < end
}

function buildProfile(
  monthly: EvChargingMonthly[],
  source: EvSource,
  vehicleCount: number,
  notes: string[],
): EvChargingProfile {
  const sorted = monthly
    .filter((month) => Number.isFinite(month.kwh) && month.kwh > 0)
    .sort((a, b) => a.month.localeCompare(b.month))

  return {
    source,
    vehicleCount,
    monthly: sorted,
    totalKwh: sorted.reduce((total, month) => total + month.kwh, 0),
    eligibleKwh: sorted.reduce((total, month) => total + month.eligibleKwh, 0),
    notes,
  }
}

export function createMonthlyEvAssumption(
  months: string[],
  monthlyKwh: number,
  vehicleCount: number,
  allEligible: boolean,
): EvChargingProfile {
  return buildProfile(
    months.map((month) => ({
      month,
      kwh: monthlyKwh,
      eligibleKwh: allEligible ? monthlyKwh : 0,
    })),
    'assumption',
    vehicleCount,
    [
      allEligible
        ? 'EV charging assumption treats all entered kWh as eligible vehicle charging.'
        : 'EV charging assumption is loaded, but eligible kWh is set to zero.',
    ],
  )
}

export function parseEvChargingCsv(
  input: string,
  months: string[],
  eligiblePeriods: Omit<TouPeriod, 'energyChargeCentsPerKwh'>[],
  vehicleCount: number,
): EvChargingProfile {
  const rows = parseCsvRows(input)
  if (rows.length < 2) {
    throw new Error('The EV charging CSV does not contain data rows.')
  }

  const headers = rows[0].map(normalizeHeader)
  const monthIndex = findIndex(headers, ['month', 'billing_month'])
  const startIndex = findIndex(headers, [
    'start',
    'start_time',
    'started_at',
    'charging_start_time',
    'charge_start_time',
    'date',
  ])
  const kwhIndex = findIndex(headers, [
    'kwh',
    'energy_kwh',
    'energy_delivered_kwh',
    'energy_delivered',
    'charging_kwh',
    'home_charging_kwh',
  ])
  const eligibleIndex = findIndex(headers, ['eligible_kwh', 'eligible_vehicle_kwh'])
  const explicitEligibleIndex = findIndex(headers, ['eligible', 'is_eligible'])

  if (kwhIndex < 0) {
    throw new Error('EV charging CSV must include a kWh or Energy Delivered (kWh) column.')
  }
  if (monthIndex < 0 && startIndex < 0) {
    throw new Error('EV charging CSV must include either a Month column or a charging start date/time column.')
  }

  const allowedMonths = new Set(months)
  const byMonth = new Map<string, EvChargingMonthly>()
  const notes = [
    'Manual EV import only discounts rows marked eligible or sessions whose start time falls inside the eligible charging window.',
  ]

  for (const row of rows.slice(1)) {
    const kwh = parseNumber(row[kwhIndex])
    if (kwh === undefined || kwh <= 0) continue

    const month = monthIndex >= 0 ? parseMonth(row[monthIndex]) : parseMonth(row[startIndex])
    if (!month || !allowedMonths.has(month)) continue

    const explicitEligible =
      explicitEligibleIndex >= 0 ? /^(true|yes|y|1)$/i.test(row[explicitEligibleIndex].trim()) : undefined
    const eligibleKwh = eligibleIndex >= 0 ? parseNumber(row[eligibleIndex]) : undefined
    const startMinutes = startIndex >= 0 ? parseMinutes(row[startIndex]) : undefined
    const inferredEligible =
      explicitEligible ??
      (startMinutes !== undefined && eligiblePeriods.some((period) => periodContainsMinute(startMinutes, period)))
    const eligible = Math.min(kwh, eligibleKwh ?? (inferredEligible ? kwh : 0))
    const existing = byMonth.get(month) ?? { month, kwh: 0, eligibleKwh: 0 }
    existing.kwh += kwh
    existing.eligibleKwh += eligible
    byMonth.set(month, existing)
  }

  return buildProfile([...byMonth.values()], 'manual', vehicleCount, notes)
}

export function parseTeslaChargeHistory(
  payload: unknown,
  months: string[],
  eligiblePeriods: Omit<TouPeriod, 'energyChargeCentsPerKwh'>[],
  vehicleCount: number,
): EvChargingProfile {
  const allowedMonths = new Set(months)
  const records = Array.isArray(payload)
    ? payload
    : payload && typeof payload === 'object' && 'response' in payload && Array.isArray((payload as { response: unknown }).response)
      ? (payload as { response: unknown[] }).response
      : payload && typeof payload === 'object' && 'data' in payload && Array.isArray((payload as { data: unknown }).data)
        ? (payload as { data: unknown[] }).data
        : []

  const byMonth = new Map<string, EvChargingMonthly>()
  for (const record of records) {
    if (!record || typeof record !== 'object') continue
    const item = record as Record<string, unknown>
    const rawEnergy =
      typeof item.energy_wh === 'number'
        ? item.energy_wh / 1000
        : typeof item.energy_Wh === 'number'
          ? item.energy_Wh / 1000
          : typeof item.energy_kwh === 'number'
            ? item.energy_kwh
            : undefined
    const startedAt =
      typeof item.start_date === 'string'
        ? item.start_date
        : typeof item.started_at === 'string'
          ? item.started_at
          : typeof item.timestamp === 'string'
            ? item.timestamp
            : ''
    const month = parseMonth(startedAt)
    if (!month || !allowedMonths.has(month) || rawEnergy === undefined || rawEnergy <= 0) continue

    const startMinutes = parseMinutes(startedAt)
    const eligible = startMinutes !== undefined && eligiblePeriods.some((period) => periodContainsMinute(startMinutes, period))
    const existing = byMonth.get(month) ?? { month, kwh: 0, eligibleKwh: 0 }
    existing.kwh += rawEnergy
    existing.eligibleKwh += eligible ? rawEnergy : 0
    byMonth.set(month, existing)
  }

  return buildProfile([...byMonth.values()], 'tesla-wall-connector', vehicleCount, [
    'Tesla Wall Connector charge history is preferred when available because it reports charger-side session energy.',
  ])
}

export function estimateEvChargingFromIntervals(usage: UsageSummary, vehicleCount: number): EvChargingProfile {
  const byMonth = new Map<string, EvChargingMonthly>()
  const thresholdKwhPerInterval = 1.8
  const assumedHouseBaselineKwh = 0.5
  const minimumBlockIntervals = 4

  for (const month of usage.monthly) {
    const candidates = month.intervals.filter(
      (interval) => interval.startMinutes >= 0 && interval.startMinutes < 12 * 60 && interval.kwh >= thresholdKwhPerInterval,
    )
    let index = 0
    while (index < candidates.length) {
      const block = [candidates[index]]
      index += 1
      while (
        index < candidates.length &&
        candidates[index].date === block[block.length - 1].date &&
        candidates[index].startMinutes === block[block.length - 1].endMinutes
      ) {
        block.push(candidates[index])
        index += 1
      }
      if (block.length < minimumBlockIntervals) continue

      const kwh = block.reduce((total, interval) => total + Math.max(0, interval.kwh - assumedHouseBaselineKwh), 0)
      if (kwh <= 0) continue
      const existing = byMonth.get(month.month) ?? { month: month.month, kwh: 0, eligibleKwh: 0 }
      existing.kwh += kwh
      existing.eligibleKwh += kwh
      byMonth.set(month.month, existing)
    }
  }

  return buildProfile([...byMonth.values()], 'interval-estimate', vehicleCount, [
    'Interval estimate is a fallback only: it looks for sustained midnight-noon load above 1.8 kWh per 15 minutes and subtracts 0.5 kWh per interval as household baseline.',
  ])
}
