'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import type { ConvergenceTrendResponse, ConvergenceTrendEntry } from '../api/convergence-trend/route'
import { useFreshness } from '../../lib/useFreshness'
import FreshnessBadge from '../../components/FreshnessBadge'

const CHART_W = 720
const CHART_H = 260
const PAD_L = 30
const PAD_R = 12
const PAD_B = 30
const PAD_T = 14

// convergenceScore is stored 0–100; display on a 0.0–1.0 scale.
function fmtScore(s: number): string {
  return (s / 100).toFixed(2)
}

export default function ConvergenceTrendPage() {
  const { data, isStale, lastError, lastSuccessAt } = useFreshness<ConvergenceTrendResponse>('/api/convergence-trend', 60_000)
  const loading = data === null && lastError === null
  const [hover, setHover] = useState<number | null>(null)

  const days = useMemo<ConvergenceTrendEntry[]>(() => data?.days ?? [], [data])
  const delta = days.length >= 2 ? days[days.length - 1].meanScore - days[0].meanScore : 0
  const latestMean = days.length > 0 ? days[days.length - 1].meanScore : 0
  const latestTop = days.length > 0 ? days[days.length - 1].topBinCount : 0

  const plotW = CHART_W - PAD_L - PAD_R
  const plotH = CHART_H - PAD_B - PAD_T
  const maxTop = Math.max(1, ...days.map((d) => d.topBinCount))

  // x position per day index (score axis is fixed 0–100).
  const xAt = (i: number) => PAD_L + (days.length <= 1 ? plotW / 2 : (i / (days.length - 1)) * plotW)
  const yScore = (s: number) => PAD_T + plotH * (1 - s / 100)

  const linePts = days.map((d, i) => `${xAt(i)},${yScore(d.meanScore)}`).join(' ')
  const areaPts = days.length > 0
    ? `${PAD_L},${PAD_T + plotH} ${linePts} ${xAt(days.length - 1)},${PAD_T + plotH}`
    : ''

  if (loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center" style={{ background: '#060d1a' }}>
        <div className="text-xs font-mono text-slate-600 animate-pulse">Loading convergence history…</div>
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
            Convergence Trend
          </h1>
          <span className="text-[0.6rem] font-mono text-slate-500 border border-slate-700 px-2 py-0.5 rounded">is the fleet trending toward its goals?</span>
          <FreshnessBadge isStale={isStale} lastError={lastError} lastSuccessAt={lastSuccessAt} />
          <div className="flex-1" />
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5">
              <span className="text-[0.55rem] font-mono text-slate-500 uppercase tracking-wider">mean</span>
              <span className="text-lg font-black tabular-nums text-cyber-cyan" style={{ fontFamily: 'Orbitron, monospace' }}>{fmtScore(latestMean)}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[0.55rem] font-mono text-slate-500 uppercase tracking-wider">≥0.9</span>
              <span className="text-lg font-black tabular-nums" style={{ fontFamily: 'Orbitron, monospace', color: latestTop > 0 ? '#34d399' : '#475569' }}>{latestTop}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[0.55rem] font-mono text-slate-500 uppercase tracking-wider">14d</span>
              <span className="text-lg font-black tabular-nums" style={{ fontFamily: 'Orbitron, monospace', color: delta > 0 ? '#34d399' : delta < 0 ? '#ef4444' : '#475569' }}>
                {delta > 0 ? '▲' : delta < 0 ? '▼' : '·'} {fmtScore(Math.abs(delta))}
              </span>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 p-6 max-w-4xl mx-auto w-full">
        {days.length === 0 ? (
          <div className="h-64 flex items-center justify-center text-slate-600 text-xs font-mono">No convergence history recorded yet.</div>
        ) : (
          <div className="rounded-xl border border-cyber-cyan/12 p-4" style={{ background: 'rgba(0,245,255,0.02)' }}>
            <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} width="100%" preserveAspectRatio="xMidYMid meet">
              <defs>
                <linearGradient id="convFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#34d399" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#ef4444" stopOpacity={0.04} />
                </linearGradient>
              </defs>
              {/* y gridlines at 0.0/0.25/0.5/0.75/1.0 */}
              {[0, 0.25, 0.5, 0.75, 1].map((t) => {
                const y = PAD_T + plotH * (1 - t)
                return (
                  <g key={t}>
                    <line x1={PAD_L} x2={CHART_W - PAD_R} y1={y} y2={y} stroke="#1e293b" strokeWidth={0.5} />
                    <text x={PAD_L - 4} y={y + 3} textAnchor="end" fontSize={7} fill="#475569" fontFamily="monospace">{t.toFixed(2)}</text>
                  </g>
                )
              })}

              {/* secondary: ≥0.9 count as faint bars scaled to its own max */}
              {days.map((d, i) => {
                const bh = (d.topBinCount / maxTop) * (plotH * 0.4)
                const bw = Math.max(3, (plotW / Math.max(1, days.length)) * 0.4)
                return (
                  <rect key={`b${d.date}`} x={xAt(i) - bw / 2} y={PAD_T + plotH - bh} width={bw} height={bh} fill="#a78bfa" opacity={hover === i ? 0.5 : 0.18} rx={1} />
                )
              })}

              {/* area + line */}
              <polygon points={areaPts} fill="url(#convFill)" />
              <polyline points={linePts} fill="none" stroke="#22d3ee" strokeWidth={1.8} />

              {/* points + hover targets */}
              {days.map((d, i) => (
                <g key={d.date} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} style={{ cursor: 'pointer' }}>
                  <circle cx={xAt(i)} cy={yScore(d.meanScore)} r={hover === i ? 4 : 2.5} fill="#22d3ee" />
                  <rect x={xAt(i) - plotW / Math.max(2, days.length * 2)} y={PAD_T} width={plotW / Math.max(1, days.length)} height={plotH} fill="transparent" />
                </g>
              ))}

              {/* x labels: first, mid, last */}
              {[0, Math.floor((days.length - 1) / 2), days.length - 1].filter((v, idx, arr) => arr.indexOf(v) === idx).map((i) => (
                <text key={`x${i}`} x={xAt(i)} y={CHART_H - PAD_B + 14} textAnchor="middle" fontSize={7} fill="#64748b" fontFamily="monospace">{days[i].date.slice(5)}</text>
              ))}
            </svg>

            <div className="mt-3 min-h-[1.5rem] border-t border-slate-800 pt-2">
              {hover != null && days[hover] ? (
                <span className="text-[0.6rem] font-mono text-slate-300">
                  <span className="text-cyber-cyan">{days[hover].date}</span> · mean <span className="text-cyber-cyan">{fmtScore(days[hover].meanScore)}</span> · ≥0.9 <span style={{ color: '#a78bfa' }}>{days[hover].topBinCount}</span> · {days[hover].projectCount} projects
                </span>
              ) : (
                <span className="text-[0.55rem] font-mono text-slate-600">Hover a point for that day's mean, ≥0.9 count, and project total.</span>
              )}
            </div>
          </div>
        )}

        <p className="text-[0.5rem] font-mono text-slate-700 mt-4">
          Fleet mean <code>convergenceScore</code> (0.0–1.0) per day for the last 14 days, aggregated across all slugs
          from <code>convergence_history</code>. Cyan line = daily fleet mean (green→red gradient fill); violet bars =
          count of projects in the top bin (≥0.9), scaled to their own max. Header shows the 14-day delta. Reuses
          <code>/api/convergence-trend</code>. Refreshes every 60s.
        </p>
      </main>
    </div>
  )
}
