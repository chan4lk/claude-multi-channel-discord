'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import type { FleetResponse, FleetProject, ProjectState } from '../api/fleet/route'
import { useFreshness } from '../../lib/useFreshness'
import FreshnessBadge from '../../components/FreshnessBadge'

const STATE_COLORS: Record<ProjectState, string> = {
  idle: '#00F5FF',
  active: '#4ADE80',
  stalled: '#EF4444',
  autonomous: '#A855F7',
}

// Thresholds dividing the quadrants. High context + low convergence = at-risk.
const CTX_THRESHOLD = 70 // %
const CONV_THRESHOLD = 0.5

const CHART_W = 560
const CHART_H = 420
const PAD_L = 44
const PAD_R = 16
const PAD_T = 16
const PAD_B = 40

export default function ConvergenceRiskPage() {
  const { data, isStale, lastError, lastSuccessAt } = useFreshness<FleetResponse>('/api/fleet', 60_000)
  const loading = data === null && lastError === null
  const [hover, setHover] = useState<string | null>(null)

  const { points, atRisk } = useMemo(() => {
    const projects = (data?.projects ?? []) as FleetProject[]
    const points = projects.filter((p) => p.contextUsagePct != null && p.convergenceScore != null)
    const atRisk = points.filter((p) => (p.contextUsagePct ?? 0) >= CTX_THRESHOLD && (p.convergenceScore ?? 0) < CONV_THRESHOLD * 100).length
    return { points, atRisk }
  }, [data])

  const plotW = CHART_W - PAD_L - PAD_R
  const plotH = CHART_H - PAD_T - PAD_B
  // x: contextUsagePct 0–100; y: convergenceScore 0–100 (stored 0–100, shown 0–1)
  const sx = (ctxPct: number) => PAD_L + (ctxPct / 100) * plotW
  const sy = (convScore: number) => PAD_T + plotH * (1 - convScore / 100)

  if (loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center" style={{ background: '#060d1a' }}>
        <div className="text-xs font-mono text-slate-600 animate-pulse">Crossing context × convergence…</div>
      </div>
    )
  }

  const xT = sx(CTX_THRESHOLD)
  const yT = sy(CONV_THRESHOLD * 100)

  return (
    <div className="min-h-dvh flex flex-col" style={{ background: '#060d1a' }}>
      <header className="sticky top-0 z-30 border-b border-cyber-cyan/12 bg-[#060d1a]/90 backdrop-blur-md px-6 py-3">
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-cyber-cyan/40 to-transparent" />
        <div className="flex items-center gap-3 flex-wrap">
          <Link href="/" className="text-[0.6rem] font-mono text-slate-500 hover:text-cyber-cyan transition-colors uppercase tracking-wider">← Dashboard</Link>
          <h1 className="text-sm font-black tracking-[0.18em] text-cyber-cyan" style={{ fontFamily: 'Orbitron, JetBrains Mono, monospace' }}>
            Convergence × Context Risk
          </h1>
          <span className="text-[0.6rem] font-mono text-slate-500 border border-slate-700 px-2 py-0.5 rounded">far from done + low on context = stalls hardest</span>
          <FreshnessBadge isStale={isStale} lastError={lastError} lastSuccessAt={lastSuccessAt} />
          <div className="flex-1" />
          <div className="flex items-center gap-1.5">
            <span className="text-[0.55rem] font-mono text-slate-500 uppercase tracking-wider">at risk</span>
            <span className="text-lg font-black tabular-nums" style={{ fontFamily: 'Orbitron, monospace', color: atRisk > 0 ? '#ef4444' : '#475569' }}>{atRisk}</span>
          </div>
        </div>
      </header>

      <main className="flex-1 p-6 max-w-3xl mx-auto w-full">
        {points.length === 0 ? (
          <div className="h-64 flex items-center justify-center text-slate-600 text-xs font-mono">No projects reporting both context usage and convergence.</div>
        ) : (
          <div className="rounded-xl border border-cyber-cyan/12 p-4" style={{ background: 'rgba(0,245,255,0.02)' }}>
            <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} width="100%" preserveAspectRatio="xMidYMid meet">
              {/* at-risk quadrant tint: high context (x≥xT), low convergence (y below yT → larger y) */}
              <rect x={xT} y={yT} width={CHART_W - PAD_R - xT} height={PAD_T + plotH - yT} fill="#ef4444" opacity={0.07} />
              <text x={(xT + CHART_W - PAD_R) / 2} y={PAD_T + plotH - 6} textAnchor="middle" fontSize={8} fill="#ef4444" opacity={0.6} fontFamily="monospace">at-risk</text>

              {/* axis frame */}
              <line x1={PAD_L} x2={PAD_L} y1={PAD_T} y2={PAD_T + plotH} stroke="#1e293b" strokeWidth={0.8} />
              <line x1={PAD_L} x2={CHART_W - PAD_R} y1={PAD_T + plotH} y2={PAD_T + plotH} stroke="#1e293b" strokeWidth={0.8} />

              {/* quadrant guides */}
              <line x1={xT} x2={xT} y1={PAD_T} y2={PAD_T + plotH} stroke="#334155" strokeWidth={0.6} strokeDasharray="3 3" />
              <line x1={PAD_L} x2={CHART_W - PAD_R} y1={yT} y2={yT} stroke="#334155" strokeWidth={0.6} strokeDasharray="3 3" />

              {/* y ticks (convergence) */}
              {[0, 0.25, 0.5, 0.75, 1].map((t) => (
                <text key={`y${t}`} x={PAD_L - 6} y={sy(t * 100) + 3} textAnchor="end" fontSize={7} fill="#475569" fontFamily="monospace">{t.toFixed(2)}</text>
              ))}
              {/* x ticks (context %) */}
              {[0, 25, 50, 70, 100].map((t) => (
                <text key={`x${t}`} x={sx(t)} y={PAD_T + plotH + 14} textAnchor="middle" fontSize={7} fill="#475569" fontFamily="monospace">{t}%</text>
              ))}
              <text x={PAD_L - 30} y={PAD_T + plotH / 2} fontSize={7.5} fill="#64748b" fontFamily="monospace" transform={`rotate(-90 ${PAD_L - 30} ${PAD_T + plotH / 2})`} textAnchor="middle">convergence</text>
              <text x={PAD_L + plotW / 2} y={CHART_H - 6} fontSize={7.5} fill="#64748b" fontFamily="monospace" textAnchor="middle">context usage</text>

              {/* dots */}
              {points.map((p) => {
                const cx = sx(p.contextUsagePct ?? 0)
                const cy = sy(p.convergenceScore ?? 0)
                const active = hover === p.slug
                const color = STATE_COLORS[p.state] ?? '#64748B'
                return (
                  <g key={p.slug} onMouseEnter={() => setHover(p.slug)} onMouseLeave={() => setHover(null)} style={{ cursor: 'pointer' }}>
                    <circle cx={cx} cy={cy} r={active ? 6 : 4} fill={color} fillOpacity={active ? 0.95 : 0.6} stroke={active ? '#fff' : color} strokeWidth={active ? 1.2 : 0.5} />
                  </g>
                )
              })}
            </svg>

            <div className="mt-3 min-h-[1.5rem] border-t border-slate-800 pt-2">
              {hover ? (() => {
                const p = points.find((x) => x.slug === hover)
                if (!p) return null
                return (
                  <span className="text-[0.6rem] font-mono text-slate-300">
                    <Link href={`/focus/${encodeURIComponent(p.slug)}`} className="text-cyber-cyan hover:underline">{p.slug}</Link>
                    {' · '}context <span className="text-slate-100">{Math.round(p.contextUsagePct ?? 0)}%</span>
                    {' · '}conv <span className="text-slate-100">{((p.convergenceScore ?? 0) / 100).toFixed(2)}</span>
                    {' · '}<span style={{ color: STATE_COLORS[p.state] }}>{p.state}</span>
                  </span>
                )
              })() : (
                <span className="text-[0.55rem] font-mono text-slate-600">Hover a dot for slug, context %, convergence, and state.</span>
              )}
            </div>
          </div>
        )}

        <p className="text-[0.5rem] font-mono text-slate-700 mt-4">
          Scatter of x = <code>contextUsagePct</code> (0–100%) vs y = <code>convergenceScore</code> (0.0–1.0). Quadrant
          guides at 70% context / 0.5 convergence; the high-context, low-convergence quadrant is tinted red as the
          at-risk zone (projects far from done that are also nearly out of context window). Dots colored by project
          state. Only projects reporting both metrics are plotted. Header counts at-risk projects. Reuses
          <code>/api/fleet</code>. Refreshes every 60s.
        </p>
      </main>
    </div>
  )
}
