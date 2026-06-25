import { NextRequest } from 'next/server'
import { getEvents } from '../../../src/db'

export const dynamic = 'force-dynamic'

export interface KillCircuitEvent {
  killTs: string
  slug: string
  lastToolCall: string | null
  circuitOpenTs: string | null
  circuitOpenMs: number | null
}

export interface KillCircuitResponse {
  events: KillCircuitEvent[]
  slugs: string[]
  totalKills: number
  killsThatTripped: number
  killsThatTrippedPct: number
  avgKillToTripMs: number | null
  computedAt: string
}

const CORRELATION_WINDOW_MS = 5 * 60 * 1000 // 5 minutes

export async function GET(req: NextRequest): Promise<Response> {
  const url = new URL(req.url)
  const filterSlug = url.searchParams.get('slug') ?? undefined
  const windowDays = Math.max(1, Math.min(90, parseInt(url.searchParams.get('days') ?? '30', 10)))
  const since = new Date(Date.now() - windowDays * 24 * 3_600_000).toISOString()

  // Pull watchdog kills
  const killRows = getEvents({
    type: 'session_killed_watchdog',
    slug: filterSlug,
    since,
    limit: 500,
  })

  // Pull circuit opens
  const circuitRows = getEvents({
    type: 'circuit_open',
    slug: filterSlug,
    since,
    limit: 500,
  })

  // Index circuit opens by slug → sorted array of timestamps
  const circuitBySlug = new Map<string, string[]>()
  for (const row of circuitRows) {
    let p: Record<string, unknown>
    try { p = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload } catch { continue }
    const slug = (p.slug as string | undefined) ?? ''
    if (!slug) continue
    const arr = circuitBySlug.get(slug) ?? []
    arr.push(row.ts)
    circuitBySlug.set(slug, arr)
  }
  // Sort ascending
  for (const [, arr] of circuitBySlug) arr.sort()

  const events: KillCircuitEvent[] = []
  const slugSet = new Set<string>()

  for (const row of killRows) {
    let p: Record<string, unknown>
    try { p = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload } catch { continue }
    const slug = (p.slug as string | undefined) ?? ''
    if (!slug) continue
    slugSet.add(slug)

    const killTs = row.ts
    const killMs = Date.parse(killTs)
    const lastToolCall = (p.lastToolCall as string | undefined) ?? null

    // Find first circuit_open for this slug within 5 min after kill
    let circuitOpenTs: string | null = null
    let circuitOpenMs: number | null = null
    const circ = circuitBySlug.get(slug) ?? []
    for (const ct of circ) {
      const ctMs = Date.parse(ct)
      if (ctMs >= killMs && ctMs <= killMs + CORRELATION_WINDOW_MS) {
        circuitOpenTs = ct
        circuitOpenMs = ctMs - killMs
        break
      }
    }

    events.push({ killTs, slug, lastToolCall, circuitOpenTs, circuitOpenMs })
  }

  // Sort newest first
  events.sort((a, b) => Date.parse(b.killTs) - Date.parse(a.killTs))

  const tripped = events.filter((e) => e.circuitOpenTs !== null)
  const latencies = tripped.map((e) => e.circuitOpenMs!).filter((v) => v !== null)
  const avgMs = latencies.length > 0 ? Math.round(latencies.reduce((s, v) => s + v, 0) / latencies.length) : null

  return Response.json({
    events,
    slugs: Array.from(slugSet).sort(),
    totalKills: events.length,
    killsThatTripped: tripped.length,
    killsThatTrippedPct: events.length > 0 ? Math.round((tripped.length / events.length) * 100) : 0,
    avgKillToTripMs: avgMs,
    computedAt: new Date().toISOString(),
  } satisfies KillCircuitResponse)
}
