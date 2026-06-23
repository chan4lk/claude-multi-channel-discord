import { NextRequest } from 'next/server'
import { getTurnQuality, getAlertEvents } from '../../../src/db'
import type { FleetResponse, FleetProject, ProjectState } from '../fleet/route'

export const dynamic = 'force-dynamic'

/**
 * P148 — Predictive Stall Forecaster.
 *
 * Computes a forward-looking stall risk score (0–100) per active project from
 * four heuristics, so operators can intervene BEFORE the reactive Stall Alert
 * Panel (P3) fires:
 *   1. context pressure   (30%) — high / rising-fast context usage
 *   2. turn quality trend (30%) — quality falling over recent turns
 *   3. recency            (25%) — time-since-reply approaching watchdog threshold
 *   4. kill history       (15%) — repeated stall/watchdog/circuit events in 24h
 *
 * Reuses /api/fleet (single source of truth for state, context %, age,
 * threshold) rather than re-deriving transcript stats here.
 */

export interface StallRiskProject {
  slug: string
  score: number
  factors: string[]
  state: ProjectState
}

export interface StallRiskResponse {
  projects: StallRiskProject[]
  computedAt: string
}

const clamp = (n: number): number => Math.max(0, Math.min(100, Math.round(n)))

interface Contribution {
  label: string
  risk: number
  weight: number
}

function contextRisk(p: FleetProject): Contribution {
  const pct = p.contextUsagePct ?? 0
  const eta = p.contextFillEtaMinutes
  const risingFast = eta != null && eta < 30
  const risk = clamp(pct + (risingFast ? 25 : 0))
  const label = risingFast
    ? `context at ${pct}%, filling in ~${eta}m`
    : `context at ${pct}%`
  return { label, risk, weight: 0.3 }
}

function qualityRisk(slug: string, qualityBySlug: Map<string, number[]>): Contribution | null {
  const scores = qualityBySlug.get(slug)
  if (!scores || scores.length === 0) return null // unknown — don't inflate
  const latest = scores[scores.length - 1]
  const recent = scores.slice(-3)
  const declining = recent.length >= 2 && recent[0] - recent[recent.length - 1] >= 10
  const risk = clamp(100 - latest + (declining ? 15 : 0))
  const label = declining ? `quality dropping (now ${latest})` : `turn quality ${latest}`
  return { label, risk, weight: 0.3 }
}

function recencyRisk(p: FleetProject): Contribution | null {
  // Only meaningful for projects that have been working recently.
  if (p.state === 'idle') return null
  const threshold = p.stuckThresholdMinutes || 5
  const risk = clamp((p.ageMins / threshold) * 100)
  return { label: `silent ${p.ageMins}m / ${threshold}m threshold`, risk, weight: 0.25 }
}

function historyRisk(slug: string): Contribution {
  const cutoff = Date.now() - 24 * 3_600_000
  const events = getAlertEvents({ slug, limit: 100 }).filter(
    (e) => e.ts >= cutoff && /stall|watchdog|circuit/i.test(e.alert_type),
  )
  const n = events.length
  const risk = n > 2 ? 100 : n === 2 ? 66 : n === 1 ? 33 : 0
  return { label: `${n} stall/kill event${n === 1 ? '' : 's'} in 24h`, risk, weight: 0.15 }
}

export async function GET(req: NextRequest): Promise<Response> {
  let fleet: FleetResponse
  try {
    const res = await fetch(new URL('/api/fleet', req.url), { cache: 'no-store' })
    fleet = (await res.json()) as FleetResponse
  } catch {
    return Response.json({ projects: [], computedAt: new Date().toISOString() } satisfies StallRiskResponse)
  }

  // Latest turn-quality score per slug, oldest→newest (getTurnQuality returns ASC by hour).
  const qualityBySlug = new Map<string, number[]>()
  for (const row of getTurnQuality(24)) {
    const arr = qualityBySlug.get(row.slug) ?? []
    arr.push(row.score)
    qualityBySlug.set(row.slug, arr)
  }

  const projects: StallRiskProject[] = []
  for (const p of fleet.projects) {
    if (p.slug === 'master') continue

    const contribs: Contribution[] = [contextRisk(p), historyRisk(p.slug)]
    const q = qualityRisk(p.slug, qualityBySlug)
    if (q) contribs.push(q)
    const r = recencyRisk(p)
    if (r) contribs.push(r)

    const score = clamp(contribs.reduce((sum, c) => sum + c.risk * c.weight, 0))

    // Surface the factors that actually move the needle, strongest first.
    const factors = contribs
      .map((c) => ({ ...c, contribution: c.risk * c.weight }))
      .filter((c) => c.contribution >= 8)
      .sort((a, b) => b.contribution - a.contribution)
      .map((c) => c.label)

    projects.push({ slug: p.slug, score, factors, state: p.state })
  }

  projects.sort((a, b) => b.score - a.score)

  return Response.json({ projects, computedAt: new Date().toISOString() } satisfies StallRiskResponse)
}
