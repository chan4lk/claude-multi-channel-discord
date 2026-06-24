'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import type { GoalStreamResponse, GoalStreamEntry, GoalStatus } from '../api/goal-stream/route'
import { useFreshness } from '../../lib/useFreshness'
import FreshnessBadge from '../../components/FreshnessBadge'

const STATUS_COLOR: Record<GoalStatus, string> = {
  advancing: '#10B981',
  'on-track': '#F59E0B',
  behind: '#EF4444',
}

function StatusChip({ status }: { status: GoalStatus }) {
  const c = STATUS_COLOR[status]
  return (
    <span
      className="text-[0.55rem] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded"
      style={{ color: c, background: c + '18', border: `1px solid ${c}40` }}
    >
      {status}
    </span>
  )
}

function dayLabel(date: string): string {
  // date is YYYY-MM-DD. Compare against today / yesterday in local time.
  const today = new Date()
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  const y = new Date(today.getTime() - 86400000)
  const yStr = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, '0')}-${String(y.getDate()).padStart(2, '0')}`
  if (date === todayStr) return 'Today'
  if (date === yStr) return 'Yesterday'
  return date
}

export default function GoalStreamPage() {
  const { data, isStale, lastError, lastSuccessAt } = useFreshness<GoalStreamResponse>('/api/goal-stream', 60_000)
  const loading = data === null && lastError === null

  const groups = useMemo(() => {
    const entries = data?.entries ?? []
    const byDay = new Map<string, GoalStreamEntry[]>()
    for (const e of entries) {
      const arr = byDay.get(e.date) ?? []
      arr.push(e)
      byDay.set(e.date, arr)
    }
    // entries already newest-first by date; preserve that order for the days.
    return [...byDay.entries()].map(([date, items]) => ({ date, items }))
  }, [data])

  const movedCount = useMemo(
    () => (data?.entries ?? []).filter((e) => e.changed).length,
    [data]
  )

  if (loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center" style={{ background: '#060d1a' }}>
        <div className="text-xs font-mono text-slate-600 animate-pulse">Loading goal transitions…</div>
      </div>
    )
  }

  const total = data?.total ?? 0

  return (
    <div className="min-h-dvh flex flex-col" style={{ background: '#060d1a' }}>
      <header className="sticky top-0 z-30 border-b border-cyber-cyan/12 bg-[#060d1a]/90 backdrop-blur-md px-6 py-3">
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-cyber-cyan/40 to-transparent" />
        <div className="flex items-center gap-3 flex-wrap">
          <Link href="/" className="text-[0.6rem] font-mono text-slate-500 hover:text-cyber-cyan transition-colors uppercase tracking-wider">← Dashboard</Link>
          <h1 className="text-sm font-black tracking-[0.18em] text-cyber-cyan" style={{ fontFamily: 'Orbitron, JetBrains Mono, monospace' }}>
            Goal Advancement Stream
          </h1>
          <span className="text-[0.6rem] font-mono text-slate-500 border border-slate-700 px-2 py-0.5 rounded">what goals moved, and when?</span>
          <FreshnessBadge isStale={isStale} lastError={lastError} lastSuccessAt={lastSuccessAt} />
          <div className="flex-1" />
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5">
              <span className="text-[0.55rem] font-mono text-slate-500 uppercase tracking-wider">moved</span>
              <span className="text-xs font-black tabular-nums" style={{ fontFamily: 'Orbitron, monospace', color: movedCount > 0 ? '#10B981' : '#475569' }}>{movedCount}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[0.55rem] font-mono text-slate-500 uppercase tracking-wider">entries</span>
              <span className="text-lg font-black tabular-nums text-cyber-cyan" style={{ fontFamily: 'Orbitron, monospace' }}>{total}</span>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 p-6 max-w-3xl mx-auto w-full">
        {total === 0 ? (
          <div className="h-64 flex items-center justify-center text-slate-600 text-xs font-mono">No goal-advancement history recorded yet.</div>
        ) : (
          <div className="relative">
            {groups.map((g) => (
              <section key={g.date}>
                <div className="sticky top-[3.25rem] z-20 -mx-6 px-6 py-1.5 bg-[#060d1a]/95 backdrop-blur-sm">
                  <span className="text-[0.6rem] font-mono uppercase tracking-[0.2em] text-slate-400">{dayLabel(g.date)}</span>
                  <span className="text-[0.5rem] font-mono text-slate-600 ml-2">{g.items.length} transition{g.items.length === 1 ? '' : 's'}</span>
                </div>
                <ul className="border-l border-slate-800 ml-2 mt-1 mb-3">
                  {g.items.map((e, i) => (
                    <li key={`${e.slug}-${e.date}-${i}`} className="relative pl-5 py-2">
                      <span
                        className="absolute left-0 top-3.5 -translate-x-1/2 w-2 h-2 rounded-full"
                        style={{ background: STATUS_COLOR[e.to], boxShadow: e.changed ? `0 0 6px ${STATUS_COLOR[e.to]}` : 'none' }}
                      />
                      <div className="flex items-center gap-2 flex-wrap">
                        <Link
                          href={`/projects/${encodeURIComponent(e.slug)}`}
                          className="text-xs font-mono text-cyber-cyan hover:underline"
                        >
                          {e.slug}
                        </Link>
                        {e.from ? (
                          <span className="flex items-center gap-1.5">
                            <StatusChip status={e.from} />
                            <span className="text-slate-500 text-[0.65rem]">→</span>
                            <StatusChip status={e.to} />
                          </span>
                        ) : (
                          <StatusChip status={e.to} />
                        )}
                        <span className="text-[0.55rem] font-mono text-slate-500 tabular-nums">
                          {e.prevScore == null ? `${e.score}` : `${e.prevScore} → ${e.score}`}
                        </span>
                        {!e.changed && e.from && (
                          <span className="text-[0.5rem] font-mono text-slate-700 uppercase tracking-wider">no band change</span>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}

        <p className="text-[0.5rem] font-mono text-slate-700 mt-4">
          Chronological fleet-wide feed of <code>goal_advancement</code> rows, newest first. Each entry shows the slug,
          its score-band transition (from → to: advancing ≥60, on-track ≥30, behind &lt;30) with status-colored chips,
          and the underlying score. Grouped by day with sticky day headers. Reuses <code>/api/goal-stream</code>.
          Refreshes every 60s.
        </p>
      </main>
    </div>
  )
}
