'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import type { FleetResponse, FleetProject, BudgetStatus } from '../api/fleet/route'
import { useFreshness } from '../../lib/useFreshness'
import FreshnessBadge from '../../components/FreshnessBadge'

interface Pt {
  slug: string
  x: number // budget usage fraction 0..1
  y: number // convergenceScore 0..1
  age: number
  status: BudgetStatus
}

function statusColor(s: BudgetStatus): string {
  switch (s) {
    case 'ok': return '#34d399'
    case 'warning': return '#f59e0b'
    case 'critical': return '#ef4444'
    case 'exhausted': return '#b91c1c'
    default: return '#64748b'
  }
}

// Plot geometry (SVG user units).
const W = 520
const H = 420
const PAD = 44

export default function ConvergenceBudgetPage() {
  const { data, isStale, lastError, lastSuccessAt } = useFreshness<FleetResponse>('/api/fleet', 60_000)
  const loading = data === null && lastError === null
  const [hover, setHover] = useState<string | null>(null)

  const pts: Pt[] = useMemo(() => {
    const projects = (data?.projects ?? []) as FleetProject[]
    return projects
      .filter((p) => p.monthlyTokenBudget != null && p.monthlyTokenBudget > 0 && p.convergenceScore != null)
      .map((p) => ({
        slug: p.slug,
        x: Math.max(0, Math.min(1, (p.monthlyTokensUsed ?? 0) / p.monthlyTokenBudget!)),
        y: Math.max(0, Math.min(1, p.convergenceScore!)),
        age: p.ageMins,
        status: p.budgetStatus ?? 'ok',
      }))
  }, [data])

  // At-risk = high spend (x>0.5), low convergence (y<0.5) — bottom-right quadrant.
  const atRisk = pts.filter((p) => p.x > 0.5 && p.y < 0.5)

  const plotW = W - PAD * 2
  const plotH = H - PAD * 2
  const sx = (x: number) => PAD + x * plotW
  const sy = (y: number) => PAD + (1 - y) * plotH
  const maxAge = Math.max(1, ...pts.map((p) => p.age))
  const radius = (age: number) => 4 + (age / maxAge) * 9

  if (loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center" style={{ background: '#060d1a' }}>
        <div className="text-xs font-mono text-slate-600 animate-pulse">Plotting convergence vs budget…</div>
      </div>
    )
  }

  const hp = pts.find((p) => p.slug === hover)

  return (
    <div className="min-h-dvh flex flex-col" style={{ background: '#060d1a' }}>
      <header className="sticky top-0 z-30 border-b border-cyber-cyan/12 bg-[#060d1a]/90 backdrop-blur-md px-6 py-3">
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-cyber-cyan/40 to-transparent" />
        <div className="flex items-center gap-3 flex-wrap">
          <Link href="/" className="text-[0.6rem] font-mono text-slate-500 hover:text-cyber-cyan transition-colors uppercase tracking-wider">← Dashboard</Link>
          <h1 className="text-sm font-black tracking-[0.18em] text-cyber-cyan" style={{ fontFamily: 'Orbitron, JetBrains Mono, monospace' }}>
            Convergence vs Budget
          </h1>
          <span className="text-[0.6rem] font-mono text-slate-500 border border-slate-700 px-2 py-0.5 rounded">spot projects burning budget without converging</span>
          <FreshnessBadge isStale={isStale} lastError={lastError} lastSuccessAt={lastSuccessAt} />
          <div className="flex-1" />
          <div className="flex items-center gap-1.5">
            <span className="text-[0.55rem] font-mono text-slate-500 uppercase tracking-wider">at-risk</span>
            <span className="text-lg font-black tabular-nums" style={{ fontFamily: 'Orbitron, monospace', color: atRisk.length > 0 ? '#ef4444' : '#475569' }}>{atRisk.length}</span>
          </div>
        </div>
      </header>

      <main className="flex-1 p-6 max-w-3xl mx-auto w-full">
        {pts.length === 0 ? (
          <div className="h-64 flex items-center justify-center text-slate-600 text-xs font-mono">No projects with both a budget and a convergence score.</div>
        ) : (
          <div className="rounded-xl border border-cyber-cyan/12 p-4 relative" style={{ background: 'rgba(0,245,255,0.02)' }}>
            <svg viewBox={`0 0 ${W} ${H}`} width="100%" preserveAspectRatio="xMidYMid meet">
              {/* quadrant guides */}
              <line x1={sx(0.5)} x2={sx(0.5)} y1={PAD} y2={H - PAD} stroke="#334155" strokeWidth={0.6} strokeDasharray="3 3" />
              <line x1={PAD} x2={W - PAD} y1={sy(0.5)} y2={sy(0.5)} stroke="#334155" strokeWidth={0.6} strokeDasharray="3 3" />
              {/* axes box */}
              <rect x={PAD} y={PAD} width={plotW} height={plotH} fill="none" stroke="#1e293b" strokeWidth={0.8} />
              {/* quadrant labels */}
              <text x={sx(0.02)} y={sy(0.97)} fontSize={8} fill="#34d399" fontFamily="monospace">efficient</text>
              <text x={sx(0.98)} y={sy(0.97)} fontSize={8} fill="#f59e0b" textAnchor="end" fontFamily="monospace">heavy &amp; converging</text>
              <text x={sx(0.02)} y={sy(0.04)} fontSize={8} fill="#64748b" fontFamily="monospace">early / idle</text>
              <text x={sx(0.98)} y={sy(0.04)} fontSize={8} fill="#ef4444" textAnchor="end" fontFamily="monospace">burning — at risk</text>
              {/* axis labels */}
              <text x={PAD + plotW / 2} y={H - 12} textAnchor="middle" fontSize={8} fill="#64748b" fontFamily="monospace">budget usage →</text>
              <text x={14} y={PAD + plotH / 2} textAnchor="middle" fontSize={8} fill="#64748b" fontFamily="monospace" transform={`rotate(-90 14 ${PAD + plotH / 2})`}>convergence →</text>
              {/* points */}
              {pts.map((p) => {
                const active = hover === p.slug
                return (
                  <circle
                    key={p.slug}
                    cx={sx(p.x)} cy={sy(p.y)} r={radius(p.age)}
                    fill={statusColor(p.status)}
                    fillOpacity={active ? 0.95 : 0.55}
                    stroke={active ? '#fff' : statusColor(p.status)}
                    strokeWidth={active ? 1.2 : 0.5}
                    onMouseEnter={() => setHover(p.slug)}
                    onMouseLeave={() => setHover(null)}
                    style={{ cursor: 'pointer' }}
                  />
                )
              })}
            </svg>

            {hp && (
              <div className="absolute top-6 right-6 bg-[#0a1424] border border-cyber-cyan/30 rounded px-2.5 py-1.5 text-[0.55rem] font-mono pointer-events-none">
                <div className="font-bold text-slate-100" style={{ fontFamily: 'Orbitron, monospace' }}>{hp.slug}</div>
                <div className="text-slate-400">convergence {Math.round(hp.y * 100)}% · budget {Math.round(hp.x * 100)}%</div>
                <div className="text-slate-500">age {hp.age >= 60 ? `${(hp.age / 60).toFixed(1)}h` : `${Math.round(hp.age)}m`}</div>
              </div>
            )}

            <div className="mt-3 flex items-center gap-3 text-[0.55rem] font-mono text-slate-500 flex-wrap border-t border-slate-800 pt-2">
              {(['ok', 'warning', 'critical', 'exhausted'] as BudgetStatus[]).map((s) => (
                <span key={s} className="flex items-center gap-1.5"><span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: statusColor(s) }} />{s}</span>
              ))}
              <span className="text-slate-600">· bubble size ∝ age</span>
            </div>
          </div>
        )}

        <p className="text-[0.5rem] font-mono text-slate-700 mt-4">
          Bubble per project with both a <code>monthlyTokenBudget</code> and a <code>convergenceScore</code>.
          x = budget usage fraction, y = convergence, radius ∝ <code>ageMins</code>, color by <code>budgetStatus</code>.
          Quadrant guides cross at 50/50; the bottom-right quadrant (high spend, low convergence) is the at-risk zone counted in the header.
          Reuses <code>/api/fleet</code>. Refreshes every 60s.
        </p>
      </main>
    </div>
  )
}
