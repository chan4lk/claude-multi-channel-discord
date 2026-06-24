'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import type { FleetResponse, FleetProject } from '../api/fleet/route'
import { useFreshness } from '../../lib/useFreshness'
import FreshnessBadge from '../../components/FreshnessBadge'

type Band = 'active' | 'paused' | 'completed' | 'none'

const BAND_META: { key: Band; label: string; color: string }[] = [
  { key: 'active', label: 'active', color: '#22d3ee' },
  { key: 'paused', label: 'paused', color: '#f59e0b' },
  { key: 'completed', label: 'completed', color: '#34d399' },
  { key: 'none', label: 'no goal', color: '#64748b' },
]

export default function GoalFunnelPage() {
  const { data, isStale, lastError, lastSuccessAt } = useFreshness<FleetResponse>('/api/fleet', 60_000)
  const loading = data === null && lastError === null

  const { counts, total, withGoal, completionRate } = useMemo(() => {
    const projects = (data?.projects ?? []) as FleetProject[]
    const counts: Record<Band, number> = { active: 0, paused: 0, completed: 0, none: 0 }
    for (const p of projects) {
      const b: Band = p.goalStatus ?? 'none'
      counts[b] += 1
    }
    const total = projects.length
    const withGoal = counts.active + counts.paused + counts.completed
    const completionRate = withGoal > 0 ? counts.completed / withGoal : 0
    return { counts, total, withGoal, completionRate }
  }, [data])

  if (loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center" style={{ background: '#060d1a' }}>
        <div className="text-xs font-mono text-slate-600 animate-pulse">Tallying goal lifecycle…</div>
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
            Goal Status Funnel
          </h1>
          <span className="text-[0.6rem] font-mono text-slate-500 border border-slate-700 px-2 py-0.5 rounded">how the fleet's goals distribute across the lifecycle</span>
          <FreshnessBadge isStale={isStale} lastError={lastError} lastSuccessAt={lastSuccessAt} />
          <div className="flex-1" />
          <div className="flex items-center gap-1.5">
            <span className="text-[0.55rem] font-mono text-slate-500 uppercase tracking-wider">completion</span>
            <span className="text-lg font-black tabular-nums" style={{ fontFamily: 'Orbitron, monospace', color: '#34d399' }}>{Math.round(completionRate * 100)}%</span>
          </div>
        </div>
      </header>

      <main className="flex-1 p-6 max-w-2xl mx-auto w-full">
        {total === 0 ? (
          <div className="h-64 flex items-center justify-center text-slate-600 text-xs font-mono">No projects to tally.</div>
        ) : (
          <div className="rounded-xl border border-cyber-cyan/12 p-5 space-y-3" style={{ background: 'rgba(0,245,255,0.02)' }}>
            {BAND_META.map(({ key, label, color }) => {
              const n = counts[key]
              const pct = total > 0 ? n / total : 0
              return (
                <Link key={key} href="/goals" className="group block">
                  <div className="flex items-center gap-3">
                    <div className="w-20 shrink-0 text-right text-[0.6rem] font-mono uppercase tracking-wider" style={{ color }}>{label}</div>
                    <div className="flex-1 h-7 rounded bg-[#0f1b2e] overflow-hidden relative">
                      <div className="h-full rounded transition-all group-hover:brightness-125" style={{ width: `${Math.max(pct * 100, n > 0 ? 4 : 0)}%`, background: color, opacity: 0.8 }} />
                      <span className="absolute inset-y-0 left-2 flex items-center text-[0.6rem] font-black tabular-nums text-white/90" style={{ fontFamily: 'Orbitron, monospace' }}>{n}</span>
                    </div>
                    <div className="w-12 shrink-0 text-right text-[0.55rem] font-mono tabular-nums text-slate-500">{Math.round(pct * 100)}%</div>
                  </div>
                </Link>
              )
            })}
          </div>
        )}

        <div className="mt-4 text-[0.55rem] font-mono text-slate-500">
          {withGoal} of {total} projects have a goal · {counts.completed} completed
        </div>

        <p className="text-[0.5rem] font-mono text-slate-700 mt-4">
          Proportional bars for each <code>goalStatus</code> band (active / paused / completed) plus projects with no
          goal, each labeled with count and percentage of the fleet. The header completion rate is completed ÷
          projects-that-have-a-goal. Click any band to open the Goals view. Reuses <code>/api/fleet</code>. Refreshes every 60s.
        </p>
      </main>
    </div>
  )
}
