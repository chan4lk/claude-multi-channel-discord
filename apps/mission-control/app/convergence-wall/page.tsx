'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import type { FleetResponse, FleetProject } from '../api/fleet/route'
import { useFreshness } from '../../lib/useFreshness'
import FreshnessBadge from '../../components/FreshnessBadge'

interface Gauge { slug: string; score: number; goalText: string }

// Threshold bands: red <40, amber <70, green ≥70.
function bandColor(score: number): string {
  if (score >= 70) return '#34d399' // green
  if (score >= 40) return '#f59e0b' // amber
  return '#ef4444' // red
}

function bandLabel(score: number): string {
  if (score >= 70) return 'converging'
  if (score >= 40) return 'partial'
  return 'diverging'
}

// 270° sweep radial gauge (gap at bottom). Returns the arc path for a fraction.
const R = 46
const STROKE = 9
const START = 135 // degrees; arc sweeps clockwise to 405 (=45)
const SWEEP = 270

function polar(cx: number, cy: number, r: number, deg: number) {
  const rad = (deg * Math.PI) / 180
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) }
}

function arcPath(cx: number, cy: number, r: number, frac: number): string {
  const f = Math.max(0, Math.min(1, frac))
  const endDeg = START + SWEEP * f
  const a = polar(cx, cy, r, START)
  const b = polar(cx, cy, r, endDeg)
  const large = SWEEP * f > 180 ? 1 : 0
  return `M ${a.x.toFixed(2)} ${a.y.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${b.x.toFixed(2)} ${b.y.toFixed(2)}`
}

function GaugeCard({ g }: { g: Gauge }) {
  const c = bandColor(g.score)
  const SIZE = 120
  const cx = SIZE / 2, cy = SIZE / 2
  return (
    <Link href={`/goals?slug=${encodeURIComponent(g.slug)}`} className="group">
      <div
        className="rounded-xl border border-cyber-cyan/12 p-3 flex flex-col items-center transition-colors group-hover:border-cyber-cyan/30"
        style={{ background: 'rgba(0,245,255,0.02)' }}
      >
        <svg viewBox={`0 0 ${SIZE} ${SIZE}`} width={SIZE} height={SIZE}>
          {/* track */}
          <path d={arcPath(cx, cy, R, 1)} fill="none" stroke="#1e293b" strokeWidth={STROKE} strokeLinecap="round" />
          {/* fill */}
          <path d={arcPath(cx, cy, R, g.score / 100)} fill="none" stroke={c} strokeWidth={STROKE} strokeLinecap="round" />
          <text x={cx} y={cy - 2} textAnchor="middle" fontSize={22} fontWeight={800} fill={c} fontFamily="Orbitron, monospace">{g.score}</text>
          <text x={cx} y={cy + 14} textAnchor="middle" fontSize={8} fill="#64748b" fontFamily="JetBrains Mono, monospace" letterSpacing="0.1em">{bandLabel(g.score).toUpperCase()}</text>
        </svg>
        <div className="mt-1 text-[0.7rem] font-bold text-slate-200 truncate max-w-[120px]" style={{ fontFamily: 'Orbitron, monospace' }}>{g.slug}</div>
        <div className="mt-0.5 text-[0.5rem] font-mono text-slate-500 text-center line-clamp-2 max-w-[130px]">{g.goalText}</div>
      </div>
    </Link>
  )
}

export default function ConvergenceWallPage() {
  const { data, isStale, lastError, lastSuccessAt } = useFreshness<FleetResponse>('/api/fleet', 60_000)
  const loading = data === null && lastError === null

  const gauges: Gauge[] = useMemo(() => {
    const projects = (data?.projects ?? []) as FleetProject[]
    return projects
      .filter((p) => p.goalText && p.goalText.trim().length > 0)
      .map((p) => ({ slug: p.slug, score: Math.round(p.convergenceScore ?? 0), goalText: p.goalText! }))
      .sort((a, b) => b.score - a.score)
  }, [data])

  const fleetAvg = useMemo(() => {
    if (data?.avgConvergence != null) return data.avgConvergence
    if (gauges.length === 0) return 0
    return Math.round(gauges.reduce((s, g) => s + g.score, 0) / gauges.length)
  }, [data, gauges])

  if (loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center" style={{ background: '#060d1a' }}>
        <div className="text-xs font-mono text-slate-600 animate-pulse">Measuring goal convergence…</div>
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
            Goal Convergence Gauge Wall
          </h1>
          <span className="text-[0.6rem] font-mono text-slate-500 border border-slate-700 px-2 py-0.5 rounded">how close each project is to its goal</span>
          <FreshnessBadge isStale={isStale} lastError={lastError} lastSuccessAt={lastSuccessAt} />
          <div className="flex-1" />
          <div className="flex items-center gap-2">
            <span className="text-[0.55rem] font-mono text-slate-500 uppercase tracking-wider">fleet avg</span>
            <span className="text-lg font-black" style={{ fontFamily: 'Orbitron, monospace', color: bandColor(fleetAvg) }}>{fleetAvg}</span>
          </div>
          <Link href="/goals" className="text-[0.6rem] font-mono text-slate-500 hover:text-cyber-cyan transition-colors border border-slate-700 hover:border-cyber-cyan/30 px-2 py-1 rounded">Goals →</Link>
        </div>
      </header>

      <main className="flex-1 p-6 max-w-6xl mx-auto w-full">
        {gauges.length === 0 ? (
          <div className="h-64 flex items-center justify-center text-slate-600 text-xs font-mono">No projects with a defined goal.</div>
        ) : (
          <>
            <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
              {gauges.map((g) => <GaugeCard key={g.slug} g={g} />)}
            </div>

            {/* band legend */}
            <div className="mt-6 flex items-center gap-4 text-[0.55rem] font-mono text-slate-500">
              <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded-sm" style={{ background: '#ef4444' }} />diverging &lt;40</span>
              <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded-sm" style={{ background: '#f59e0b' }} />partial 40–69</span>
              <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded-sm" style={{ background: '#34d399' }} />converging ≥70</span>
            </div>
          </>
        )}

        <p className="text-[0.5rem] font-mono text-slate-700 mt-4">
          One radial gauge per project that defines a goal. Arc fill ∝ <code>convergenceScore</code> (0–100); color bands red/amber/green by
          threshold. Gauges sorted by score descending. Click a gauge to open that project in Goals. Reuses <code>/api/fleet</code>;
          projects without a goal are omitted. Refreshes every 60s.
        </p>
      </main>
    </div>
  )
}
