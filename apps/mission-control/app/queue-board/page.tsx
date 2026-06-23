'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import type { FleetResponse, FleetProject } from '../api/fleet/route'
import { useFreshness } from '../../lib/useFreshness'
import FreshnessBadge from '../../components/FreshnessBadge'

interface Row {
  slug: string
  queued: number
  breakerOpen: boolean
  state: string
  platform: string
}

// Runtime-state color, matching the palette used across the fleet views.
function stateColor(s: string): string {
  switch (s) {
    case 'active': return '#34d399'
    case 'autonomous': return '#22d3ee'
    case 'stalled': return '#ef4444'
    case 'idle': return '#64748b'
    default: return '#94a3b8'
  }
}

const TRACK_W = 100 // SVG user units
const TRACK_H = 14

function QueueRow({ r, maxQueued }: { r: Row; maxQueued: number }) {
  // Bar length ∝ queued count, normalized against the busiest project (min 1 to avoid /0).
  const fillW = Math.min(1, r.queued / Math.max(1, maxQueued)) * TRACK_W
  const c = r.breakerOpen ? '#ef4444' : stateColor(r.state)
  return (
    <Link href={`/focus/${encodeURIComponent(r.slug)}`} className="group block">
      <div className="flex items-center gap-3 py-1.5 px-2 rounded-lg transition-colors group-hover:bg-cyber-cyan/[0.04]">
        <div className="w-32 shrink-0 flex items-center gap-2 min-w-0">
          <span className="text-[0.7rem] font-bold text-slate-200 truncate" style={{ fontFamily: 'Orbitron, monospace' }}>{r.slug}</span>
        </div>
        <div className="flex-1 min-w-0">
          <svg viewBox={`0 0 ${TRACK_W} ${TRACK_H}`} width="100%" height={TRACK_H} preserveAspectRatio="none">
            <rect x={0} y={TRACK_H / 2 - 4} width={TRACK_W} height={8} rx={2} fill="#1e293b" />
            {r.queued > 0 && <rect x={0} y={TRACK_H / 2 - 4} width={fillW} height={8} rx={2} fill={c} />}
          </svg>
        </div>
        {r.breakerOpen && (
          <span className="shrink-0 text-[0.5rem] font-black tracking-wider px-1.5 py-0.5 rounded animate-pulse" style={{ background: 'rgba(239,68,68,0.15)', color: '#ef4444', fontFamily: 'Orbitron, monospace' }}>
            BREAKER OPEN
          </span>
        )}
        <div className="w-12 shrink-0 text-right text-[0.7rem] font-black tabular-nums" style={{ fontFamily: 'Orbitron, monospace', color: r.queued > 0 ? c : '#475569' }}>{r.queued}</div>
        <div className="w-20 shrink-0 text-right text-[0.55rem] font-mono uppercase tracking-wider" style={{ color: stateColor(r.state) }}>{r.state}</div>
        <div className="w-16 shrink-0 text-right text-[0.5rem] font-mono text-slate-600">{r.platform}</div>
      </div>
    </Link>
  )
}

export default function QueueBoardPage() {
  const { data, isStale, lastError, lastSuccessAt } = useFreshness<FleetResponse>('/api/fleet', 60_000)
  const loading = data === null && lastError === null

  const rows: Row[] = useMemo(() => {
    const projects = (data?.projects ?? []) as FleetProject[]
    return projects
      .filter((p) => (p.queuedCount ?? 0) > 0 || p.circuitOpen === true)
      .map((p) => ({
        slug: p.slug,
        queued: p.queuedCount ?? 0,
        breakerOpen: p.circuitOpen === true,
        state: p.state,
        platform: p.platform ?? 'discord',
      }))
      // Open breakers first; then by queue depth desc.
      .sort((a, b) => {
        if (a.breakerOpen !== b.breakerOpen) return a.breakerOpen ? -1 : 1
        return b.queued - a.queued
      })
  }, [data])

  const totals = useMemo(() => {
    const queued = rows.reduce((s, r) => s + r.queued, 0)
    const breakers = rows.filter((r) => r.breakerOpen).length
    const maxQueued = rows.reduce((m, r) => Math.max(m, r.queued), 0)
    return { queued, breakers, maxQueued }
  }, [rows])

  if (loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center" style={{ background: '#060d1a' }}>
        <div className="text-xs font-mono text-slate-600 animate-pulse">Scanning inbound queues…</div>
      </div>
    )
  }

  return (
    <div className="min-h-dvh flex flex-col" style={{ background: '#060d1a' }}>
      <header className="sticky top-0 z-30 border-b border-cyber-cyan/12 bg-[#060d1a]/90 backdrop-blur-md px-6 py-3">
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-cyber-cyan/40 to-transparent" />
        <div className="flex items-center gap-3 flex-wrap">
          <Link href="/" className="text-[0.6rem] font-mono text-slate-500 hover:text-cyber-cyan transition-colors uppercase tracking-wider">← Dashboard</Link>
          <h1 className="text-sm font-black tracking-[0.18em] text-cyber-cyan" style={{ fontFamily: 'Orbitron, JetBrains Mono, monospace' }}>
            Inbound Queue &amp; Circuit Board
          </h1>
          <span className="text-[0.6rem] font-mono text-slate-500 border border-slate-700 px-2 py-0.5 rounded">which channels are backing up or breaker-tripped</span>
          <FreshnessBadge isStale={isStale} lastError={lastError} lastSuccessAt={lastSuccessAt} />
          <div className="flex-1" />
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5">
              <span className="text-[0.55rem] font-mono text-slate-500 uppercase tracking-wider">queued</span>
              <span className="text-lg font-black tabular-nums text-cyber-cyan" style={{ fontFamily: 'Orbitron, monospace' }}>{totals.queued}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[0.55rem] font-mono text-slate-500 uppercase tracking-wider">breakers</span>
              <span className="text-lg font-black tabular-nums" style={{ fontFamily: 'Orbitron, monospace', color: totals.breakers > 0 ? '#ef4444' : '#475569' }}>{totals.breakers}</span>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 p-6 max-w-5xl mx-auto w-full">
        {rows.length === 0 ? (
          <div className="h-64 flex items-center justify-center text-slate-600 text-xs font-mono">No backlog — every inbound queue is empty and all breakers are closed.</div>
        ) : (
          <>
            <div className="rounded-xl border border-cyber-cyan/12 p-3" style={{ background: 'rgba(0,245,255,0.02)' }}>
              {rows.map((r) => <QueueRow key={r.slug} r={r} maxQueued={totals.maxQueued} />)}
            </div>

            <div className="mt-6 flex items-center gap-4 text-[0.55rem] font-mono text-slate-500 flex-wrap">
              <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded-sm animate-pulse" style={{ background: '#ef4444' }} />breaker open (sorts first)</span>
              <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded-sm" style={{ background: '#34d399' }} />active</span>
              <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded-sm" style={{ background: '#22d3ee' }} />autonomous</span>
              <span className="text-slate-600">· bar length ∝ queued count</span>
            </div>
          </>
        )}

        <p className="text-[0.5rem] font-mono text-slate-700 mt-4">
          One row per project with <code>queuedCount &gt; 0</code> or <code>circuitOpen</code>. Bar length ∝ queued
          message count (normalized to the busiest project). Projects with an open circuit breaker show a pulsing
          badge and sort above all others; remaining rows sort by queue depth descending. Click a row to open its
          Focus view. Reuses <code>/api/fleet</code>. Refreshes every 60s.
        </p>
      </main>
    </div>
  )
}
