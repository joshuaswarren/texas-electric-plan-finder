export type UsageInterval = {
  esiId?: string
  date: string
  month: string
  weekday: number
  startMinutes: number
  endMinutes: number
  kwh: number
  estimated: boolean
  flow: string
}

export type UsageSummary = {
  rawIntervalCount: number
  intervalCount: number
  estimatedCount: number
  totalKwh: number
  monthCount: number
  firstDate?: string
  lastDate?: string
  monthly: MonthlyUsage[]
  excludedMonths: ExcludedMonth[]
  buckets: UsageBucket[]
}

export type MonthlyUsage = {
  month: string
  kwh: number
  intervals: UsageInterval[]
}

export type ExcludedMonth = {
  month: string
  kwh: number
  reason: 'partial-month' | 'outside-latest-12'
}

export type UsageBucket = {
  key: string
  label: string
  kwh: number
  share: number
}

export type PowerToChoosePlan = {
  plan_id?: number
  company_name: string
  company_tdu_name?: string
  plan_name: string
  rate_type?: string
  term_value?: number
  price_kwh500?: number
  price_kwh1000?: number
  price_kwh2000?: number
  timeofuse?: boolean
  prepaid?: boolean
  minimum_usage?: boolean
  renewable_energy_description?: string
  rating_total?: number
  rating_count?: number
  new_customer?: boolean
  pricing_details?: string
  special_terms?: string
  fact_sheet?: string
  terms_of_service?: string
  go_to_plan?: string
  parsed_efl?: CustomEflPlan
  efl_parse_status?: 'pending' | 'parsed' | 'unsupported' | 'failed'
  efl_parse_notes?: string[]
}

export type UsageCredit = {
  thresholdKwh: number
  amountDollars: number
}

export type TouPeriod = {
  label: string
  energyChargeCentsPerKwh: number
  start: string
  end: string
  days: 'all' | 'weekdays' | 'weekends'
}

export type EvChargingMonthly = {
  month: string
  kwh: number
  eligibleKwh: number
}

export type EvChargingProfile = {
  source: 'manual' | 'tesla-wall-connector' | 'tesla-vehicle' | 'tesla-charge-stats' | 'interval-estimate' | 'assumption'
  vehicleCount: number
  monthly: EvChargingMonthly[]
  totalKwh: number
  eligibleKwh: number
  notes: string[]
}

export type EvChargingPlan = {
  monthlyFeeDollarsPerVehicle: number
  eligiblePeriods: Omit<TouPeriod, 'energyChargeCentsPerKwh'>[]
  assumedMonthlyKwh?: number
  requiredDevice?: string
}

export type CustomEflPlan = {
  id: string
  provider: string
  planName: string
  tdu?: string
  sourceLabel?: string
  rateType: string
  termMonths?: number
  advertisedCentsPerKwh?: {
    kwh500?: number
    kwh1000?: number
    kwh2000?: number
  }
  baseChargeDollars?: number
  energyChargeCentsPerKwh?: number
  deliveryFixedDollars?: number
  deliveryChargeCentsPerKwh?: number
  usageCredits?: UsageCredit[]
  touPeriods?: TouPeriod[]
  evCharging?: EvChargingPlan
  cancellationFee?: string
  renewable?: string
  isBaseline?: boolean
  notes?: string
}

export type CandidatePlan =
  | {
      source: 'ptc'
      id: string
      provider: string
      planName: string
      rateType?: string
      termMonths?: number
      tdu?: string
      timeOfUse: boolean
      prepaid: boolean
      minimumUsage: boolean
      renewable?: string
      rating?: number
      pricingDetails?: string
      specialTerms?: string
      factSheetUrl?: string
      signUpUrl?: string
      eflPlan?: CustomEflPlan
      eflParseStatus?: PowerToChoosePlan['efl_parse_status']
      eflParseNotes?: string[]
      raw: PowerToChoosePlan
    }
  | {
      source: 'efl'
      id: string
      provider: string
      planName: string
      rateType?: string
      termMonths?: number
      tdu?: string
      timeOfUse: boolean
      prepaid: boolean
      minimumUsage: boolean
      renewable?: string
      pricingDetails?: string
      specialTerms?: string
      isBaseline?: boolean
      raw: CustomEflPlan
    }

export type EvaluatedPlan = CandidatePlan & {
  annualCost: number
  averageCentsPerKwh: number
  monthlyCosts: { month: string; kwh: number; cost: number; eligibleEvKwh: number }[]
  estimateMethod: 'efl-rules' | 'ptc-average-curve'
  warnings: string[]
}
