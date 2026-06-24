'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import { useFreshness } from '../../lib/useFreshness'
import FreshnessBadge from '../../components/FreshnessBadge'
import SubPageHeader from '../../components/SubPageHeader'
import type { AdvisorResponse, AdvisorCard } from '../api/advisor/route'
import type { BacklogResponse } from '../api/backlog/route'
import type { FleetResponse } from '../api/fleet/route'
import type { MemoryHealthResponse } from '../api/memory-health/route'

// P216 — Fleet Command Bridge (Situational Overview).
// Fuses the top signal from each domain (attention, proposals, runtime, memory)
// into one grid of compact panels. Each panel reuses an existing API and
// deep-links to its full view. Panels reorder so the most urgent floats up.

const SEV_COLOR: Record<string, string> = { critical: '#f87171', warn: '#fbbf24', info: '#22D3EE' }

interface Panel {
  key: string
  title: string
  icon: string
  href: string
  urgency: number // higher = more critical → floats to top
  headline: string
  tone: 'critical' | 'warn' | 'ok'
  items: { label: string; meta?: string; color?: string }[]
  empty: string
}

const TONE_COLOR: Record<Panel['tone'], string> = { critical: '#f87171', warn: '#fbbf24', ok: '#34d399' }

function daysSince(iso: string | null): number | null {
  if (!iso) return null
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return null
  return Math.floor((Date.now() - ms) / 86_400_000)
}

export default function CommandBridgePage() {
  const advisor = useFreshness<AdvisorResponse>('/api/advisor', 30_000)
  const backlog = useFreshness<BacklogResponse>('/api/backlog', 30_000)
  const fleet = useFreshness<FleetResponse>('/api/fleet', 30_000)
  const memory = useFreshness<MemoryHealthResponse>('/api/memory-health', 60_000)

  const loading =
    advisor.data === null && backlog.data === null && fleet.data === null && memory.data === null &&
    !advisor.lastError && !backlog.lastError && !fleet.lastError && !memory.lastError

  const isStale = advisor.isStale || backlog.isStale || fleet.isStale || memory.isStale
  const lastError = advisor.lastError ?? backlog.lastError ?? fleet.lastError ?? memory.lastError
  const lastSuccessAt = Math.max(
    advisor.lastSuccessAt ?? 0, backlog.lastSuccessAt ?? 0, fleet.lastSuccessAt ?? 0, memory.lastSuccessAt ?? 0,
  ) || null

  const panels = useMemo<Panel[]>(() => {
    const out: Panel[] = []

    // ── Attention (advisor) ──────────────────────────────────────────────
    {
      const cards: AdvisorCard[] = advisor.data?.recommendations ?? []
      const crit = cards.filter((c) => c.severity === 'critical').length
      const warn = cards.filter((c) => c.severity === 'warn').length
      out.push({
        key: 'attention',
        title: 'Attention',
        icon: '◆',
        href: '/advisor',
        urgency: crit * 100 + warn * 10 + cards.length,
        headline: cards.length === 0 ? 'all clear' : `${cards.length} recommendation${cards.length === 1 ? '' : 's'}`,
        tone: crit > 0 ? 'critical' : warn > 0 ? 'warn' : 'ok',
        items: cards.slice(0, 3).map((c) => ({
          label: c.title,
          meta: c.slug,
          color: SEV_COLOR[c.severity],
        })),
        empty: 'No advisor recommendations — fleet nominal.',
      })
    }

    // ── Proposals (backlog) ──────────────────────────────────────────────
    {
      const projects = backlog.data?.projects ?? []
      const totalPending = projects.reduce((s, p) => s + p.pendingCount, 0)
      let oldestDays: number | null = null
      for (const p of projects) {
        for (const it of p.items) {
          if (it.status !== 'pending') continue
          const d = daysSince(it.createdAt)
          if (d !== null && (oldestDays === null || d > oldestDays)) oldestDays = d
        }
      }
      const withPending = projects.filter((p) => p.pendingCount > 0)
      out.push({
        key: 'proposals',
        title: 'Proposals',
        icon: '◳',
        href: '/backlog',
        urgency: totalPending * 2 + (oldestDays !== null && oldestDays > 14 ? 80 : oldestDays !== null && oldestDays > 7 ? 30 : 0),
        headline: totalPending === 0 ? 'queue empty' : `${totalPending} pending${oldestDays !== null ? ` · oldest ${oldestDays}d` : ''}`,
        tone: oldestDays !== null && oldestDays > 14 ? 'warn' : totalPending > 0 ? 'warn' : 'ok',
        items: withPending.slice(0, 3).map((p) => ({ label: p.slug, meta: `${p.pendingCount} pending` })),
        empty: 'No pending proposals across the fleet.',
      })
    }

    // ── Runtime / stalls (fleet) ─────────────────────────────────────────
    {
      const projects = fleet.data?.projects ?? []
      const stalled = projects.filter((p) => p.state === 'stalled')
      const circuit = projects.filter((p) => p.circuitOpen)
      const flagged = [...new Set([...stalled, ...circuit])]
      out.push({
        key: 'runtime',
        title: 'Runtime',
        icon: '⏱',
        href: '/idle-fleet',
        urgency: stalled.length * 60 + circuit.length * 90,
        headline: flagged.length === 0 ? 'all healthy' : `${stalled.length} stalled · ${circuit.length} breaker open`,
        tone: circuit.length > 0 ? 'critical' : stalled.length > 0 ? 'warn' : 'ok',
        items: flagged.slice(0, 3).map((p) => ({
          label: p.slug,
          meta: p.circuitOpen ? 'breaker open' : `${p.state} · ${p.ageMins}m`,
          color: p.circuitOpen ? SEV_COLOR.critical : SEV_COLOR.warn,
        })),
        empty: 'No stalled projects or open circuit breakers.',
      })
    }

    // ── Memory health ────────────────────────────────────────────────────
    {
      const projects = memory.data?.projects ?? []
      const red = projects.filter((p) => p.color === 'red')
      const amber = projects.filter((p) => p.color === 'amber')
      // Stalest = lowest composite first.
      const stalest = [...projects].sort((a, b) => a.composite - b.composite).filter((p) => p.color !== 'green')
      out.push({
        key: 'memory',
        title: 'Memory',
        icon: '◑',
        href: '/memory-health',
        urgency: red.length * 50 + amber.length * 8,
        headline: red.length === 0 && amber.length === 0 ? 'healthy' : `${red.length} red · ${amber.length} amber`,
        tone: red.length > 0 ? 'critical' : amber.length > 0 ? 'warn' : 'ok',
        items: stalest.slice(0, 3).map((p) => ({
          label: p.slug,
          meta: `score ${p.composite} · ${p.lastModifiedDaysAgo}d`,
          color: p.color === 'red' ? SEV_COLOR.critical : SEV_COLOR.warn,
        })),
        empty: 'Fleet memory is fresh and well-covered.',
      })
    }

    return out.sort((a, b) => b.urgency - a.urgency)
  }, [advisor.data, backlog.data, fleet.data, memory.data])

  if (loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center" style={{ background: '#060d1a' }}>
        <div className="text-xs font-mono text-slate-600 animate-pulse">Loading command bridge…</div>
      </div>
    )
  }

  return (
    <div className="min-h-dvh flex flex-col" style={{ background: '#060d1a' }}>
      <SubPageHeader title="Fleet Command Bridge">
        <FreshnessBadge isStale={isStale} lastError={lastError} lastSuccessAt={lastSuccessAt} />
      </SubPageHeader>

      <main className="flex-1 p-6 max-w-7xl mx-auto w-full">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {panels.map((p) => (
            <Link key={p.key} href={p.href}
              className="group rounded-xl border p-4 transition-colors hover:bg-white/[0.03]"
              style={{ borderColor: `${TONE_COLOR[p.tone]}33`, background: `${TONE_COLOR[p.tone]}08` }}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-base" style={{ color: TONE_COLOR[p.tone] }}>{p.icon}</span>
                  <span className="text-xs font-mono font-bold uppercase tracking-wider text-slate-300">{p.title}</span>
                </div>
                <span className="text-[0.6rem] font-mono px-1.5 py-0.5 rounded uppercase tracking-wider"
                  style={{ color: TONE_COLOR[p.tone], border: `1px solid ${TONE_COLOR[p.tone]}40` }}>
                  {p.headline}
                </span>
              </div>
              {p.items.length === 0 ? (
                <div className="text-[0.6rem] font-mono text-slate-600 py-2">{p.empty}</div>
              ) : (
                <ul className="flex flex-col gap-1.5 mt-2">
                  {p.items.map((it, i) => (
                    <li key={i} className="flex items-center justify-between gap-2 text-[0.65rem] font-mono">
                      <span className="flex items-center gap-1.5 min-w-0">
                        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: it.color ?? '#64748b' }} />
                        <span className="text-slate-300 truncate">{it.label}</span>
                      </span>
                      {it.meta && <span className="text-slate-500 shrink-0 tabular-nums">{it.meta}</span>}
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-3 text-[0.55rem] font-mono text-slate-600 group-hover:text-cyber-cyan transition-colors">
                open {p.title.toLowerCase()} →
              </div>
            </Link>
          ))}
        </div>

        <p className="text-[0.5rem] font-mono text-slate-700 mt-5 max-w-3xl">
          Situational overview (P216). Fuses the top signals from four domains —
          <span style={{ color: SEV_COLOR.info }}> attention</span> (<code>/api/advisor</code>),
          proposals (<code>/api/backlog</code>), runtime stalls (<code>/api/fleet</code>), and
          memory health (<code>/api/memory-health</code>) — into one bridge. Panels reorder by urgency so the
          most critical domain floats to the top; each deep-links to its full view. Refreshes every 30s.
        </p>
      </main>
    </div>
  )
}
