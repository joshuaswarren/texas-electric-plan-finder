import type { MonthlyUsage, UsageBucket, UsageInterval, UsageSummary } from './types'

const bucketDefinitions = [
  {
    key: 'weekdayPeak',
    label: 'Weekday 4-9p',
    test: (interval: UsageInterval) =>
      interval.weekday >= 1 &&
      interval.weekday <= 5 &&
      interval.startMinutes >= 16 * 60 &&
      interval.startMinutes < 21 * 60,
  },
  {
    key: 'overnight',
    label: 'Night 9p-7a',
    test: (interval: UsageInterval) =>
      interval.startMinutes >= 21 * 60 || interval.startMinutes < 7 * 60,
  },
  {
    key: 'weekend',
    label: 'Weekend',
    test: (interval: UsageInterval) => interval.weekday === 0 || interval.weekday === 6,
  },
]

export function summarizeUsage(intervals: UsageInterval[]): UsageSummary {
  const sorted = [...intervals].sort((a, b) => {
    if (a.date === b.date) {
      return a.startMinutes - b.startMinutes
    }
    return a.date.localeCompare(b.date)
  })
  const totalKwh = sorted.reduce((total, interval) => total + interval.kwh, 0)
  const monthlyMap = new Map<string, UsageInterval[]>()

  for (const interval of sorted) {
    monthlyMap.set(interval.month, [...(monthlyMap.get(interval.month) ?? []), interval])
  }

  const monthly: MonthlyUsage[] = [...monthlyMap.entries()].map(([month, monthIntervals]) => ({
    month,
    intervals: monthIntervals,
    kwh: monthIntervals.reduce((total, interval) => total + interval.kwh, 0),
  }))

  const buckets: UsageBucket[] = bucketDefinitions.map((bucket) => {
    const kwh = sorted
      .filter((interval) => bucket.test(interval))
      .reduce((total, interval) => total + interval.kwh, 0)
    return {
      key: bucket.key,
      label: bucket.label,
      kwh,
      share: totalKwh > 0 ? kwh / totalKwh : 0,
    }
  })

  return {
    intervalCount: sorted.length,
    estimatedCount: sorted.filter((interval) => interval.estimated).length,
    totalKwh,
    monthCount: monthly.length,
    firstDate: sorted[0]?.date,
    lastDate: sorted[sorted.length - 1]?.date,
    monthly,
    buckets,
  }
}
