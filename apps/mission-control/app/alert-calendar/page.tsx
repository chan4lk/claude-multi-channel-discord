'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import type { AlertCalendarResponse } from '../api/alert-calendar/route'
import { useFreshness } from '../../lib/useFreshness'
import FreshnessBadge from '../../components/FreshnessBadge'

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function fmtHour(h: number): string {
  return `${String(h).padStart(2, '0')}:00`
}

export default function AlertCalendarPage() {
  const { data, isStale, lastError, lastSuccessAt } = useFreshness<AlertCalendarResponse>('/api/alert-calendar', 60_000)
  const loading = data === null && lastError === null
  const [hover, setHover] = useState<{ dow: number; hour: number } | null>(null)

  const { grid, total, max, busiest } = useMemo(() => ({
    grid: data?.grid ?? [],
    total: data?.total ?? 0,
    max: data?.max ?? 0,
    busiest: data?.busiest ?? null,
  }), [data])

  if (loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center" style={{ background: '#060d1a' }}>
        <div className="text-xs font-mono text-slate-600 animate-pulse">Bucketing alert events…</div>
      </div>
    )
  }

  const cellAt = (d: number, h: number) => (grid[d] ? grid[d][h] : undefined)

  return (
    <div className="min-h-dvh flex flex-col" style={{ background: '#060d1a' }}>
      <header className="sticky top-0 z-30 border-b border-cyber-cyan/12 bg-[#060d1a]/90 backdrop-blur-md px-6 py-3">
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-cyber-cyan/40 to-transparent" />
        <div className="flex items-center gap-3 flex-wrap">
          <Link href="/" className="text-[0.6rem] font-mono text-slate-500 hover:text-cyber-cyan transition-colors uppercase tracking-wider">← Dashboard</Link>
          <h1 className="text-sm font-black tracking-[0.18em] text-cyber-cyan" style={{ fontFamily: 'Orbitron, JetBrains Mono, monospace' }}>
            Alert Calendar
          </h1>
          <span className="text-[0.6rem] font-mono text-slate-500 border border-slate-700 px-2 py-0.5 rounded">when does trouble cluster?</span>
          <FreshnessBadge isStale={isStale} lastError={lastError} lastSuccessAt={lastSuccessAt} />
          <div className="flex-1" />
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5">
              <span className="text-[0.55rem] font-mono text-slate-500 uppercase tracking-wider">busiest</span>
              <span className="text-xs font-black tabular-nums" style={{ fontFamily: 'Orbitron, monospace', color: busiest ? '#ef4444' : '#475569' }}>
                {busiest ? `${DOW[busiest.dow]} ${fmtHour(busiest.hour)} · ${busiest.count}` : '—'}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[0.55rem] font-mono text-slate-500 uppercase tracking-wider">total 30d</span>
              <span className="text-lg font-black tabular-nums text-cyber-cyan" style={{ fontFamily: 'Orbitron, monospace' }}>{total}</span>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 p-6 max-w-5xl mx-auto w-full">
        {total === 0 ? (
          <div className="h-64 flex items-center justify-center text-slate-600 text-xs font-mono">No alert events in the last 30 days.</div>
        ) : (
          <div className="rounded-xl border border-cyber-cyan/12 p-4 overflow-x-auto" style={{ background: 'rgba(0,245,255,0.02)' }}>
            <div className="inline-flex flex-col gap-0.5 min-w-max">
              {/* hour header */}
              <div className="flex gap-0.5 items-end pl-9">
                {Array.from({ length: 24 }, (_, h) => (
                  <div key={h} className="w-3.5 text-center text-[0.4rem] font-mono text-slate-600">{h % 3 === 0 ? h : ''}</div>
                ))}
              </div>
              {DOW.map((day, d) => (
                <div key={day} className="flex gap-0.5 items-center">
                  <div className="w-8 text-[0.5rem] font-mono text-slate-500 text-right pr-1">{day}</div>
                  {Array.from({ length: 24 }, (_, h) => {
                    const cell = cellAt(d, h)
                    const count = cell?.count ?? 0
                    const intensity = max > 0 ? count / max : 0
                    const active = hover?.dow === d && hover?.hour === h
                    return (
                      <div
                        key={h}
                        onMouseEnter={() => setHover({ dow: d, hour: h })}
                        onMouseLeave={() => setHover(null)}
                        className="w-3.5 h-3.5 rounded-sm"
                        style={{
                          background: count === 0 ? 'rgba(148,163,184,0.06)' : `rgba(239,68,68,${0.15 + intensity * 0.85})`,
                          outline: active ? '1px solid #fbbf24' : 'none',
                        }}
                        title={`${day} ${fmtHour(h)} · ${count}`}
                      />
                    )
                  })}
                </div>
              ))}
            </div>

            {/* hover breakdown */}
            <div className="mt-3 min-h-[2rem] border-t border-slate-800 pt-2">
              {hover && (cellAt(hover.dow, hover.hour)?.count ?? 0) > 0 ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[0.6rem] font-mono text-cyber-cyan">{DOW[hover.dow]} {fmtHour(hover.hour)} · {cellAt(hover.dow, hover.hour)?.count}</span>
                  {Object.entries(cellAt(hover.dow, hover.hour)?.byType ?? {}).sort((a, b) => b[1] - a[1]).map(([type, n]) => (
                    <span key={type} className="text-[0.55rem] font-mono text-slate-400 border border-slate-800 px-1.5 py-0.5 rounded">{type} · {n}</span>
                  ))}
                </div>
              ) : (
                <span className="text-[0.55rem] font-mono text-slate-600">Hover a cell for its alert count and type breakdown.</span>
              )}
            </div>
          </div>
        )}

        <p className="text-[0.5rem] font-mono text-slate-700 mt-4">
          Heatmap of <code>alert_events</code> over the last 30 days, bucketed into a 7×24 day-of-week × hour-of-day
          grid (local time). Cell intensity ∝ alert count on a transparent→red ramp. Hover a cell for its count and
          breakdown by alert type. Header shows the busiest window and total alerts in range. Reuses
          <code>/api/alert-calendar</code>. Refreshes every 60s.
        </p>
      </main>
    </div>
  )
}
