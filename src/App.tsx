import {
  AlertTriangle,
  BatteryCharging,
  Car,
  FileJson,
  FileSpreadsheet,
  Filter,
  Link as LinkIcon,
  LoaderCircle,
  Search,
  SlidersHorizontal,
  Upload,
  Zap,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { flushSync } from 'react-dom'
import './App.css'
import { parseSmartMeterTexasCsv } from './lib/csv'
import { hydratePlansWithEfl } from './lib/eflParser'
import {
  createMonthlyEvAssumption,
  estimateEvChargingFromIntervals,
  parseEvChargingCsv,
  parseTeslaChargeHistory,
} from './lib/evCharging'
import { evaluatePlan, mapCustomPlans, mapPowerToChoosePlans, parsePlanImport } from './lib/plans'
import { summarizeUsage } from './lib/usage'
import type { CustomEflPlan, EvaluatedPlan, EvChargingProfile, PowerToChoosePlan, UsageSummary } from './lib/types'

type Filters = {
  minTerm: number
  maxTerm: number
  allowTou: boolean
  includePrepaid: boolean
  fixedOnly: boolean
  hideMinimumUsage: boolean
}

const defaultFilters: Filters = {
  minTerm: 1,
  maxTerm: 36,
  allowTou: false,
  includePrepaid: false,
  fixedOnly: true,
  hideMinimumUsage: false,
}

function money(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value)
}

function decimal(value: number, digits = 1): string {
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(value)
}

function percent(value: number): string {
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 1,
    minimumFractionDigits: 1,
  }).format(value * 100)
}

function filterPlan(plan: EvaluatedPlan, filters: Filters): boolean {
  if (filters.fixedOnly && plan.rateType?.toLowerCase() !== 'fixed') return false
  if (!filters.allowTou && plan.timeOfUse) return false
  if (!filters.includePrepaid && plan.prepaid) return false
  if (filters.hideMinimumUsage && plan.minimumUsage) return false
  if (plan.termMonths && plan.termMonths < filters.minTerm) return false
  if (plan.termMonths && plan.termMonths > filters.maxTerm) return false
  return true
}

function extractPowerToChoosePlans(payload: unknown): PowerToChoosePlan[] {
  if (
    payload &&
    typeof payload === 'object' &&
    'data' in payload &&
    Array.isArray((payload as { data: unknown }).data)
  ) {
    return (payload as { data: PowerToChoosePlan[] }).data
  }

  return []
}

function apiBase(): string {
  return 'https://texas-electric-plan-finder-ptc.joshua-s-warren.workers.dev'
}

function App() {
  const [usage, setUsage] = useState<UsageSummary>()
  const [ptcPlans, setPtcPlans] = useState<PowerToChoosePlan[]>([])
  const [customPlans, setCustomPlans] = useState<CustomEflPlan[]>([])
  const [evProfile, setEvProfile] = useState<EvChargingProfile>()
  const [evAnnualKwh, setEvAnnualKwh] = useState(3097.92)
  const [evVehicleCount, setEvVehicleCount] = useState(1)
  const [evAllEligible, setEvAllEligible] = useState(true)
  const [zipCode, setZipCode] = useState('')
  const [filters, setFilters] = useState<Filters>(defaultFilters)
  const [status, setStatus] = useState('Upload Smart Meter Texas interval data to start.')
  const [error, setError] = useState('')
  const [isFetching, setIsFetching] = useState(false)
  const [isFetchingTesla, setIsFetchingTesla] = useState(false)
  const [eflProgress, setEflProgress] = useState<{ done: number; total: number }>()

  const evaluatedPlans = useMemo(() => {
    if (!usage) return []
    return [...mapCustomPlans(customPlans), ...mapPowerToChoosePlans(ptcPlans)]
      .map((plan) => evaluatePlan(plan, usage.monthly, evProfile))
      .filter((plan) => filterPlan(plan, filters))
      .sort((a, b) => a.annualCost - b.annualCost)
  }, [customPlans, evProfile, filters, ptcPlans, usage])

  const baseline = evaluatedPlans.find((plan) => plan.source === 'efl' && plan.isBaseline)
  const bestPlan = evaluatedPlans[0]

  async function loadUsageFile(file: File) {
    setError('')
    setStatus(`Reading ${file.name}...`)
    try {
      const text = await file.text()
      const intervals = parseSmartMeterTexasCsv(text)
      const summary = summarizeUsage(intervals)
      if (summary.monthCount === 0) {
        throw new Error('The uploaded usage CSV did not contain any complete calendar months to score.')
      }
      flushSync(() => setUsage(summary))
      setStatus(
        `Loaded ${intervals.length.toLocaleString()} interval rows from ${file.name}; scoring ${summary.monthCount} complete month(s).`,
      )
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : 'Could not parse usage CSV.')
    }
  }

  async function loadPlanFile(file: File) {
    setError('')
    try {
      const text = await file.text()
      const imported = parsePlanImport(text)
      if (imported.ptc.length) {
        setPtcPlans(imported.ptc)
        setEflProgress({ done: 0, total: imported.ptc.length })
        const hydrated = await hydratePlansWithEfl(imported.ptc, (done, total) => {
          setEflProgress({ done, total })
          setStatus(`Parsing EFLs from imported plans: ${done}/${total}.`)
        })
        setPtcPlans(hydrated)
        setEflProgress(undefined)
      }
      setCustomPlans(imported.custom.length ? imported.custom : customPlans)
      setStatus(
        `Imported ${imported.ptc.length.toLocaleString()} PowerToChoose plan(s) and ${imported.custom.length.toLocaleString()} custom EFL plan(s).`,
      )
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : 'Could not parse plan JSON.')
    }
  }

  async function loadEvChargingFile(file: File) {
    if (!usage) {
      setError('Upload Smart Meter Texas interval usage before importing EV charging data.')
      return
    }

    setError('')
    try {
      const text = await file.text()
      const profile = parseEvChargingCsv(
        text,
        usage.monthly.map((month) => month.month),
        [{ label: 'Eligible Tesla vehicle charging', start: '00:00', end: '12:00', days: 'all' }],
        evVehicleCount,
      )
      setEvProfile(profile)
      setStatus(
        `Imported ${decimal(profile.totalKwh, 1)} Tesla charging kWh from ${file.name}; ${decimal(profile.eligibleKwh, 1)} kWh eligible.`,
      )
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : 'Could not parse EV charging CSV.')
    }
  }

  function applyEvAssumption() {
    if (!usage) {
      setError('Upload Smart Meter Texas interval usage before applying an EV charging assumption.')
      return
    }

    const profile = createMonthlyEvAssumption(
      usage.monthly.map((month) => month.month),
      evAnnualKwh / Math.max(1, usage.monthly.length),
      evVehicleCount,
      evAllEligible,
    )
    setEvProfile(profile)
    setStatus(
      `Applied Tesla charging assumption: ${decimal(profile.totalKwh, 1)} kWh/year, ${decimal(profile.eligibleKwh, 1)} eligible kWh.`,
    )
  }

  function applyIntervalEstimate() {
    if (!usage) {
      setError('Upload Smart Meter Texas interval usage before estimating EV charging.')
      return
    }

    const profile = estimateEvChargingFromIntervals(usage, evVehicleCount)
    setEvProfile(profile)
    setStatus(
      `Estimated ${decimal(profile.totalKwh, 1)} Tesla charging kWh from interval shape; ${decimal(profile.eligibleKwh, 1)} kWh eligible.`,
    )
  }

  async function connectTesla() {
    setError('')
    try {
      const response = await fetch(`${apiBase()}/tesla/status`, { credentials: 'include' })
      const payload = await response.json()
      if (!payload.configured) {
        throw new Error('Tesla OAuth is not configured on the public Worker yet. Use manual EV import, EV kWh assumption, or interval estimate.')
      }
      window.location.href = `${apiBase()}/tesla/oauth/start?return_url=${encodeURIComponent(window.location.href)}`
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : 'Tesla OAuth is not available yet.')
    }
  }

  async function fetchTeslaWallConnectorHistory() {
    if (!usage) {
      setError('Upload Smart Meter Texas interval usage before pulling Tesla charging history.')
      return
    }

    setError('')
    setIsFetchingTesla(true)
    try {
      const firstMonth = usage.monthly[0].month
      const lastMonth = usage.monthly[usage.monthly.length - 1].month
      const response = await fetch(
        `${apiBase()}/tesla/wall-connector-charge-history?start_date=${firstMonth}-01&end_date=${lastMonth}-31&time_zone=America/Chicago`,
        { credentials: 'include' },
      )
      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload.message || 'Tesla Wall Connector history was not available.')
      }
      const profile = parseTeslaChargeHistory(
        payload,
        usage.monthly.map((month) => month.month),
        [{ label: 'Eligible Tesla vehicle charging', start: '00:00', end: '12:00', days: 'all' }],
        evVehicleCount,
      )
      setEvProfile(profile)
      setStatus(
        `Loaded Tesla Wall Connector history: ${decimal(profile.totalKwh, 1)} kWh, ${decimal(profile.eligibleKwh, 1)} eligible kWh.`,
      )
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : 'Could not load Tesla Wall Connector history.')
    } finally {
      setIsFetchingTesla(false)
    }
  }

  async function fetchPowerToChoosePlans() {
    if (!/^\d{5}$/.test(zipCode)) {
      setError('Enter a 5-digit Texas ZIP code first.')
      return
    }

    setError('')
    setIsFetching(true)
    try {
      const response = await fetch(`${apiBase()}/api/PowerToChoose/plans?zip_code=${zipCode}`)
      const payload = await response.json()
      const plans = extractPowerToChoosePlans(payload)
      if (!plans.length) {
        throw new Error(payload.message || 'PowerToChoose did not return plan data.')
      }
      setPtcPlans(plans)
      setStatus(`Fetched ${plans.length.toLocaleString()} PowerToChoose plans for ${zipCode}; parsing EFLs.`)
      setEflProgress({ done: 0, total: plans.length })
      const hydrated = await hydratePlansWithEfl(plans, (done, total) => {
        setEflProgress({ done, total })
        setStatus(`Parsing EFLs for ${zipCode}: ${done}/${total}.`)
      })
      setPtcPlans(hydrated)
      setEflProgress(undefined)
      const parsedCount = hydrated.filter((plan) => plan.efl_parse_status === 'parsed').length
      setStatus(
        `Fetched ${plans.length.toLocaleString()} PowerToChoose plans for ${zipCode}; parsed ${parsedCount.toLocaleString()} EFL(s).`,
      )
    } catch (exception) {
      setError(
        `Plan fetch failed. Use the CLI fallback: npm run fetch:plans -- --zip ${zipCode}. ${
          exception instanceof Error ? exception.message : ''
        }`,
      )
    } finally {
      setIsFetching(false)
    }
  }

  return (
    <main className="app-shell">
      <section className="workbench">
        <div className="masthead">
          <div>
            <p className="eyebrow">Texas electric plan calculator</p>
            <h1>Rank PowerToChoose plans against real Smart Meter Texas usage.</h1>
          </div>
          <div className="hero-meter" aria-hidden="true">
            <Zap size={36} />
            <span>{usage ? `${decimal(usage.totalKwh, 0)} kWh` : '12 mo.'}</span>
          </div>
        </div>

        <div className="control-grid">
          <section className="panel">
            <div className="panel-title">
              <FileSpreadsheet size={18} />
              <h2>Usage</h2>
            </div>
            <label className="file-drop">
              <Upload size={22} />
              <span>Upload Smart Meter Texas CSV</span>
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (file) void loadUsageFile(file)
                  event.currentTarget.value = ''
                }}
              />
            </label>
          </section>

          <section className="panel">
            <div className="panel-title">
              <Search size={18} />
              <h2>PowerToChoose</h2>
            </div>
            <div className="zip-row">
              <input
                inputMode="numeric"
                maxLength={5}
                placeholder="ZIP code"
                value={zipCode}
                onChange={(event) => setZipCode(event.target.value.replace(/\D/g, ''))}
              />
              <button type="button" onClick={() => void fetchPowerToChoosePlans()}>
                {isFetching ? <LoaderCircle className="spin" size={18} /> : <Search size={18} />}
                Fetch
              </button>
            </div>
            <p className="hint">{ptcPlans.length.toLocaleString()} live listing(s) loaded.</p>
          </section>

          <section className="panel">
            <div className="panel-title">
              <FileJson size={18} />
              <h2>Plan import</h2>
            </div>
            <label className="file-drop compact">
              <Upload size={20} />
              <span>Import plan JSON</span>
              <input
                type="file"
                accept=".json,application/json"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (file) void loadPlanFile(file)
                  event.currentTarget.value = ''
                }}
              />
            </label>
            <p className="hint">Fetched PowerToChoose plans automatically pull and parse EFLs.</p>
          </section>

          <section className="panel ev-panel">
            <div className="panel-title">
              <Car size={18} />
              <h2>Tesla EV</h2>
            </div>
            <div className="range-row">
              <label>
                Annual kWh
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  value={evAnnualKwh}
                  onChange={(event) => setEvAnnualKwh(Number(event.target.value))}
                />
              </label>
              <label>
                Vehicles
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={evVehicleCount}
                  onChange={(event) => setEvVehicleCount(Math.max(1, Number(event.target.value)))}
                />
              </label>
            </div>
            <label className="check-row">
              <input
                type="checkbox"
                checked={evAllEligible}
                onChange={(event) => setEvAllEligible(event.target.checked)}
              />
              Charging is midnight-noon
            </label>
            <button type="button" className="secondary-button" onClick={applyEvAssumption}>
              <BatteryCharging size={18} />
              Apply EV kWh
            </button>
            <label className="file-drop compact">
              <Upload size={18} />
              <span>Import EV CSV</span>
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (file) void loadEvChargingFile(file)
                  event.currentTarget.value = ''
                }}
              />
            </label>
            <button type="button" className="secondary-button" onClick={applyIntervalEstimate}>
              Estimate from intervals
            </button>
            <div className="button-row">
              <button type="button" className="secondary-button" onClick={() => void connectTesla()}>
                Connect Tesla
              </button>
              <button type="button" className="secondary-button" onClick={() => void fetchTeslaWallConnectorHistory()}>
                {isFetchingTesla ? <LoaderCircle className="spin" size={18} /> : <BatteryCharging size={18} />}
                Pull
              </button>
            </div>
            <p className="hint">
              {evProfile
                ? `${decimal(evProfile.eligibleKwh, 1)} eligible kWh loaded from ${evProfile.source}.`
                : 'Only identified Tesla charging kWh is discounted.'}
            </p>
          </section>

          <section className="panel filters">
            <div className="panel-title">
              <SlidersHorizontal size={18} />
              <h2>Criteria</h2>
            </div>
            <div className="range-row">
              <label>
                Min term
                <input
                  type="number"
                  min={1}
                  max={60}
                  value={filters.minTerm}
                  onChange={(event) =>
                    setFilters((current) => ({ ...current, minTerm: Number(event.target.value) }))
                  }
                />
              </label>
              <label>
                Max term
                <input
                  type="number"
                  min={1}
                  max={60}
                  value={filters.maxTerm}
                  onChange={(event) =>
                    setFilters((current) => ({ ...current, maxTerm: Number(event.target.value) }))
                  }
                />
              </label>
            </div>
            <label className="check-row">
              <input
                type="checkbox"
                checked={filters.allowTou}
                onChange={(event) =>
                  setFilters((current) => ({ ...current, allowTou: event.target.checked }))
                }
              />
              Allow time-of-use plans
            </label>
            <label className="check-row">
              <input
                type="checkbox"
                checked={filters.includePrepaid}
                onChange={(event) =>
                  setFilters((current) => ({ ...current, includePrepaid: event.target.checked }))
                }
              />
              Include prepaid
            </label>
            <label className="check-row">
              <input
                type="checkbox"
                checked={filters.hideMinimumUsage}
                onChange={(event) =>
                  setFilters((current) => ({
                    ...current,
                    hideMinimumUsage: event.target.checked,
                  }))
                }
              />
              Hide usage-credit/minimum plans
            </label>
          </section>
        </div>

        {error && (
          <div className="notice error">
            <AlertTriangle size={18} />
            {error}
          </div>
        )}
        <div className="notice">
          {status}
          {eflProgress && ` (${eflProgress.done}/${eflProgress.total})`}
        </div>
      </section>

      <section className="summary-grid">
        <article className="stat-tile">
          <span>Total usage</span>
          <strong>{usage ? `${decimal(usage.totalKwh, 0)} kWh` : '-'}</strong>
          <small>
            {usage?.firstDate && usage.lastDate
              ? `${usage.firstDate} to ${usage.lastDate}`
              : 'Upload interval data'}
          </small>
        </article>
        <article className="stat-tile">
          <span>Complete months</span>
          <strong>{usage?.monthCount ?? '-'}</strong>
          <small>
            {usage
              ? `${usage.excludedMonths.length} partial/extra month(s) omitted`
              : 'Partial months are omitted'}
          </small>
        </article>
        <article className="stat-tile">
          <span>Best annual estimate</span>
          <strong>{bestPlan ? money(bestPlan.annualCost) : '-'}</strong>
          <small>{bestPlan ? bestPlan.planName : 'No scored plans yet'}</small>
        </article>
        <article className="stat-tile">
          <span>Baseline difference</span>
          <strong>
            {bestPlan && baseline ? money(bestPlan.annualCost - baseline.annualCost) : '-'}
          </strong>
          <small>{baseline ? `vs. ${baseline.planName}` : 'Mark a custom plan as baseline'}</small>
        </article>
        <article className="stat-tile">
          <span>Eligible EV kWh</span>
          <strong>{evProfile ? decimal(evProfile.eligibleKwh, 0) : '-'}</strong>
          <small>
            {evProfile
              ? `${percent(evProfile.totalKwh > 0 ? evProfile.eligibleKwh / evProfile.totalKwh : 0)}% of EV kWh`
              : 'Import, connect, estimate, or apply an assumption'}
          </small>
        </article>
      </section>

      {usage && (
        <section className="analytics-grid">
          <article className="panel wide">
            <div className="panel-title">
              <Filter size={18} />
              <h2>Usage shape</h2>
            </div>
            <div className="bucket-row">
              {usage.buckets.map((bucket) => (
                <div className="bucket" key={bucket.key}>
                  <span>{bucket.label}</span>
                  <div className="bar">
                    <i style={{ width: `${Math.min(bucket.share * 100, 100)}%` }} />
                  </div>
                  <strong>{decimal(bucket.share * 100, 1)}%</strong>
                </div>
              ))}
            </div>
          </article>
          <article className="panel wide">
            <div className="panel-title">
              <FileSpreadsheet size={18} />
              <h2>Monthly kWh</h2>
            </div>
            <div className="month-bars">
              {usage.monthly.map((month) => {
                const max = Math.max(...usage.monthly.map((item) => item.kwh))
                return (
                  <div className="month-bar" key={month.month}>
                    <span>{month.month}</span>
                    <i style={{ height: `${(month.kwh / max) * 100}%` }} />
                    <strong>{decimal(month.kwh, 0)}</strong>
                  </div>
                )
              })}
            </div>
          </article>
        </section>
      )}

      <section className="results-card">
        <div className="results-header">
          <div>
            <p className="eyebrow">Ranked results</p>
            <h2>{evaluatedPlans.length.toLocaleString()} plan(s) scored</h2>
          </div>
          <p>
            Exact rows use EFL rules. PowerToChoose rows use the published average-price curve and
            should be checked against the EFL before enrollment.
          </p>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Rank</th>
                <th>Plan</th>
                <th>Term</th>
                <th>Annual cost</th>
                <th>Avg rate</th>
                <th>Method</th>
                <th>Flags</th>
              </tr>
            </thead>
            <tbody>
              {evaluatedPlans.map((plan, index) => (
                <tr key={plan.id}>
                  <td>{index + 1}</td>
                  <td>
                    <strong>{plan.planName}</strong>
                    <span>{plan.provider}</span>
                    {plan.source === 'ptc' && plan.factSheetUrl && (
                      <a href={plan.factSheetUrl} target="_blank" rel="noreferrer">
                        <LinkIcon size={14} />
                        EFL
                      </a>
                    )}
                  </td>
                  <td>{plan.termMonths ? `${plan.termMonths} mo` : '-'}</td>
                  <td>{money(plan.annualCost)}</td>
                  <td>{decimal(plan.averageCentsPerKwh, 2)} c/kWh</td>
                  <td>{plan.estimateMethod === 'efl-rules' ? 'EFL rules' : 'PTC curve'}</td>
                  <td>
                    <div className="flag-list">
                      {plan.source === 'efl' && plan.isBaseline && <span>Baseline</span>}
                      {plan.timeOfUse && <span>TOU</span>}
                      {plan.minimumUsage && <span>Usage rule</span>}
                      {plan.warnings.length > 0 && <span title={plan.warnings.join(' ')}>Review</span>}
                    </div>
                  </td>
                </tr>
              ))}
              {!evaluatedPlans.length && (
                <tr>
                  <td colSpan={7} className="empty-state">
                    Upload usage and fetch or import plans to score results.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  )
}

export default App
