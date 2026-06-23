'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import type { FleetResponse, FleetProject, ProjectState } from '../api/fleet/route'
import { useFreshness } from '../../lib/useFreshness'
import FreshnessBadge from '../../components/FreshnessBadge'

const STATES: ProjectState[] = ['idle', 'active', 'stalled', 'autonomous']
const PLATFORMS = ['discord', 'teams', 'whatsapp'] as const
type Platform = typeof PLATFORMS[number]

const STATE_COLOR: Record<ProjectState, string> = {
  idle: '#64748b',
  active: '#34d399',
  stalled: '#ef4444',
  autonomous: '#22d3ee',
}

export default function PlatformMatrixPage() {
  const { data, isStale, lastError, lastSuccessAt } = useFreshness<FleetResponse>('/api/fleet', 60_000)
  const loading = data === null && lastError === null

  const { grid, rowTotals, colTotals, grand, max } = useMemo(() => {
    const projects = (data?.projects ?? []) as FleetProject[]
    // grid[platform][state] = count
    const grid: Record<string, Record<string, number>> = {}
    for (const pf of PLATFORMS) {
      grid[pf] = {}
      for (const st of STATES) grid[pf][st] = 0
    }
    for (const p of projects) {
      const pf = (PLATFORMS as readonly string[]).includes(p.platform ?? 'discord') ? (p.platform as Platform) : 'discord'
      const st = STATES.includes(p.state) ? p.state : 'idle'
      grid[pf][st] += 1
    }
    const rowTotals: Record<string, number> = {}
    let grand = 0
    let max = 0
    for (const pf of PLATFORMS) {
      rowTotals[pf] = STATES.reduce((s, st) => s + grid[pf][st], 0)
      grand += rowTotals[pf]
      for (const st of STATES) max = Math.max(max, grid[pf][st])
    }
    const colTotals: Record<string, number> = {}
    for (const st of STATES) colTotals[st] = PLATFORMS.reduce((s, pf) => s + grid[pf][st], 0)
    return { grid, rowTotals, colTotals, grand, max: Math.max(1, max) }
  }, [data])

  if (loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center" style={{ background: '#060d1a' }}>
        <div className="text-xs font-mono text-slate-600 animate-pulse">Cross-tabbing fleet…</div>
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
            Platform × State Matrix
          </h1>
          <span className="text-[0.6rem] font-mono text-slate-500 border border-slate-700 px-2 py-0.5 rounded">exact fleet cross-tab with margins</span>
          <FreshnessBadge isStale={isStale} lastError={lastError} lastSuccessAt={lastSuccessAt} />
          <div className="flex-1" />
          <div className="flex items-center gap-1.5">
            <span className="text-[0.55rem] font-mono text-slate-500 uppercase tracking-wider">total</span>
            <span className="text-lg font-black tabular-nums text-cyber-cyan" style={{ fontFamily: 'Orbitron, monospace' }}>{grand}</span>
          </div>
        </div>
      </header>

      <main className="flex-1 p-6 max-w-3xl mx-auto w-full">
        <div className="rounded-xl border border-cyber-cyan/12 p-4 overflow-x-auto" style={{ background: 'rgba(0,245,255,0.02)' }}>
          <table className="w-full border-collapse" style={{ fontFamily: 'Orbitron, monospace' }}>
            <thead>
              <tr>
                <th className="text-left text-[0.55rem] font-mono text-slate-600 uppercase tracking-wider p-2"></th>
                {STATES.map((st) => (
                  <th key={st} className="p-2 text-[0.55rem] font-mono uppercase tracking-wider" style={{ color: STATE_COLOR[st] }}>{st}</th>
                ))}
                <th className="p-2 text-[0.55rem] font-mono text-slate-400 uppercase tracking-wider">Σ</th>
              </tr>
            </thead>
            <tbody>
              {PLATFORMS.map((pf) => (
                <tr key={pf}>
                  <td className="p-2 text-[0.6rem] font-bold text-slate-300 capitalize">{pf}</td>
                  {STATES.map((st) => {
                    const n = grid[pf][st]
                    return (
                      <td key={st} className="p-1 text-center">
                        <div className="mx-auto w-12 h-9 rounded flex items-center justify-center text-[0.7rem] font-black tabular-nums" style={{ background: n > 0 ? STATE_COLOR[st] : '#0f1b2e', opacity: n > 0 ? 0.18 + 0.82 * (n / max) : 1, color: n > 0 ? '#fff' : '#334155' }}>
                          {n}
                        </div>
                      </td>
                    )
                  })}
                  <td className="p-1 text-center text-[0.7rem] font-black tabular-nums text-slate-300">{rowTotals[pf]}</td>
                </tr>
              ))}
              <tr className="border-t border-slate-800">
                <td className="p-2 text-[0.55rem] font-mono text-slate-400 uppercase tracking-wider">Σ</td>
                {STATES.map((st) => (
                  <td key={st} className="p-1 text-center text-[0.7rem] font-black tabular-nums text-slate-300">{colTotals[st]}</td>
                ))}
                <td className="p-1 text-center text-[0.7rem] font-black tabular-nums text-cyber-cyan">{grand}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <p className="text-[0.5rem] font-mono text-slate-700 mt-4">
          Cross-tab of project count at each (platform, state) intersection. Cell background opacity ∝ count
          (empty cells faint); row totals (right), column totals (bottom), and grand total are shown in the margins.
          Reuses <code>/api/fleet</code>. Refreshes every 60s.
        </p>
      </main>
    </div>
  )
}
