'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import type { PressureRidgelineResponse, RidgelineRow } from '../api/pressure-ridgeline/route'
import { useFreshness } from '../../lib/useFreshness'
import FreshnessBadge from '../../components/FreshnessBadge'

// Pressure scores are 0–100. Map latest pressure to a colour on a
// cyan → amber → red ramp so high-pressure rows glow hot.
function pressureColor(latest: number): string {
  if (latest >= 80) return '#ef4444'
  if (latest >= 60) return '#f59e0b'
  if (latest >= 40) return '#eab308'
  return '#22d3ee'
}

const ROW_W = 720
const ROW_H = 64
// Rows overlap so successive ridges interleave (joyplot look).
const ROW_OVERLAP = 28

function Ridge({ row, z }: { row: RidgelineRow; z: number }) {
  const color = pressureColor(row.latest)
  const pts = row.points
  const { line, area } = useMemo(() => {
    if (pts.length === 0) return { line: '', area: '' }
    const scores = pts.map((p) => p.score)
    // Fixed 0–100 domain so heights are comparable across rows.
    const stepX = pts.length > 1 ? ROW_W / (pts.length - 1) : 0
    const y = (s: number) => ROW_H - (Math.max(0, Math.min(100, s)) / 100) * (ROW_H - 4) - 2
    const coords = pts.length === 1
      ? [{ x: 0, y: y(scores[0]) }, { x: ROW_W, y: y(scores[0]) }]
      : pts.map((p, i) => ({ x: i * stepX, y: y(p.score) }))
    const line = coords.map((c, i) => `${i === 0 ? 'M' : 'L'} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`).join(' ')
    const area = `${line} L ${ROW_W} ${ROW_H} L 0 ${ROW_H} Z`
    return { line, area }
  }, [pts])

  return (
    <div className="relative flex items-center gap-3" style={{ marginTop: z === 0 ? 0 : -ROW_OVERLAP, zIndex: 100 - z }}>
      <Link
        href={`/focus/${encodeURIComponent(row.slug)}`}
        className="w-28 shrink-0 text-right text-[0.6rem] font-mono text-slate-300 hover:text-cyber-cyan transition-colors truncate"
      >
        {row.slug}
      </Link>
      <svg width={ROW_W} height={ROW_H} viewBox={`0 0 ${ROW_W} ${ROW_H}`} className="flex-1" preserveAspectRatio="none" style={{ maxWidth: ROW_W }}>
        <path d={area} fill={color} fillOpacity={0.22} />
        <path d={line} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      </svg>
      <span className="w-10 shrink-0 text-[0.7rem] font-black tabular-nums text-right" style={{ fontFamily: 'Orbitron, monospace', color }}>
        {Math.round(row.latest)}
      </span>
    </div>
  )
}

export default function PressureRidgelinePage() {
  const { data, isStale, lastError, lastSuccessAt } = useFreshness<PressureRidgelineResponse>('/api/pressure-ridgeline', 60_000)
  const loading = data === null && lastError === null

  const rows = data?.rows ?? []
  const hot = rows.filter((r) => r.latest >= 60).length

  if (loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center" style={{ background: '#060d1a' }}>
        <div className="text-xs font-mono text-slate-600 animate-pulse">Loading context-pressure ridgeline…</div>
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
            Context Pressure Ridgeline
          </h1>
          <span className="text-[0.6rem] font-mono text-slate-500 border border-slate-700 px-2 py-0.5 rounded">fleet-wide pressure distribution</span>
          <FreshnessBadge isStale={isStale} lastError={lastError} lastSuccessAt={lastSuccessAt} />
          <div className="flex-1" />
          <div className="flex items-center gap-1.5">
            <span className="text-[0.55rem] font-mono text-slate-500 uppercase tracking-wider">hot (≥60)</span>
            <span className="text-lg font-black tabular-nums" style={{ fontFamily: 'Orbitron, monospace', color: hot > 0 ? '#f59e0b' : '#34d399' }}>
              {hot}
            </span>
          </div>
        </div>
      </header>

      <main className="flex-1 p-6 w-full">
        {rows.length === 0 ? (
          <div className="h-64 flex items-center justify-center text-slate-600 text-xs font-mono">No context-pressure history recorded yet.</div>
        ) : (
          <div className="flex flex-col" style={{ paddingTop: ROW_OVERLAP }}>
            {rows.map((r, i) => <Ridge key={r.slug} row={r} z={i} />)}
          </div>
        )}

        <p className="text-[0.5rem] font-mono text-slate-700 mt-6 max-w-3xl">
          Stacked, slightly-overlapping area sparklines (joyplot), one row per project, showing the recent
          <code>context_pressure</code> series (0–100). Rows are ordered by latest pressure descending; fill color ramps
          cyan → amber → red as pressure climbs, so projects approaching context-exhaustion compaction glow hot at the top.
          The y-axis is fixed to a 0–100 domain so ridge heights are comparable across rows. Reuses
          <code>/api/pressure-ridgeline</code>. Refreshes every 60s.
        </p>
      </main>
    </div>
  )
}
