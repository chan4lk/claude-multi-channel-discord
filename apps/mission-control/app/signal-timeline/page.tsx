'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import type { SignalTimelineResponse } from '../api/signal-timeline/route'
import { useFreshness } from '../../lib/useFreshness'
import FreshnessBadge from '../../components/FreshnessBadge'

// Cell base color by dominant severity; intensity scales the alpha.
const SEV_RGB: Record<string, string> = {
  critical: '239,68,68',
  warn: '251,191,36',
  info: '0,245,255',
  ok: '148,163,184',
}

function fmtDay(d: string): string {
  // d is YYYY-MM-DD; show MM-DD compactly.
  return d.slice(5)
}

export default function SignalTimelinePage() {
  const { data, isStale, lastError, lastSuccessAt } = useFreshness<SignalTimelineResponse>('/api/signal-timeline', 60_000)
  const loading = data === null && lastError === null
  const [hover, setHover] = useState<{ signal: string; date: string } | null>(null)

  const { days, signals, grid, max, total, dominantSignal } = useMemo(() => ({
    days: data?.days ?? [],
    signals: data?.signals ?? [],
    grid: data?.grid ?? {},
    max: data?.max ?? 0,
    total: data?.total ?? 0,
    dominantSignal: data?.dominantSignal ?? null,
  }), [data])

  if (loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center" style={{ background: '#060d1a' }}>
        <div className="text-xs font-mono text-slate-600 animate-pulse">Loading attention signal history…</div>
      </div>
    )
  }

  const cellAt = (sig: string, d: string) => grid[sig]?.[d]

  return (
    <div className="min-h-dvh flex flex-col" style={{ background: '#060d1a' }}>
      <header className="sticky top-0 z-30 border-b border-cyber-cyan/12 bg-[#060d1a]/90 backdrop-blur-md px-6 py-3">
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-cyber-cyan/40 to-transparent" />
        <div className="flex items-center gap-3 flex-wrap">
          <Link href="/" className="text-[0.6rem] font-mono text-slate-500 hover:text-cyber-cyan transition-colors uppercase tracking-wider">← Dashboard</Link>
          <h1 className="text-sm font-black tracking-[0.18em] text-cyber-cyan" style={{ fontFamily: 'Orbitron, JetBrains Mono, monospace' }}>
            Attention Signal Timeline
          </h1>
          <span className="text-[0.6rem] font-mono text-slate-500 border border-slate-700 px-2 py-0.5 rounded">which signals recur, and when?</span>
          <FreshnessBadge isStale={isStale} lastError={lastError} lastSuccessAt={lastSuccessAt} />
          <div className="flex-1" />
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5">
              <span className="text-[0.55rem] font-mono text-slate-500 uppercase tracking-wider">dominant</span>
              <span className="text-xs font-black tabular-nums" style={{ fontFamily: 'Orbitron, monospace', color: dominantSignal ? '#A78BFA' : '#475569' }}>
                {dominantSignal ?? '—'}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[0.55rem] font-mono text-slate-500 uppercase tracking-wider">events</span>
              <span className="text-lg font-black tabular-nums text-cyber-cyan" style={{ fontFamily: 'Orbitron, monospace' }}>{total}</span>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 p-6 max-w-6xl mx-auto w-full">
        {total === 0 ? (
          <div className="h-64 flex items-center justify-center text-slate-600 text-xs font-mono text-center px-6">
            No attention history yet. Findings are recorded each time the Fleet Brief computes — open <Link href="/brief" className="text-cyber-cyan underline mx-1">Fleet Brief</Link> to start populating the timeline.
          </div>
        ) : (
          <div className="rounded-xl border border-cyber-cyan/12 p-4 overflow-x-auto" style={{ background: 'rgba(0,245,255,0.02)' }}>
            <div className="inline-flex flex-col gap-0.5 min-w-max">
              {/* day header */}
              <div className="flex gap-0.5 items-end pl-24">
                {days.map((d, i) => (
                  <div key={d} className="w-3.5 text-center text-[0.4rem] font-mono text-slate-600">{i % 3 === 0 ? fmtDay(d) : ''}</div>
                ))}
              </div>
              {signals.map((sig) => (
                <div key={sig} className="flex gap-0.5 items-center">
                  <div className="w-24 text-[0.55rem] font-mono text-slate-400 text-right pr-2 truncate" title={sig}>{sig}</div>
                  {days.map((d) => {
                    const cell = cellAt(sig, d)
                    const count = cell?.count ?? 0
                    const intensity = max > 0 ? count / max : 0
                    const rgb = SEV_RGB[cell?.severity ?? 'ok'] ?? SEV_RGB.ok
                    const active = hover?.signal === sig && hover?.date === d
                    return (
                      <div
                        key={d}
                        onMouseEnter={() => setHover({ signal: sig, date: d })}
                        onMouseLeave={() => setHover(null)}
                        className="w-3.5 h-3.5 rounded-sm cursor-pointer"
                        style={{
                          background: count === 0 ? 'rgba(148,163,184,0.06)' : `rgba(${rgb},${0.2 + intensity * 0.8})`,
                          outline: active ? '1px solid #fbbf24' : 'none',
                        }}
                        title={`${sig} · ${d} · ${count} project${count === 1 ? '' : 's'}`}
                      />
                    )
                  })}
                </div>
              ))}
            </div>

            {/* hover breakdown */}
            <div className="mt-3 min-h-[2rem] border-t border-slate-800 pt-2">
              {hover && (cellAt(hover.signal, hover.date)?.count ?? 0) > 0 ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[0.6rem] font-mono text-cyber-cyan">{hover.signal} · {hover.date} · {cellAt(hover.signal, hover.date)?.count}</span>
                  {(cellAt(hover.signal, hover.date)?.slugs ?? []).map((slug) => (
                    <Link
                      key={slug}
                      href={`/brief?slug=${encodeURIComponent(slug)}`}
                      className="text-[0.55rem] font-mono text-slate-400 border border-slate-800 px-1.5 py-0.5 rounded hover:text-cyber-cyan hover:border-cyber-cyan/40 transition-colors"
                    >
                      {slug}
                    </Link>
                  ))}
                </div>
              ) : (
                <span className="text-[0.55rem] font-mono text-slate-600">Hover a cell for the projects firing that signal that day; click a project to open the Brief.</span>
              )}
            </div>
          </div>
        )}

        <p className="text-[0.5rem] font-mono text-slate-700 mt-4">
          GitHub-style heatmap of <code>attention_event</code> over the last 30 days. Rows = attention signal types
          (ordered by total firings), columns = days. Cell color = the worst severity that signal reached that day;
          intensity ∝ number of projects firing it. Each finding from the unified P208 engine is recorded when the
          Fleet Brief computes. Reuses <code>/api/signal-timeline</code>. Refreshes every 60s.
        </p>
      </main>
    </div>
  )
}
