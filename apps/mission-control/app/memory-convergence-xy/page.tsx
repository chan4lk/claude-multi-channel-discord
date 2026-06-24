'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import type { MemoryConvergenceXYResponse, MemoryConvergencePoint } from '../api/memory-convergence-xy/route'
import { useFreshness } from '../../lib/useFreshness'
import FreshnessBadge from '../../components/FreshnessBadge'

const W = 560
const H = 440
const PAD = 48

function dirColor(d: MemoryConvergencePoint['direction']): string {
  switch (d) {
    case 'improving': return '#34d399'
    case 'declining': return '#ef4444'
    default: return '#64748b'
  }
}

export default function MemoryConvergenceXYPage() {
  const { data, isStale, lastError, lastSuccessAt } = useFreshness<MemoryConvergenceXYResponse>('/api/memory-convergence-xy', 60_000)
  const loading = data === null && lastError === null
  const [hover, setHover] = useState<string | null>(null)

  const pts = data?.points ?? []

  const { xMax, xMid, yMax } = useMemo(() => {
    if (pts.length === 0) return { xMax: 1, xMid: 0.5, yMax: 0.1 }
    const xMax = Math.max(...pts.map((p) => p.churn), 1)
    const yMax = Math.max(0.05, ...pts.map((p) => Math.abs(p.convDelta)))
    return { xMax, xMid: xMax / 2, yMax }
  }, [pts])

  const rMax = useMemo(() => Math.max(1, ...pts.map((p) => p.diffCount)), [pts])

  const plotW = W - PAD * 2
  const plotH = H - PAD * 2
  const sx = (churn: number) => PAD + (churn / (xMax || 1)) * plotW
  const sy = (delta: number) => PAD + plotH / 2 - (delta / (yMax || 1)) * (plotH / 2)
  const sr = (diffs: number) => 4 + (diffs / rMax) * 9

  const thrashing = pts.filter((p) => p.churn > xMid && p.convDelta < -0.001)

  if (loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center" style={{ background: '#060d1a' }}>
        <div className="text-xs font-mono text-slate-600 animate-pulse">Correlating memory churn vs convergence…</div>
      </div>
    )
  }

  const hp = pts.find((p) => p.slug === hover)
  const corr = data?.correlation
  const corrLabel = corr == null ? 'n/a' : `${data!.correlationSign} (${corr.toFixed(2)})`

  return (
    <div className="min-h-dvh flex flex-col" style={{ background: '#060d1a' }}>
      <header className="sticky top-0 z-30 border-b border-cyber-cyan/12 bg-[#060d1a]/90 backdrop-blur-md px-6 py-3">
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-cyber-cyan/40 to-transparent" />
        <div className="flex items-center gap-3 flex-wrap">
          <Link href="/" className="text-[0.6rem] font-mono text-slate-500 hover:text-cyber-cyan transition-colors uppercase tracking-wider">← Dashboard</Link>
          <h1 className="text-sm font-black tracking-[0.18em] text-cyber-cyan" style={{ fontFamily: 'Orbitron, JetBrains Mono, monospace' }}>
            Memory × Convergence
          </h1>
          <span className="text-[0.6rem] font-mono text-slate-500 border border-slate-700 px-2 py-0.5 rounded">does memory churn drive convergence — or signal thrashing?</span>
          <FreshnessBadge isStale={isStale} lastError={lastError} lastSuccessAt={lastSuccessAt} />
          <div className="flex-1" />
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5">
              <span className="text-[0.55rem] font-mono text-slate-500 uppercase tracking-wider">corr</span>
              <span className="text-[0.65rem] font-black tabular-nums text-cyber-cyan" style={{ fontFamily: 'Orbitron, monospace' }}>{corrLabel}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[0.55rem] font-mono text-slate-500 uppercase tracking-wider">thrashing</span>
              <span className="text-lg font-black tabular-nums" style={{ fontFamily: 'Orbitron, monospace', color: thrashing.length > 0 ? '#ef4444' : '#475569' }}>{thrashing.length}</span>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 p-6 max-w-3xl mx-auto w-full">
        {pts.length === 0 ? (
          <div className="h-64 flex items-center justify-center text-slate-600 text-xs font-mono">No projects with both memory churn and a convergence delta over the last {data?.windowDays ?? 30} days.</div>
        ) : (
          <div className="rounded-xl border border-cyber-cyan/12 p-4 relative" style={{ background: 'rgba(0,245,255,0.02)' }}>
            <svg viewBox={`0 0 ${W} ${H}`} width="100%" preserveAspectRatio="xMidYMid meet">
              {/* quadrant guides: vertical at churn midpoint, horizontal at delta = 0 */}
              <line x1={sx(xMid)} x2={sx(xMid)} y1={PAD} y2={H - PAD} stroke="#334155" strokeWidth={0.6} strokeDasharray="3 3" />
              <line x1={PAD} x2={W - PAD} y1={sy(0)} y2={sy(0)} stroke="#475569" strokeWidth={0.8} />
              <rect x={PAD} y={PAD} width={plotW} height={plotH} fill="none" stroke="#1e293b" strokeWidth={0.8} />
              {/* quadrant labels */}
              <text x={W - PAD - 4} y={PAD + 12} fontSize={8} fill="#34d399" textAnchor="end" fontFamily="monospace">productive churn — heavy &amp; rising</text>
              <text x={PAD + 4} y={PAD + 12} fontSize={8} fill="#22d3ee" fontFamily="monospace">light &amp; rising</text>
              <text x={W - PAD - 4} y={H - PAD - 4} fontSize={8} fill="#ef4444" textAnchor="end" fontFamily="monospace">thrashing — heavy &amp; falling</text>
              <text x={PAD + 4} y={H - PAD - 4} fontSize={8} fill="#64748b" fontFamily="monospace">light &amp; falling</text>
              {/* axis labels */}
              <text x={PAD + plotW / 2} y={H - 12} textAnchor="middle" fontSize={8} fill="#64748b" fontFamily="monospace">memory churn (added+removed lines) →</text>
              <text x={14} y={PAD + plotH / 2} textAnchor="middle" fontSize={8} fill="#64748b" fontFamily="monospace" transform={`rotate(-90 14 ${PAD + plotH / 2})`}>← declining · convergence Δ · improving →</text>
              {/* points */}
              {pts.map((p) => {
                const active = hover === p.slug
                return (
                  <circle
                    key={p.slug}
                    cx={sx(p.churn)} cy={sy(p.convDelta)} r={active ? sr(p.diffCount) + 2 : sr(p.diffCount)}
                    fill={dirColor(p.direction)}
                    fillOpacity={active ? 0.95 : 0.55}
                    stroke={active ? '#fff' : dirColor(p.direction)}
                    strokeWidth={active ? 1.2 : 0.5}
                    onMouseEnter={() => setHover(p.slug)}
                    onMouseLeave={() => setHover(null)}
                    style={{ cursor: 'pointer' }}
                  />
                )
              })}
            </svg>

            {hp && (
              <div className="absolute top-6 right-6 max-w-[12rem] bg-[#0a1424] border border-cyber-cyan/30 rounded px-2.5 py-1.5 text-[0.55rem] font-mono pointer-events-none">
                <div className="font-bold text-slate-100" style={{ fontFamily: 'Orbitron, monospace' }}>{hp.slug}</div>
                <div className="text-slate-400">churn {hp.churn} lines · {hp.diffCount} diffs</div>
                <div style={{ color: dirColor(hp.direction) }}>conv Δ {hp.convDelta > 0 ? '+' : ''}{(hp.convDelta * 100).toFixed(1)}% · {hp.direction}</div>
              </div>
            )}

            <div className="mt-3 flex items-center gap-3 text-[0.55rem] font-mono text-slate-500 flex-wrap border-t border-slate-800 pt-2">
              {(['improving', 'declining', 'flat'] as const).map((s) => (
                <span key={s} className="flex items-center gap-1.5"><span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: dirColor(s) }} />{s}</span>
              ))}
              <span className="text-slate-600">· dot size = memory-diff count</span>
            </div>
          </div>
        )}

        <p className="text-[0.5rem] font-mono text-slate-700 mt-4">
          One dot per project with both memory churn and a convergence delta over the last {data?.windowDays ?? 30} days.
          x = summed <code>memory_diff_log</code> added+removed lines, y = latest − earliest <code>convergence_history</code>
          score, dot size = number of diffs, color by convergence direction. Quadrant guides cross at the churn midpoint
          and zero-delta line: top-right (heavy churn, rising) is productive churn; bottom-right (heavy churn, falling)
          is thrashing, counted in the header alongside the fleet churn↔convergence correlation. Reuses
          <code>/api/memory-convergence-xy</code>. Refreshes every 60s.
        </p>
      </main>
    </div>
  )
}
