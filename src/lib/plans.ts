import type {
  CandidatePlan,
  CustomEflPlan,
  EvChargingProfile,
  EvaluatedPlan,
  MonthlyUsage,
  PowerToChoosePlan,
  TouPeriod,
  UsageInterval,
} from './types'

function centsToDollars(cents: number, kwh: number): number {
  return (cents / 100) * kwh
}

function timeToMinutes(time: string): number {
  const [hour, minute] = time.split(':').map(Number)
  return hour * 60 + minute
}

function periodMatches(interval: UsageInterval, period: TouPeriod): boolean {
  const isWeekend = interval.weekday === 0 || interval.weekday === 6
  if (period.days === 'weekdays' && isWeekend) return false
  if (period.days === 'weekends' && !isWeekend) return false

  const start = timeToMinutes(period.start)
  const end = timeToMinutes(period.end)
  if (start <= end) {
    return interval.startMinutes >= start && interval.startMinutes < end
  }
  return interval.startMinutes >= start || interval.startMinutes < end
}

function eligibleEvKwhForMonth(plan: CustomEflPlan, month: MonthlyUsage, evProfile?: EvChargingProfile): number {
  if (!plan.evCharging || !evProfile) return 0

  const evMonth = evProfile.monthly.find((candidate) => candidate.month === month.month)
  if (!evMonth) return 0

  return Math.min(month.kwh, Math.max(0, evMonth.eligibleKwh))
}

function calculateEflMonthlyCost(
  plan: CustomEflPlan,
  month: MonthlyUsage,
  evProfile?: EvChargingProfile,
): { cost: number; eligibleEvKwh: number } {
  const eligibleEvKwh = eligibleEvKwhForMonth(plan, month, evProfile)
  const billableKwh = plan.evCharging ? Math.max(0, month.kwh - eligibleEvKwh) : month.kwh
  const evMonthlyFee =
    plan.evCharging && evProfile
      ? plan.evCharging.monthlyFeeDollarsPerVehicle * Math.max(1, evProfile.vehicleCount)
      : 0

  const base =
    (plan.baseChargeDollars ?? 0) +
    (plan.deliveryFixedDollars ?? 0) +
    evMonthlyFee +
    centsToDollars(plan.deliveryChargeCentsPerKwh ?? 0, billableKwh)

  const energy = plan.evCharging
    ? centsToDollars(plan.energyChargeCentsPerKwh ?? 0, billableKwh)
    : plan.touPeriods?.length
    ? month.intervals.reduce((total, interval) => {
        const period = plan.touPeriods?.find((candidate) => periodMatches(interval, candidate))
        const cents = period?.energyChargeCentsPerKwh ?? plan.energyChargeCentsPerKwh ?? 0
        return total + centsToDollars(cents, interval.kwh)
      }, 0)
    : centsToDollars(plan.energyChargeCentsPerKwh ?? 0, month.kwh)

  const credits = (plan.usageCredits ?? [])
    .filter((credit) => month.kwh >= credit.thresholdKwh)
    .reduce((total, credit) => total + credit.amountDollars, 0)

  return {
    cost: Math.max(0, base + energy - credits),
    eligibleEvKwh,
  }
}

function ptcCurveCost(plan: PowerToChoosePlan, kwh: number): number {
  const points = [
    { kwh: 500, cost: ((plan.price_kwh500 ?? plan.price_kwh1000 ?? 0) / 100) * 500 },
    { kwh: 1000, cost: ((plan.price_kwh1000 ?? plan.price_kwh500 ?? 0) / 100) * 1000 },
    { kwh: 2000, cost: ((plan.price_kwh2000 ?? plan.price_kwh1000 ?? 0) / 100) * 2000 },
  ]

  if (kwh <= 0) return 0
  if (kwh <= 500) return (points[0].cost / 500) * kwh

  const low = kwh <= 1000 ? points[0] : points[1]
  const high = kwh <= 1000 ? points[1] : points[2]
  const slope = (high.cost - low.cost) / (high.kwh - low.kwh)

  if (kwh <= high.kwh) {
    return low.cost + slope * (kwh - low.kwh)
  }

  return Math.max(0, high.cost + slope * (kwh - high.kwh))
}

export function mapPowerToChoosePlans(plans: PowerToChoosePlan[]): CandidatePlan[] {
  return plans.map((plan, index) => ({
    source: 'ptc',
    id: `ptc-${plan.plan_id ?? index}`,
    provider: plan.company_name,
    planName: plan.plan_name,
    rateType: plan.rate_type,
    termMonths: plan.term_value,
    tdu: plan.company_tdu_name,
    timeOfUse: Boolean(plan.timeofuse),
    prepaid: Boolean(plan.prepaid),
    minimumUsage: Boolean(plan.minimum_usage),
    renewable: plan.renewable_energy_description,
    rating: plan.rating_total,
    pricingDetails: plan.pricing_details,
    specialTerms: plan.special_terms,
    factSheetUrl: plan.fact_sheet,
    signUpUrl: plan.go_to_plan,
    eflPlan: plan.parsed_efl,
    eflParseStatus: plan.efl_parse_status,
    eflParseNotes: plan.efl_parse_notes,
    raw: plan,
  }))
}

export function mapCustomPlans(plans: CustomEflPlan[]): CandidatePlan[] {
  return plans.map((plan) => ({
    source: 'efl',
    id: `efl-${plan.id}`,
    provider: plan.provider,
    planName: plan.planName,
    rateType: plan.rateType,
    termMonths: plan.termMonths,
    tdu: plan.tdu,
    timeOfUse: Boolean(plan.touPeriods?.length),
    prepaid: false,
    minimumUsage: Boolean(plan.usageCredits?.length),
    renewable: plan.renewable,
    pricingDetails: plan.cancellationFee,
    specialTerms: plan.notes,
    isBaseline: plan.isBaseline,
    raw: plan,
  }))
}

export function evaluatePlan(
  plan: CandidatePlan,
  monthlyUsage: MonthlyUsage[],
  evProfile?: EvChargingProfile,
): EvaluatedPlan {
  const monthlyCosts = monthlyUsage.map((month) => {
    if (plan.source === 'efl') {
      return {
        month: month.month,
        kwh: month.kwh,
        ...calculateEflMonthlyCost(plan.raw, month, evProfile),
      }
    }
    if (plan.eflPlan) {
      return {
        month: month.month,
        kwh: month.kwh,
        ...calculateEflMonthlyCost(plan.eflPlan, month, evProfile),
      }
    }

    return {
      month: month.month,
      kwh: month.kwh,
      cost: ptcCurveCost(plan.raw, month.kwh),
      eligibleEvKwh: 0,
    }
  })
  const annualCost = monthlyCosts.reduce((total, month) => total + month.cost, 0)
  const totalKwh = monthlyCosts.reduce((total, month) => total + month.kwh, 0)
  const warnings: string[] = []
  const eflPlan = plan.source === 'efl' ? plan.raw : plan.eflPlan

  if (plan.source === 'ptc') {
    if (plan.eflPlan) {
      warnings.push('Scored with parsed EFL charges. Verify the provider EFL before enrollment.')
    } else {
      warnings.push('EFL parser could not model this plan; scored from PowerToChoose 500/1000/2000 kWh averages.')
    }
    if (plan.eflParseNotes?.length) {
      warnings.push(...plan.eflParseNotes)
    }
    if (monthlyUsage.some((month) => month.kwh > 2000)) {
      warnings.push('Usage exceeds the highest published PTC point; costs above 2,000 kWh are extrapolated.')
    }
    if (plan.minimumUsage) {
      warnings.push('PowerToChoose marks this plan as minimum-usage sensitive.')
    }
  }

  if (plan.timeOfUse && plan.source === 'ptc') {
    warnings.push('TOU intervals require EFL rules for exact scoring.')
  }
  if (eflPlan?.evCharging) {
    if (evProfile) {
      warnings.push(
        `EV plan scored with ${evProfile.eligibleKwh.toFixed(1)} eligible EV kWh from ${evProfile.source}. Non-EV household usage inside the charging window is not discounted.`,
      )
      warnings.push(...evProfile.notes)
    } else {
      warnings.push('EV plan requires separate Tesla charging kWh. Without EV data, no vehicle-charging discount was applied.')
    }
  }

  return {
    ...plan,
    annualCost,
    averageCentsPerKwh: totalKwh > 0 ? (annualCost / totalKwh) * 100 : 0,
    monthlyCosts,
    estimateMethod: plan.source === 'efl' || (plan.source === 'ptc' && plan.eflPlan) ? 'efl-rules' : 'ptc-average-curve',
    warnings,
  }
}

export function parsePlanImport(input: string): { ptc: PowerToChoosePlan[]; custom: CustomEflPlan[] } {
  const parsed = JSON.parse(input)
  if (Array.isArray(parsed)) {
    const looksLikePtc = parsed.some((plan) => 'price_kwh1000' in plan || 'company_name' in plan)
    return looksLikePtc ? { ptc: parsed, custom: [] } : { ptc: [], custom: parsed }
  }

  if (Array.isArray(parsed.data)) {
    return { ptc: parsed.data, custom: [] }
  }

  return {
    ptc: Array.isArray(parsed.ptc) ? parsed.ptc : [],
    custom: Array.isArray(parsed.custom) ? parsed.custom : [],
  }
}
