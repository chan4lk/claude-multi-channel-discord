'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import type { FleetResponse, FleetProject } from '../api/fleet/route'
import { useFreshness } from '../../lib/useFreshness'
import FreshnessBadge from '../../components/FreshnessBadge'

const BIN_COUNT = 10

// convergenceScore is an integer 0–100 (see computeConvergenceScore). Bucket
// into ten 0.1-wide bins by score/10; the top bin (≥0.9) captures score ≥ 90.
function binIndex(score: number): number {
  return Math.min(BIN_COUNT - 1, Math.floor(score / 10))
}

// Red→amber→green ramp by bin position (hue 0→120 over the ten bins).
function binColor(i: number): string {
  const hue = (i / (BIN_COUNT - 1)) * 120
  return `hsl(${hue}, 75%, 55%)`
}

function binLabel(i: number): string {
  return `${(i / 10).toFixed(1)}–${((i + 1) / 10).toFixed(1)}`
}

const CHART_W = 720
const CHART_H = 240
const PAD_L = 28
const PAD_B = 28
const PAD_T = 12

export default function ConvergenceDistPage() {
  const { data, isStale, lastError, lastSuccessAt } = useFreshness<FleetResponse>('/api/fleet', 60_000)
  const loading = data === null && lastError === null
  const [hover, setHover] = useState<number | null>(null)

  const { bins, mean, topBin, total } = useMemo(() => {
    const projects = (data?.projects ?? []) as FleetProject[]
    const bins: string[][] = Array.from({ length: BIN_COUNT }, () => [])
    const scores: number[] = []
    for (const p of projects) {
      if (p.convergenceScore == null) continue
      scores.push(p.convergenceScore)
      bins[binIndex(p.convergenceScore)].push(p.slug)
    }
    const mean = scores.length === 0 ? 0 : scores.reduce((a, b) => a + b, 0) / scores.length
    const topBin = bins[BIN_COUNT - 1].length
    return { bins, mean, topBin, total: scores.length }
  }, [data])

  const maxCount = Math.max(1, ...bins.map((b) => b.length))
  const plotW = CHART_W - PAD_L
  const plotH = CHART_H - PAD_B - PAD_T
  const barW = plotW / BIN_COUNT

  if (loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center" style={{ background: '#060d1a' }}>
        <div className="text-xs font-mono text-slate-600 animate-pulse">Bucketing fleet convergence…</div>
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
            Convergence Distribution
          </h1>
          <span className="text-[0.6rem] font-mono text-slate-500 border border-slate-700 px-2 py-0.5 rounded">is the fleet broadly converging?</span>
          <FreshnessBadge isStale={isStale} lastError={lastError} lastSuccessAt={lastSuccessAt} />
          <div className="flex-1" />
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5">
              <span className="text-[0.55rem] font-mono text-slate-500 uppercase tracking-wider">mean</span>
              <span className="text-lg font-black tabular-nums text-cyber-cyan" style={{ fontFamily: 'Orbitron, monospace' }}>{(mean / 100).toFixed(2)}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[0.55rem] font-mono text-slate-500 uppercase tracking-wider">≥0.9</span>
              <span className="text-lg font-black tabular-nums" style={{ fontFamily: 'Orbitron, monospace', color: topBin > 0 ? '#34d399' : '#475569' }}>{topBin}</span>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 p-6 max-w-4xl mx-auto w-full">
        {total === 0 ? (
          <div className="h-64 flex items-center justify-center text-slate-600 text-xs font-mono">No projects with a convergence score.</div>
        ) : (
          <div className="rounded-xl border border-cyber-cyan/12 p-4" style={{ background: 'rgba(0,245,255,0.02)' }}>
            <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} width="100%" preserveAspectRatio="xMidYMid meet">
              {/* y gridlines */}
              {[0, 0.25, 0.5, 0.75, 1].map((t) => {
                const y = PAD_T + plotH * (1 - t)
                return (
                  <g key={t}>
                    <line x1={PAD_L} x2={CHART_W} y1={y} y2={y} stroke="#1e293b" strokeWidth={0.5} />
                    <text x={PAD_L - 4} y={y + 3} textAnchor="end" fontSize={7} fill="#475569" fontFamily="monospace">{Math.round(maxCount * t)}</text>
                  </g>
                )
              })}
              {bins.map((members, i) => {
                const count = members.length
                const h = (count / maxCount) * plotH
                const x = PAD_L + i * barW
                const y = PAD_T + plotH - h
                const active = hover === i
                const color = binColor(i)
                return (
                  <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} style={{ cursor: count > 0 ? 'pointer' : 'default' }}>
                    <rect x={x + barW * 0.12} y={PAD_T} width={barW * 0.76} height={plotH} fill="transparent" />
                    {count > 0 && (
                      <rect x={x + barW * 0.12} y={y} width={barW * 0.76} height={h} rx={2} fill={color} opacity={active ? 1 : 0.78} />
                    )}
                    {count > 0 && (
                      <text x={x + barW / 2} y={y - 3} textAnchor="middle" fontSize={8} fontWeight={700} fill={color} fontFamily="Orbitron, monospace">{count}</text>
                    )}
                    <text x={x + barW / 2} y={CHART_H - PAD_B + 12} textAnchor="middle" fontSize={7} fill={active ? color : '#64748b'} fontFamily="monospace">{binLabel(i)}</text>
                  </g>
                )
              })}
            </svg>

            {/* hover member list */}
            <div className="mt-3 min-h-[2.5rem] border-t border-slate-800 pt-2">
              {hover != null && bins[hover].length > 0 ? (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[0.55rem] font-mono uppercase tracking-wider mr-1" style={{ color: binColor(hover) }}>{binLabel(hover)} · {bins[hover].length}</span>
                  {bins[hover].map((s) => (
                    <Link key={s} href={`/focus/${encodeURIComponent(s)}`} className="text-[0.55rem] font-mono text-slate-400 border border-slate-800 hover:border-cyber-cyan/40 px-1.5 py-0.5 rounded transition-colors">{s}</Link>
                  ))}
                </div>
              ) : (
                <span className="text-[0.55rem] font-mono text-slate-600">Hover a bar to list member projects.</span>
              )}
            </div>
          </div>
        )}

        <p className="text-[0.5rem] font-mono text-slate-700 mt-4">
          Histogram of project <code>convergenceScore</code> (0–1, derived from goal-advancing reply turns over the last
          24h) bucketed into ten 0.1-wide bins. Bar height ∝ project count; color ramps red→amber→green by bin position.
          Hover a bar to list its member projects (click to open a project's Focus view). Header shows the fleet mean
          convergence and the count of projects in the top bin (≥0.9). Only projects with a score are counted. Reuses
          <code>/api/fleet</code>. Refreshes every 60s.
        </p>
      </main>
    </div>
  )
}
