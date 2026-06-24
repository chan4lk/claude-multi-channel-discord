import { NextRequest } from 'next/server'
import type { FleetResponse } from '../fleet/route'
import type { BurnupResponse } from '../burnup/route'

export const dynamic = 'force-dynamic'

export type MetricHealth = 'good' | 'warn' | 'bad' | 'neutral'

export interface MarqueeMetric {
  key: string
  label: string
  value: string
  health: MetricHealth
}

export interface MarqueeResponse {
  metrics: MarqueeMetric[]
  generatedAt: string
}

async function fetchJson<T>(req: NextRequest, path: string): Promise<T | null> {
  try {
    const res = await fetch(new URL(path, req.url), { cache: 'no-store' })
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  }
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(Math.round(n))
}

export async function GET(req: NextRequest): Promise<Response> {
  const [fleet, burnRate, burnup, alerts] = await Promise.all([
    fetchJson<FleetResponse>(req, '/api/fleet'),
    fetchJson<{ tokensPerMin: number; activeProjects: number }>(req, '/api/burn-rate'),
    fetchJson<BurnupResponse>(req, '/api/burnup'),
    fetchJson<{ alerts: unknown[] }>(req, '/api/alerts'),
  ])

  const projectCount = fleet?.projects.length ?? 0
  const stalled = fleet?.stalled ?? 0
  const avgConv = fleet?.avgConvergence
  const openAlerts = alerts?.alerts.length ?? 0
  const tokensPerMin = burnRate?.tokensPerMin ?? 0

  // Proposals shipped in the trailing 7 days, from the burnup daily series.
  let shippedThisWeek = 0
  const series = burnup?.series ?? []
  if (series.length > 0) {
    const last = series[series.length - 1]
    const weekAgo = series[Math.max(0, series.length - 8)]
    shippedThisWeek = last.completed - weekAgo.completed
  }

  const convHealth: MetricHealth =
    avgConv == null ? 'neutral' : avgConv >= 0.66 ? 'good' : avgConv >= 0.4 ? 'warn' : 'bad'

  const metrics: MarqueeMetric[] = [
    { key: 'projects', label: 'Projects', value: String(projectCount), health: 'neutral' },
    {
      key: 'convergence', label: 'Mean Convergence',
      value: avgConv == null ? '—' : `${Math.round(avgConv * 100)}%`,
      health: convHealth,
    },
    {
      key: 'alerts', label: 'Open Alerts', value: String(openAlerts),
      health: openAlerts === 0 ? 'good' : openAlerts >= 5 ? 'bad' : 'warn',
    },
    {
      key: 'stalled', label: 'Stalled', value: String(stalled),
      health: stalled === 0 ? 'good' : stalled >= 3 ? 'bad' : 'warn',
    },
    {
      key: 'burn', label: 'Token Burn / min', value: fmtTokens(tokensPerMin),
      health: tokensPerMin > 0 ? 'good' : 'neutral',
    },
    {
      key: 'shipped', label: 'Shipped · 7d', value: String(shippedThisWeek),
      health: shippedThisWeek > 0 ? 'good' : 'neutral',
    },
  ]

  return Response.json({ metrics, generatedAt: new Date().toISOString() } satisfies MarqueeResponse)
}
