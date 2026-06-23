'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import type { FleetResponse, FleetProject } from '../api/fleet/route'
import { useFreshness } from '../../lib/useFreshness'
import FreshnessBadge from '../../components/FreshnessBadge'

interface Row {
  slug: string
  age: number
  threshold: number
  frac: number // age / threshold
  remaining: number
  state: string
}

// Headroom band: green <60%, amber <85%, red ≥85% of the stuck threshold.
function bandColor(frac: number): string {
  if (frac >= 0.85) return '#ef4444'
  if (frac >= 0.6) return '#f59e0b'
  return '#34d399'
}

function fmtMins(n: number): string {
  if (n >= 60) return `${(n / 60).toFixed(1)}h`
  return `${Math.round(n)}m`
}

const TRACK_W = 100
const TRACK_H = 14

function HeadroomRow({ r }: { r: Row }) {
  const c = bandColor(r.frac)
  const fillW = Math.min(1, r.frac) * TRACK_W
  return (
    <Link href={`/focus/${encodeURIComponent(r.slug)}`} className="group block">
      <div className="flex items-center gap-3 py-1.5 px-2 rounded-lg transition-colors group-hover:bg-cyber-cyan/[0.04]">
        <div className="w-32 shrink-0 text-[0.7rem] font-bold text-slate-200 truncate" style={{ fontFamily: 'Orbitron, monospace' }}>{r.slug}</div>
        <div className="flex-1 min-w-0">
          <svg viewBox={`0 0 ${TRACK_W} ${TRACK_H}`} width="100%" height={TRACK_H} preserveAspectRatio="none">
            <rect x={0} y={TRACK_H / 2 - 4} width={TRACK_W} height={8} rx={2} fill="#1e293b" />
            <rect x={0} y={TRACK_H / 2 - 4} width={fillW} height={8} rx={2} fill={c} />
            {/* reap line at 100% */}
            <line x1={TRACK_W - 0.5} x2={TRACK_W - 0.5} y1={1} y2={TRACK_H - 1} stroke="#b91c1c" strokeWidth={1} />
          </svg>
        </div>
        <div className="w-14 shrink-0 text-right text-[0.7rem] font-black tabular-nums" style={{ fontFamily: 'Orbitron, monospace', color: c }}>{Math.round(r.frac * 100)}%</div>
        <div className="w-28 shrink-0 text-right text-[0.55rem] font-mono text-slate-500 tabular-nums">{fmtMins(r.age)}/{fmtMins(r.threshold)}</div>
        <div className="w-20 shrink-0 text-right text-[0.55rem] font-mono tabular-nums" style={{ color: r.remaining <= 0 ? '#ef4444' : '#64748b' }}>
          {r.remaining <= 0 ? 'over' : `${fmtMins(r.remaining)} left`}
        </div>
      </div>
    </Link>
  )
}

export default function StuckHeadroomPage() {
  const { data, isStale, lastError, lastSuccessAt } = useFreshness<FleetResponse>('/api/fleet', 60_000)
  const loading = data === null && lastError === null

  const rows: Row[] = useMemo(() => {
    const projects = (data?.projects ?? []) as FleetProject[]
    return projects
      .filter((p) => p.stuckThresholdMinutes > 0 && p.ageMins != null)
      .map((p) => {
        const threshold = p.stuckThresholdMinutes
        const age = p.ageMins
        return { slug: p.slug, age, threshold, frac: age / threshold, remaining: threshold - age, state: p.state }
      })
      .sort((a, b) => b.frac - a.frac)
  }, [data])

  const atRisk = rows[0] // highest fraction after sort

  if (loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center" style={{ background: '#060d1a' }}>
        <div className="text-xs font-mono text-slate-600 animate-pulse">Measuring stuck headroom…</div>
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
            Stuck Headroom Gauge
          </h1>
          <span className="text-[0.6rem] font-mono text-slate-500 border border-slate-700 px-2 py-0.5 rounded">how close each project is to the watchdog reap line</span>
          <FreshnessBadge isStale={isStale} lastError={lastError} lastSuccessAt={lastSuccessAt} />
          <div className="flex-1" />
          {atRisk && (
            <div className="flex items-center gap-2">
              <span className="text-[0.55rem] font-mono text-slate-500 uppercase tracking-wider">most at risk</span>
              <span className="text-xs font-black" style={{ fontFamily: 'Orbitron, monospace', color: bandColor(atRisk.frac) }}>{atRisk.slug} {Math.round(atRisk.frac * 100)}%</span>
            </div>
          )}
        </div>
      </header>

      <main className="flex-1 p-6 max-w-5xl mx-auto w-full">
        {rows.length === 0 ? (
          <div className="h-64 flex items-center justify-center text-slate-600 text-xs font-mono">No active projects with a stuck threshold.</div>
        ) : (
          <>
            <div className="rounded-xl border border-cyber-cyan/12 p-3" style={{ background: 'rgba(0,245,255,0.02)' }}>
              {rows.map((r) => <HeadroomRow key={r.slug} r={r} />)}
            </div>

            <div className="mt-6 flex items-center gap-4 text-[0.55rem] font-mono text-slate-500 flex-wrap">
              <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded-sm" style={{ background: '#34d399' }} />safe &lt;60%</span>
              <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded-sm" style={{ background: '#f59e0b' }} />watch ≥60%</span>
              <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded-sm" style={{ background: '#ef4444' }} />near-reap ≥85%</span>
              <span className="text-slate-600">· red line marks the reap threshold (100%)</span>
            </div>
          </>
        )}

        <p className="text-[0.5rem] font-mono text-slate-700 mt-4">
          One gauge per active project with a <code>stuckThresholdMinutes</code>. Track length = threshold; fill =
          idle <code>ageMins</code>; color bands at 60%/85% of threshold. Rows sorted by headroom fraction descending
          so the closest-to-reap float to the top. Each row shows age/threshold and remaining minutes before the
          watchdog reaps the session. Click a row to open its Focus view. Reuses <code>/api/fleet</code>. Refreshes every 60s.
        </p>
      </main>
    </div>
  )
}
