'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import type { FleetResponse, FleetProject } from '../api/fleet/route'
import { useFreshness } from '../../lib/useFreshness'
import FreshnessBadge from '../../components/FreshnessBadge'

const AXES = ['convergence', 'budget', 'freshness', 'context'] as const
type AxisKey = typeof AXES[number]
const AXIS_LABEL: Record<AxisKey, string> = {
  convergence: 'conv',
  budget: 'budget',
  freshness: 'fresh',
  context: 'ctx',
}

interface Card {
  slug: string
  axes: Record<AxisKey, number> // each 0..1, higher = healthier
  mean: number
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n))
}

function vitals(p: FleetProject): Card {
  const convergence = clamp01(p.convergenceScore ?? 0)
  const budget = p.monthlyTokenBudget && p.monthlyTokenBudget > 0
    ? clamp01(1 - (p.monthlyTokensUsed ?? 0) / p.monthlyTokenBudget)
    : 1 // no budget cap → full headroom
  const freshness = p.stuckThresholdMinutes > 0 ? clamp01(1 - p.ageMins / p.stuckThresholdMinutes) : 1
  const context = p.contextUsagePct != null ? clamp01(1 - p.contextUsagePct / 100) : 1
  const axes = { convergence, budget, freshness, context }
  const mean = (convergence + budget + freshness + context) / 4
  return { slug: p.slug, axes, mean }
}

const R = 38 // radar radius
const CX = 50
const CY = 50

// Point on the radar for axis index i (of 4) at value v (0..1).
function pt(i: number, v: number): [number, number] {
  const angle = -Math.PI / 2 + (i * 2 * Math.PI) / AXES.length
  return [CX + Math.cos(angle) * R * v, CY + Math.sin(angle) * R * v]
}

function healthColor(mean: number): string {
  if (mean >= 0.67) return '#34d399'
  if (mean >= 0.34) return '#f59e0b'
  return '#ef4444'
}

function RadarCard({ c }: { c: Card }) {
  const color = healthColor(c.mean)
  const poly = AXES.map((k, i) => pt(i, c.axes[k]).join(',')).join(' ')
  return (
    <Link href={`/focus/${encodeURIComponent(c.slug)}`} className="group block rounded-lg border border-cyber-cyan/12 p-2 transition-colors hover:border-cyber-cyan/40" style={{ background: 'rgba(0,245,255,0.02)' }}>
      <svg viewBox="0 0 100 100" width="100%">
        {/* grid rings */}
        {[0.33, 0.66, 1].map((r) => (
          <polygon key={r} points={AXES.map((_, i) => pt(i, r).join(',')).join(' ')} fill="none" stroke="#1e293b" strokeWidth={0.5} />
        ))}
        {/* spokes + axis labels */}
        {AXES.map((k, i) => {
          const [x, y] = pt(i, 1)
          const [lx, ly] = pt(i, 1.22)
          return (
            <g key={k}>
              <line x1={CX} y1={CY} x2={x} y2={y} stroke="#1e293b" strokeWidth={0.4} />
              <text x={lx} y={ly + 1} fontSize={5.5} textAnchor="middle" fill="#64748b" fontFamily="monospace">{AXIS_LABEL[k]}</text>
            </g>
          )
        })}
        {/* value polygon */}
        <polygon points={poly} fill={color} fillOpacity={0.28} stroke={color} strokeWidth={1.2} />
        {AXES.map((k, i) => {
          const [x, y] = pt(i, c.axes[k])
          return <circle key={k} cx={x} cy={y} r={1.3} fill={color} />
        })}
      </svg>
      <div className="mt-1 flex items-center justify-between">
        <span className="text-[0.6rem] font-bold text-slate-200 truncate" style={{ fontFamily: 'Orbitron, monospace' }}>{c.slug}</span>
        <span className="text-[0.6rem] font-black tabular-nums" style={{ fontFamily: 'Orbitron, monospace', color }}>{Math.round(c.mean * 100)}</span>
      </div>
    </Link>
  )
}

export default function VitalsPage() {
  const { data, isStale, lastError, lastSuccessAt } = useFreshness<FleetResponse>('/api/fleet', 60_000)
  const loading = data === null && lastError === null

  const cards: Card[] = useMemo(() => {
    const projects = (data?.projects ?? []) as FleetProject[]
    return projects.map(vitals).sort((a, b) => b.mean - a.mean)
  }, [data])

  if (loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center" style={{ background: '#060d1a' }}>
        <div className="text-xs font-mono text-slate-600 animate-pulse">Reading project vitals…</div>
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
            Project Vitals
          </h1>
          <span className="text-[0.6rem] font-mono text-slate-500 border border-slate-700 px-2 py-0.5 rounded">whole-project health shape, side by side</span>
          <FreshnessBadge isStale={isStale} lastError={lastError} lastSuccessAt={lastSuccessAt} />
          <div className="flex-1" />
          <span className="text-[0.55rem] font-mono text-slate-600">bigger polygon = healthier · {cards.length} projects</span>
        </div>
      </header>

      <main className="flex-1 p-6 max-w-6xl mx-auto w-full">
        {cards.length === 0 ? (
          <div className="h-64 flex items-center justify-center text-slate-600 text-xs font-mono">No projects to render.</div>
        ) : (
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))' }}>
            {cards.map((c) => <RadarCard key={c.slug} c={c} />)}
          </div>
        )}

        <p className="text-[0.5rem] font-mono text-slate-700 mt-6">
          One radar per project on four normalized axes (0–1, higher = healthier): convergence (<code>convergenceScore</code>),
          budget headroom (1 − usage fraction), freshness (1 − <code>ageMins</code>/<code>stuckThresholdMinutes</code>), and
          context headroom (1 − <code>contextUsagePct</code>). Missing data renders at the relevant axis's full/zero default rather than
          dropping the project. Cards sorted by mean axis value desc; click to open Focus. Reuses <code>/api/fleet</code>. Refreshes every 60s.
        </p>
      </main>
    </div>
  )
}
