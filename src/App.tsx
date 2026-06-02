import {
  AlertTriangle,
  Download,
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
import './App.css'
import { exampleEflPlans } from './data/examplePlans'
import { parseSmartMeterTexasCsv } from './lib/csv'
import { evaluatePlan, mapCustomPlans, mapPowerToChoosePlans, parsePlanImport } from './lib/plans'
import { summarizeUsage } from './lib/usage'
import type { CustomEflPlan, EvaluatedPlan, PowerToChoosePlan, UsageInterval } from './lib/types'

const sampleUsageCsv = `ESIID,USAGE_DATE,REVISION_DATE,USAGE_START_TIME,USAGE_END_TIME,USAGE_KWH,ESTIMATED_ACTUAL,CONSUMPTION_SURPLUSGENERATION
'00000000000000000,01/01/2026,01/02/2026 07:00:00,00:00,00:15,0.82,A,Consumption
'00000000000000000,01/01/2026,01/02/2026 07:00:00,00:15,00:30,0.79,A,Consumption
'00000000000000000,01/01/2026,01/02/2026 07:00:00,16:00,16:15,1.44,A,Consumption
'00000000000000000,01/01/2026,01/02/2026 07:00:00,16:15,16:30,1.51,A,Consumption
'00000000000000000,02/01/2026,02/02/2026 07:00:00,00:00,00:15,0.64,A,Consumption
'00000000000000000,02/01/2026,02/02/2026 07:00:00,16:00,16:15,1.08,A,Consumption
'00000000000000000,03/01/2026,03/02/2026 07:00:00,00:00,00:15,0.55,A,Consumption
'00000000000000000,03/01/2026,03/02/2026 07:00:00,16:00,16:15,0.92,A,Consumption`

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

function downloadJson(filename: string, payload: unknown) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }),
  )
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
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

function App() {
  const [usageIntervals, setUsageIntervals] = useState<UsageInterval[]>([])
  const [ptcPlans, setPtcPlans] = useState<PowerToChoosePlan[]>([])
  const [customPlans, setCustomPlans] = useState<CustomEflPlan[]>(exampleEflPlans)
  const [zipCode, setZipCode] = useState('')
  const [filters, setFilters] = useState<Filters>(defaultFilters)
  const [status, setStatus] = useState('Upload Smart Meter Texas interval data to start.')
  const [error, setError] = useState('')
  const [isFetching, setIsFetching] = useState(false)

  const usage = useMemo(
    () => (usageIntervals.length ? summarizeUsage(usageIntervals) : undefined),
    [usageIntervals],
  )

  const evaluatedPlans = useMemo(() => {
    if (!usage) return []
    return [...mapCustomPlans(customPlans), ...mapPowerToChoosePlans(ptcPlans)]
      .map((plan) => evaluatePlan(plan, usage.monthly))
      .filter((plan) => filterPlan(plan, filters))
      .sort((a, b) => a.annualCost - b.annualCost)
  }, [customPlans, filters, ptcPlans, usage])

  const baseline = evaluatedPlans.find((plan) => plan.source === 'efl' && plan.isBaseline)
  const bestPlan = evaluatedPlans[0]

  async function loadUsageFile(file: File) {
    setError('')
    try {
      const text = await file.text()
      const intervals = parseSmartMeterTexasCsv(text)
      setUsageIntervals(intervals)
      setStatus(`Loaded ${intervals.length.toLocaleString()} interval rows from ${file.name}.`)
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : 'Could not parse usage CSV.')
    }
  }

  async function loadPlanFile(file: File) {
    setError('')
    try {
      const text = await file.text()
      const imported = parsePlanImport(text)
      setPtcPlans(imported.ptc.length ? imported.ptc : ptcPlans)
      setCustomPlans(imported.custom.length ? imported.custom : customPlans)
      setStatus(
        `Imported ${imported.ptc.length.toLocaleString()} PowerToChoose plan(s) and ${imported.custom.length.toLocaleString()} custom EFL plan(s).`,
      )
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : 'Could not parse plan JSON.')
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
      const ptcBase =
        window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
          ? '/ptc-api'
          : 'https://texas-electric-plan-finder-ptc.joshua-s-warren.workers.dev'
      const response = await fetch(`${ptcBase}/api/PowerToChoose/plans?zip_code=${zipCode}`)
      const payload = await response.json()
      const plans = extractPowerToChoosePlans(payload)
      if (!plans.length) {
        throw new Error(payload.message || 'PowerToChoose did not return plan data.')
      }
      setPtcPlans(plans)
      setStatus(`Fetched ${plans.length.toLocaleString()} PowerToChoose plans for ${zipCode}.`)
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
                }}
              />
            </label>
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                const intervals = parseSmartMeterTexasCsv(sampleUsageCsv)
                setUsageIntervals(intervals)
                setStatus('Loaded a tiny anonymized sample usage file.')
              }}
            >
              Load sample
            </button>
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
              <h2>EFL plans</h2>
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
                }}
              />
            </label>
            <button
              type="button"
              className="secondary-button"
              onClick={() => downloadJson('example-efl-plans.json', { custom: customPlans })}
            >
              <Download size={16} />
              Export examples
            </button>
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
        <div className="notice">{status}</div>
      </section>

      <section className="summary-grid">
        <article className="stat-tile">
          <span>Total usage</span>
          <strong>{usage ? `${decimal(usage.totalKwh, 0)} kWh` : '-'}</strong>
          <small>{usage ? `${usage.firstDate} to ${usage.lastDate}` : 'Upload interval data'}</small>
        </article>
        <article className="stat-tile">
          <span>Monthly samples</span>
          <strong>{usage?.monthCount ?? '-'}</strong>
          <small>{usage ? `${usage.intervalCount.toLocaleString()} intervals` : '15-minute rows'}</small>
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
