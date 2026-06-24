'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import type { QuadrantResponse, Quadrant } from '../api/quadrant/route'
import { useFreshness } from '../../lib/useFreshness'
import FreshnessBadge from '../../components/FreshnessBadge'

const QUAD_META: Record<Quadrant, { label: string; color: string; corner: string }> = {
  thriving: { label: 'Thriving', color: '#22c55e', corner: 'top-right' },
  drifting: { label: 'Drifting', color: '#fbbf24', corner: 'bottom-right' },
  grinding: { label: 'Grinding', color: '#38bdf8', corner: 'top-left' },
  stalled: { label: 'Stalled', color: '#ef4444', corner: 'bottom-left' },
}

const ORDER: Quadrant[] = ['thriving', 'drifting', 'grinding', 'stalled']

export default function QuadrantPage() {
  const { data, isStale, lastError, lastSuccessAt } = useFreshness<QuadrantResponse>('/api/quadrant', 60_000)
  const loading = data === null && lastError === null
  const [hover, setHover] = useState<string | null>(null)

  const { points, counts, total } = useMemo(() => ({
    points: data?.points ?? [],
    counts: data?.counts ?? { thriving: 0, drifting: 0, grinding: 0, stalled: 0 },
    total: data?.total ?? 0,
  }), [data])

  if (loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center" style={{ background: '#060d1a' }}>
        <div className="text-xs font-mono text-slate-600 animate-pulse">Plotting goal × convergence…</div>
      </div>
    )
  }

  // SVG plotting area: 0–100 on both axes. x = convergence, y = goal (inverted for screen).
  const SIZE = 520
  const PAD = 36
  const inner = SIZE - PAD * 2
  const px = (v: number) => PAD + (v / 100) * inner
  const py = (v: number) => PAD + (1 - v / 100) * inner

  return (
    <div className="min-h-dvh flex flex-col" style={{ background: '#060d1a' }}>
      <header className="sticky top-0 z-30 border-b border-cyber-cyan/12 bg-[#060d1a]/90 backdrop-blur-md px-6 py-3">
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-cyber-cyan/40 to-transparent" />
        <div className="flex items-center gap-3 flex-wrap">
          <Link href="/" className="text-[0.6rem] font-mono text-slate-500 hover:text-cyber-cyan transition-colors uppercase tracking-wider">← Dashboard</Link>
          <h1 className="text-sm font-black tracking-[0.18em] text-cyber-cyan" style={{ fontFamily: 'Orbitron, JetBrains Mono, monospace' }}>
            Quadrant Map
          </h1>
          <span className="text-[0.6rem] font-mono text-slate-500 border border-slate-700 px-2 py-0.5 rounded">goal × convergence triage</span>
          <FreshnessBadge isStale={isStale} lastError={lastError} lastSuccessAt={lastSuccessAt} />
          <div className="flex-1" />
          <div className="flex items-center gap-3">
            {ORDER.map((q) => (
              <div key={q} className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full" style={{ background: QUAD_META[q].color, boxShadow: `0 0 6px ${QUAD_META[q].color}` }} />
                <span className="text-[0.55rem] font-mono text-slate-400 uppercase tracking-wider">{QUAD_META[q].label}</span>
                <span className="text-xs font-black tabular-nums" style={{ fontFamily: 'Orbitron, monospace', color: QUAD_META[q].color }}>{counts[q]}</span>
              </div>
            ))}
          </div>
        </div>
      </header>

      <main className="flex-1 p-6 max-w-5xl mx-auto w-full">
        {total === 0 ? (
          <div className="h-64 flex items-center justify-center text-slate-600 text-xs font-mono">
            No projects have both a convergence and a goal-advancement score yet.
          </div>
        ) : (
          <div className="rounded-xl border border-cyber-cyan/12 p-4" style={{ background: 'rgba(0,245,255,0.02)' }}>
            <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="w-full max-w-[560px] mx-auto block" style={{ overflow: 'visible' }}>
              {/* quadrant tints */}
              <rect x={px(50)} y={py(100)} width={inner / 2} height={inner / 2} fill="rgba(34,197,94,0.05)" />
              <rect x={px(50)} y={py(50)} width={inner / 2} height={inner / 2} fill="rgba(251,191,36,0.05)" />
              <rect x={PAD} y={py(100)} width={inner / 2} height={inner / 2} fill="rgba(56,189,248,0.05)" />
              <rect x={PAD} y={py(50)} width={inner / 2} height={inner / 2} fill="rgba(239,68,68,0.05)" />

              {/* frame */}
              <rect x={PAD} y={PAD} width={inner} height={inner} fill="none" stroke="rgba(148,163,184,0.18)" strokeWidth={1} />
              {/* midlines */}
              <line x1={px(50)} y1={PAD} x2={px(50)} y2={SIZE - PAD} stroke="rgba(148,163,184,0.25)" strokeWidth={1} strokeDasharray="4 4" />
              <line x1={PAD} y1={py(50)} x2={SIZE - PAD} y2={py(50)} stroke="rgba(148,163,184,0.25)" strokeWidth={1} strokeDasharray="4 4" />

              {/* quadrant labels */}
              <text x={px(98)} y={py(97)} textAnchor="end" fontSize={9} fontFamily="Orbitron, monospace" fill={QUAD_META.thriving.color} opacity={0.7}>THRIVING</text>
              <text x={px(98)} y={py(3) + 0} textAnchor="end" fontSize={9} fontFamily="Orbitron, monospace" fill={QUAD_META.drifting.color} opacity={0.7}>DRIFTING</text>
              <text x={px(2)} y={py(97)} textAnchor="start" fontSize={9} fontFamily="Orbitron, monospace" fill={QUAD_META.grinding.color} opacity={0.7}>GRINDING</text>
              <text x={px(2)} y={py(3)} textAnchor="start" fontSize={9} fontFamily="Orbitron, monospace" fill={QUAD_META.stalled.color} opacity={0.7}>STALLED</text>

              {/* axis labels */}
              <text x={px(50)} y={SIZE - 6} textAnchor="middle" fontSize={9} fontFamily="JetBrains Mono, monospace" fill="#64748b">convergence →</text>
              <text x={12} y={py(50)} textAnchor="middle" fontSize={9} fontFamily="JetBrains Mono, monospace" fill="#64748b" transform={`rotate(-90 12 ${py(50)})`}>goal advancement →</text>

              {/* points */}
              {points.map((p) => {
                const m = QUAD_META[p.quadrant]
                const active = hover === p.slug
                return (
                  <g key={p.slug}
                    onMouseEnter={() => setHover(p.slug)}
                    onMouseLeave={() => setHover(null)}
                    style={{ cursor: 'pointer' }}>
                    <circle cx={px(p.convergence)} cy={py(p.goal)} r={active ? 7 : 5}
                      fill={m.color}
                      style={{ filter: `drop-shadow(0 0 ${active ? 8 : 4}px ${m.color})` }} />
                    <text x={px(p.convergence) + 8} y={py(p.goal) + 3} fontSize={8}
                      fontFamily="JetBrains Mono, monospace"
                      fill={active ? '#e2e8f0' : '#94a3b8'}>{p.slug}</text>
                  </g>
                )
              })}
            </svg>

            {/* hover detail */}
            <div className="mt-3 min-h-[2rem] border-t border-slate-800 pt-2 text-center">
              {hover ? (() => {
                const p = points.find((x) => x.slug === hover)
                if (!p) return null
                const m = QUAD_META[p.quadrant]
                return (
                  <span className="text-[0.6rem] font-mono" style={{ color: m.color }}>
                    {p.slug} · {m.label} · convergence {p.convergence} · goal {p.goal}
                  </span>
                )
              })() : (
                <span className="text-[0.55rem] font-mono text-slate-600">Hover a point for its exact convergence and goal scores.</span>
              )}
            </div>
          </div>
        )}

        <p className="text-[0.5rem] font-mono text-slate-700 mt-4">
          Scatter of each project&apos;s latest <code>convergence_history</code> score (x) against its latest
          <code>goal_advancement</code> score (y), both 0–100. Midlines at 50 split the plane into four quadrants:
          <span style={{ color: QUAD_META.thriving.color }}> Thriving</span> (both high),
          <span style={{ color: QUAD_META.drifting.color }}> Drifting</span> (converging but no goal progress),
          <span style={{ color: QUAD_META.grinding.color }}> Grinding</span> (goal progress but unstable), and
          <span style={{ color: QUAD_META.stalled.color }}> Stalled</span> (both low). Only projects with both scores
          appear. Reuses <code>/api/quadrant</code>. Refreshes every 60s.
        </p>
      </main>
    </div>
  )
}
