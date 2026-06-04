import type { UsageInterval } from './types'

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

function clean(value: string | undefined): string {
  return (value ?? '').trim().replace(/^'/, '')
}

function parseDate(date: string, time: string): Date {
  const [month, day, year] = date.split('/').map(Number)
  const [hour, minute] = time.split(':').map(Number)
  if (!month || !day || !year || hour < 0 || Number.isNaN(minute)) {
    throw new Error(`Invalid Smart Meter Texas date/time: ${date} ${time}`)
  }
  return new Date(year, month - 1, day, hour, minute)
}

function formatDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function minutes(time: string): number {
  const [hour, minute] = time.split(':').map(Number)
  return hour * 60 + minute
}

export function parseSmartMeterTexasCsv(input: string): UsageInterval[] {
  const rows = parseCsvRows(input)
  if (rows.length < 2) {
    throw new Error('The CSV does not contain Smart Meter Texas interval rows.')
  }

  const headers = rows[0].map((header) => clean(header).toUpperCase())
  const index = Object.fromEntries(headers.map((header, i) => [header, i]))
  const required = [
    'USAGE_DATE',
    'USAGE_START_TIME',
    'USAGE_END_TIME',
    'USAGE_KWH',
    'ESTIMATED_ACTUAL',
  ]
  const missing = required.filter((header) => index[header] === undefined)
  if (missing.length > 0) {
    throw new Error(`Missing Smart Meter Texas column(s): ${missing.join(', ')}`)
  }

  return rows.slice(1).map((row) => {
    const date = clean(row[index.USAGE_DATE])
    const start = clean(row[index.USAGE_START_TIME])
    const [monthNumber, dayNumber, yearNumber] = date.split('/').map(Number)
    const parsedDate = parseDate(date, start)
    const formattedDate = formatDate(yearNumber, monthNumber, dayNumber)
    const month = formattedDate.slice(0, 7)
    const kwh = Number(clean(row[index.USAGE_KWH]))

    if (!Number.isFinite(kwh)) {
      throw new Error(`Invalid kWh value on ${date} at ${start}`)
    }

    return {
      esiId: clean(row[index.ESIID]),
      date: formattedDate,
      month,
      weekday: parsedDate.getDay(),
      startMinutes: minutes(start),
      endMinutes: minutes(clean(row[index.USAGE_END_TIME])),
      kwh,
      estimated: clean(row[index.ESTIMATED_ACTUAL]).toUpperCase() !== 'A',
      flow: clean(row[index.CONSUMPTION_SURPLUSGENERATION]) || 'Consumption',
    }
  })
}
