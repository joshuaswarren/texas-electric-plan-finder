import type { ExcludedMonth, MonthlyUsage, UsageBucket, UsageInterval, UsageSummary } from './types'

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

function daysInMonth(month: string): number {
  const [year, monthNumber] = month.split('-').map(Number)
  return new Date(year, monthNumber, 0).getDate()
}

function hasEveryCalendarDay(month: string, intervals: UsageInterval[]): boolean {
  const coveredDays = new Set(intervals.map((interval) => Number(interval.date.slice(8, 10))))
  const expectedDays = daysInMonth(month)

  for (let day = 1; day <= expectedDays; day += 1) {
    if (!coveredDays.has(day)) {
      return false
    }
  }

  return true
}

export function summarizeUsage(intervals: UsageInterval[]): UsageSummary {
  const sorted = [...intervals].sort((a, b) => {
    if (a.date === b.date) {
      return a.startMinutes - b.startMinutes
    }
    return a.date.localeCompare(b.date)
  })
  const monthlyMap = new Map<string, UsageInterval[]>()

  for (const interval of sorted) {
    monthlyMap.set(interval.month, [...(monthlyMap.get(interval.month) ?? []), interval])
  }

  const allMonthly: MonthlyUsage[] = [...monthlyMap.entries()]
    .map(([month, monthIntervals]) => ({
      month,
      intervals: monthIntervals,
      kwh: monthIntervals.reduce((total, interval) => total + interval.kwh, 0),
    }))
    .sort((a, b) => a.month.localeCompare(b.month))

  const completeMonths = allMonthly.filter((month) =>
    hasEveryCalendarDay(month.month, month.intervals),
  )
  const monthly = completeMonths.slice(-12)
  const monthlyKeys = new Set(monthly.map((month) => month.month))
  const excludedMonths: ExcludedMonth[] = [
    ...allMonthly
      .filter((month) => !hasEveryCalendarDay(month.month, month.intervals))
      .map((month) => ({
        month: month.month,
        kwh: month.kwh,
        reason: 'partial-month' as const,
      })),
    ...completeMonths
      .filter((month) => !monthlyKeys.has(month.month))
      .map((month) => ({
        month: month.month,
        kwh: month.kwh,
        reason: 'outside-latest-12' as const,
      })),
  ]

  const scoredIntervals = monthly.flatMap((month) => month.intervals)
  const totalKwh = scoredIntervals.reduce((total, interval) => total + interval.kwh, 0)

  const buckets: UsageBucket[] = bucketDefinitions.map((bucket) => {
    const kwh = scoredIntervals
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
    rawIntervalCount: sorted.length,
    intervalCount: scoredIntervals.length,
    estimatedCount: scoredIntervals.filter((interval) => interval.estimated).length,
    totalKwh,
    monthCount: monthly.length,
    firstDate: scoredIntervals[0]?.date,
    lastDate: scoredIntervals[scoredIntervals.length - 1]?.date,
    monthly,
    excludedMonths,
    buckets,
  }
}
