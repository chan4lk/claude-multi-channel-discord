'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import type { FleetResponse, FleetProject } from '../api/fleet/route'
import { useFreshness } from '../../lib/useFreshness'
import FreshnessBadge from '../../components/FreshnessBadge'
import { scoreProject, attentionColor, ATTENTION_THRESHOLD, type AttentionScore } from '../../lib/attention'

export default function HeatStripPage() {
  const { data, isStale, lastError, lastSuccessAt } = useFreshness<FleetResponse>('/api/fleet', 60_000)
  const loading = data === null && lastError === null
  const [hover, setHover] = useState<string | null>(null)

  const cells: AttentionScore[] = useMemo(() => {
    const projects = (data?.projects ?? []) as FleetProject[]
    return projects.map(scoreProject).sort((a, b) => b.total - a.total)
  }, [data])

  const stats = useMemo(() => {
    if (cells.length === 0) return { min: 0, median: 0, max: 0, flagged: 0 }
    const sorted = [...cells].map((c) => c.total).sort((a, b) => a - b)
    const n = sorted.length
    const median = n % 2 === 1 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2
    return { min: sorted[0], median, max: sorted[n - 1], flagged: cells.filter((c) => c.total >= ATTENTION_THRESHOLD).length }
  }, [cells])

  const hc = cells.find((c) => c.slug === hover)

  if (loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center" style={{ background: '#060d1a' }}>
        <div className="text-xs font-mono text-slate-600 animate-pulse">Building heat strip…</div>
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
            Fleet Attention Heat Strip
          </h1>
          <span className="text-[0.6rem] font-mono text-slate-500 border border-slate-700 px-2 py-0.5 rounded">whole fleet, one dense glance — is anything red?</span>
          <FreshnessBadge isStale={isStale} lastError={lastError} lastSuccessAt={lastSuccessAt} />
          <div className="flex-1" />
          <div className="flex items-center gap-3 text-[0.6rem] font-mono">
            <span className="text-slate-500">min <b className="tabular-nums" style={{ color: attentionColor(stats.min) }}>{Math.round(stats.min)}</b></span>
            <span className="text-slate-500">med <b className="tabular-nums" style={{ color: attentionColor(stats.median) }}>{Math.round(stats.median)}</b></span>
            <span className="text-slate-500">max <b className="tabular-nums" style={{ color: attentionColor(stats.max) }}>{Math.round(stats.max)}</b></span>
          </div>
        </div>
      </header>

      <main className="flex-1 p-6 max-w-5xl mx-auto w-full">
        {cells.length === 0 ? (
          <div className="h-64 flex items-center justify-center text-slate-600 text-xs font-mono">No projects to score.</div>
        ) : (
          <>
            <div className="rounded-xl border border-cyber-cyan/12 p-4" style={{ background: 'rgba(0,245,255,0.02)' }}>
              <div className="flex flex-wrap gap-1.5">
                {cells.map((c) => (
                  <Link
                    key={c.slug}
                    href={`/focus/${encodeURIComponent(c.slug)}`}
                    onMouseEnter={() => setHover(c.slug)}
                    onMouseLeave={() => setHover(null)}
                    className="relative w-9 h-9 rounded-md transition-transform hover:scale-110"
                    style={{ background: attentionColor(c.total), opacity: hover && hover !== c.slug ? 0.5 : 1, boxShadow: c.total >= ATTENTION_THRESHOLD ? '0 0 8px rgba(239,68,68,0.6)' : 'none' }}
                    title={`${c.slug} · ${Math.round(c.total)} · ${c.reason}`}
                  >
                    <span className="absolute inset-0 flex items-center justify-center text-[0.55rem] font-black tabular-nums text-black/70" style={{ fontFamily: 'Orbitron, monospace' }}>{Math.round(c.total)}</span>
                  </Link>
                ))}
              </div>
            </div>

            {/* hover detail */}
            <div className="mt-3 min-h-[1.5rem]">
              {hc ? (
                <div className="text-[0.6rem] font-mono">
                  <span className="font-bold text-slate-200" style={{ fontFamily: 'Orbitron, monospace' }}>{hc.slug}</span>
                  <span className="text-slate-500"> · score </span>
                  <span className="font-black tabular-nums" style={{ color: attentionColor(hc.total) }}>{Math.round(hc.total)}</span>
                  <span className="text-slate-500"> · {hc.reason}</span>
                </div>
              ) : (
                <span className="text-[0.55rem] font-mono text-slate-600">Hover a cell for slug, score and dominant reason. {stats.flagged} flagged ≥{ATTENTION_THRESHOLD}.</span>
              )}
            </div>

            <div className="mt-6 flex items-center gap-4 text-[0.55rem] font-mono text-slate-500 flex-wrap">
              <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded-sm" style={{ background: '#34d399' }} />calm</span>
              <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded-sm" style={{ background: '#a3e635' }} />minor</span>
              <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded-sm" style={{ background: '#f59e0b' }} />elevated</span>
              <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded-sm" style={{ background: '#ef4444' }} />needs attention ≥{ATTENTION_THRESHOLD}</span>
            </div>
          </>
        )}

        <p className="text-[0.5rem] font-mono text-slate-700 mt-4">
          One cell per project, colored by the same composite attention score as <code>/scoreboard</code>
          (shared via <code>lib/attention.ts</code>): budget pressure, stuck headroom, context-fill urgency, and
          queue/circuit state. Cells sort by score desc so hot cells cluster top-left. Hover for slug/score/reason;
          click to open Focus. Header shows fleet min/median/max. Reuses <code>/api/fleet</code>. Refreshes every 60s.
        </p>
      </main>
    </div>
  )
}
