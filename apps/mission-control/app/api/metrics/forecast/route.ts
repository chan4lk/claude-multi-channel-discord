import { GET as burndownGET, type BurndownResponse, type BurndownPoint } from '../burndown/route'

export const dynamic = 'force-dynamic'

export interface ForecastScenario {
  name: 'pessimistic' | 'expected' | 'optimistic'
  rate: number          // proposals completed per day
  projectedDone: string | null
}

export interface ForecastBandPoint {
  date: string
  low: number           // remaining under the optimistic (fastest) ray
  high: number          // remaining under the pessimistic (slowest) ray
}

export interface ForecastResponse {
  history: BurndownPoint[]
  scenarios: ForecastScenario[]
  band: ForecastBandPoint[]
  remaining: number
  velocityPerWeek: number
  generatedAt: string
}

function dayString(d: Date): string {
  return d.toISOString().slice(0, 10)
}

// All positive 7-day completion rates across the series (done is cumulative).
function sevenDayRates(series: BurndownPoint[]): number[] {
  const rates: number[] = []
  for (let i = 7; i < series.length; i++) {
    const delta = series[i].done - series[i - 7].done
    rates.push(delta / 7)
  }
  return rates
}

function projectDate(today: string, remaining: number, rate: number): string | null {
  if (rate <= 0 || remaining <= 0) return null
  const daysLeft = Math.ceil(remaining / rate)
  const d = new Date(today + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + daysLeft)
  return dayString(d)
}

export async function GET(): Promise<Response> {
  const res = await burndownGET()
  let burndown: BurndownResponse
  try {
    burndown = await res.json() as BurndownResponse
  } catch {
    return Response.json({ error: 'burndown unavailable' }, { status: 502 })
  }

  const series = burndown.series ?? []
  const remaining = burndown.totals?.remaining ?? 0
  const today = series.length ? series[series.length - 1].date : dayString(new Date())

  // Historical 7-day rates → pessimistic (slowest positive) / optimistic (fastest).
  const rates = sevenDayRates(series).filter((r) => r >= 0)
  const positive = rates.filter((r) => r > 0)
  const optimisticRate = positive.length ? Math.max(...positive) : 0
  const pessimisticRate = positive.length ? Math.min(...positive) : 0

  // Expected = trailing 14-day mean completion rate.
  let expectedRate = 0
  if (series.length >= 2) {
    const window = series.slice(-15) // 14-day delta
    const delta = window[window.length - 1].done - window[0].done
    expectedRate = delta / Math.max(1, window.length - 1)
  }

  const scenarios: ForecastScenario[] = [
    { name: 'pessimistic', rate: round2(pessimisticRate), projectedDone: projectDate(today, remaining, pessimisticRate) },
    { name: 'expected', rate: round2(expectedRate), projectedDone: projectDate(today, remaining, expectedRate) },
    { name: 'optimistic', rate: round2(optimisticRate), projectedDone: projectDate(today, remaining, optimisticRate) },
  ]

  // Fan-chart band: forward days until the slowest (pessimistic) ray clears, capped at 180d.
  const band: ForecastBandPoint[] = []
  if (remaining > 0) {
    const maxDays = pessimisticRate > 0 ? Math.min(180, Math.ceil(remaining / pessimisticRate)) : 90
    for (let d = 0; d <= maxDays; d++) {
      const date = new Date(today + 'T00:00:00Z')
      date.setUTCDate(date.getUTCDate() + d)
      const low = Math.max(0, remaining - optimisticRate * d)   // clears fastest → lower remaining
      const high = Math.max(0, remaining - pessimisticRate * d) // clears slowest → higher remaining
      band.push({ date: dayString(date), low: round2(low), high: round2(high) })
    }
  }

  return Response.json({
    history: series,
    scenarios,
    band,
    remaining,
    velocityPerWeek: round2(expectedRate * 7),
    generatedAt: new Date().toISOString(),
  } satisfies ForecastResponse)
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
