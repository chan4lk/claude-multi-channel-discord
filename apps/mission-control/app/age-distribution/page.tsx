'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import type { FleetResponse, FleetProject } from '../api/fleet/route'
import { useFreshness } from '../../lib/useFreshness'
import FreshnessBadge from '../../components/FreshnessBadge'

interface Band {
  label: string
  max: number // upper bound in minutes (Infinity for the last band)
  color: string
}

// Log-ish age bands, cool→warm by age.
const BANDS: Band[] = [
  { label: '<5m', max: 5, color: '#22d3ee' },
  { label: '5–15m', max: 15, color: '#34d399' },
  { label: '15–60m', max: 60, color: '#a3e635' },
  { label: '1–4h', max: 240, color: '#f59e0b' },
  { label: '4–12h', max: 720, color: '#f97316' },
  { label: '12h+', max: Infinity, color: '#ef4444' },
]

function bandIndex(ageMins: number): number {
  for (let i = 0; i < BANDS.length; i++) {
    if (ageMins < BANDS[i].max) return i
  }
  return BANDS.length - 1
}

function fmtAge(mins: number): string {
  if (mins >= 60) return `${(mins / 60).toFixed(1)}h`
  return `${Math.round(mins)}m`
}

const CHART_W = 600
const CHART_H = 240
const PAD_L = 28
const PAD_B = 28
const PAD_T = 12

export default function AgeDistributionPage() {
  const { data, isStale, lastError, lastSuccessAt } = useFreshness<FleetResponse>('/api/fleet', 60_000)
  const loading = data === null && lastError === null
  const [hover, setHover] = useState<number | null>(null)

  const { buckets, median, idleOver4h, total } = useMemo(() => {
    const projects = (data?.projects ?? []) as FleetProject[]
    const buckets: string[][] = BANDS.map(() => [])
    const ages: number[] = []
    for (const p of projects) {
      if (p.ageMins == null) continue
      ages.push(p.ageMins)
      buckets[bandIndex(p.ageMins)].push(p.slug)
    }
    ages.sort((a, b) => a - b)
    const median = ages.length === 0 ? 0
      : ages.length % 2 === 1 ? ages[(ages.length - 1) / 2]
      : (ages[ages.length / 2 - 1] + ages[ages.length / 2]) / 2
    const idleOver4h = ages.filter((a) => a >= 240).length
    return { buckets, median, idleOver4h, total: ages.length }
  }, [data])

  const maxCount = Math.max(1, ...buckets.map((b) => b.length))
  const plotW = CHART_W - PAD_L
  const plotH = CHART_H - PAD_B - PAD_T
  const barW = plotW / BANDS.length

  if (loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center" style={{ background: '#060d1a' }}>
        <div className="text-xs font-mono text-slate-600 animate-pulse">Bucketing fleet age…</div>
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
            Fleet Age Distribution
          </h1>
          <span className="text-[0.6rem] font-mono text-slate-500 border border-slate-700 px-2 py-0.5 rounded">shape of fleet freshness at a glance</span>
          <FreshnessBadge isStale={isStale} lastError={lastError} lastSuccessAt={lastSuccessAt} />
          <div className="flex-1" />
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5">
              <span className="text-[0.55rem] font-mono text-slate-500 uppercase tracking-wider">median</span>
              <span className="text-lg font-black tabular-nums text-cyber-cyan" style={{ fontFamily: 'Orbitron, monospace' }}>{fmtAge(median)}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[0.55rem] font-mono text-slate-500 uppercase tracking-wider">idle &gt;4h</span>
              <span className="text-lg font-black tabular-nums" style={{ fontFamily: 'Orbitron, monospace', color: idleOver4h > 0 ? '#f97316' : '#475569' }}>{idleOver4h}</span>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 p-6 max-w-3xl mx-auto w-full">
        {total === 0 ? (
          <div className="h-64 flex items-center justify-center text-slate-600 text-xs font-mono">No projects with an age reading.</div>
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
              {BANDS.map((band, i) => {
                const count = buckets[i].length
                const h = (count / maxCount) * plotH
                const x = PAD_L + i * barW
                const y = PAD_T + plotH - h
                const active = hover === i
                return (
                  <g key={band.label} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} style={{ cursor: count > 0 ? 'pointer' : 'default' }}>
                    <rect x={x + barW * 0.12} y={PAD_T} width={barW * 0.76} height={plotH} fill="transparent" />
                    {count > 0 && (
                      <rect x={x + barW * 0.12} y={y} width={barW * 0.76} height={h} rx={2} fill={band.color} opacity={active ? 1 : 0.78} />
                    )}
                    {count > 0 && (
                      <text x={x + barW / 2} y={y - 3} textAnchor="middle" fontSize={8} fontWeight={700} fill={band.color} fontFamily="Orbitron, monospace">{count}</text>
                    )}
                    <text x={x + barW / 2} y={CHART_H - PAD_B + 12} textAnchor="middle" fontSize={7.5} fill={active ? band.color : '#64748b'} fontFamily="monospace">{band.label}</text>
                  </g>
                )
              })}
            </svg>

            {/* hover member list */}
            <div className="mt-3 min-h-[2.5rem] border-t border-slate-800 pt-2">
              {hover != null && buckets[hover].length > 0 ? (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[0.55rem] font-mono uppercase tracking-wider mr-1" style={{ color: BANDS[hover].color }}>{BANDS[hover].label} · {buckets[hover].length}</span>
                  {buckets[hover].map((s) => (
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
          Histogram of project <code>ageMins</code> (minutes since last activity) across fixed bands:
          &lt;5m, 5–15m, 15–60m, 1–4h, 4–12h, 12h+. Bar height ∝ project count; color scales cool→warm with band age.
          Hover a bar to list its member projects (click to open a project's Focus view). Header shows median fleet age
          and the count of projects idle &gt;4h. Reuses <code>/api/fleet</code>. Refreshes every 60s.
        </p>
      </main>
    </div>
  )
}
