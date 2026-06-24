'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import type { ScheduleRunsResponse, ScheduleRunGroup } from '../api/schedule-runs/route'
import { useFreshness } from '../../lib/useFreshness'
import FreshnessBadge from '../../components/FreshnessBadge'

const STATUS_COLOR: Record<string, string> = {
  ok: '#00f5ff',
  stalled: '#ef4444',
  skipped: '#f59e0b',
}

function fmtDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function fmtDay(d: string): string {
  return d.slice(5)
}

function fmtTs(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

function SuccessBar({ rate }: { rate: number }) {
  const pct = Math.round(rate * 100)
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-16 h-1.5 rounded-full bg-slate-800 overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: pct === 100 ? '#00f5ff' : pct >= 80 ? '#22c55e' : '#ef4444' }} />
      </div>
      <span className="text-[0.55rem] font-mono tabular-nums" style={{ color: pct === 100 ? '#00f5ff' : pct >= 80 ? '#22c55e' : '#ef4444' }}>
        {pct}%
      </span>
    </div>
  )
}

function CalendarCell({
  day,
  ok,
  error,
  hovered,
  onHover,
}: {
  day: string
  ok: number
  error: number
  hovered: boolean
  onHover: (d: string | null) => void
}) {
  const total = ok + error
  const intensity = Math.min(total / 5, 1)
  const hasError = error > 0
  const bg = total === 0
    ? 'rgba(148,163,184,0.06)'
    : hasError
    ? `rgba(239,68,68,${0.2 + intensity * 0.7})`
    : `rgba(0,245,255,${0.15 + intensity * 0.75})`

  return (
    <div
      className="w-3.5 h-3.5 rounded-sm cursor-pointer transition-transform"
      style={{
        background: bg,
        outline: hovered ? '1px solid #fbbf24' : 'none',
        transform: hovered ? 'scale(1.4)' : 'scale(1)',
      }}
      title={`${day}: ${ok} ok, ${error} error`}
      onMouseEnter={() => onHover(day)}
      onMouseLeave={() => onHover(null)}
    />
  )
}

function GroupRow({ group, calendarDays, heatmap, expanded, onToggle }: {
  group: ScheduleRunGroup
  calendarDays: string[]
  heatmap: ScheduleRunsResponse['heatmap']
  expanded: boolean
  onToggle: () => void
}) {
  const [hoverDay, setHoverDay] = useState<string | null>(null)

  const schedule = group.interval
    ? `every ${group.interval}`
    : group.at || '—'

  return (
    <div className="rounded-xl border border-slate-800 overflow-hidden" style={{ background: 'rgba(0,245,255,0.01)' }}>
      <button
        className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-slate-900/40 transition-colors"
        onClick={onToggle}
      >
        <span className="text-[0.6rem] font-mono text-slate-500 w-3">{expanded ? '▾' : '▸'}</span>
        <span className="text-xs font-bold font-mono text-cyber-cyan truncate min-w-0 flex-1">{group.slug}</span>
        <span className="text-[0.55rem] font-mono text-slate-500 shrink-0">{schedule}</span>
        <SuccessBar rate={group.successRate} />
        <span className="text-[0.55rem] font-mono text-slate-500 shrink-0 w-12 text-right tabular-nums">{group.runCount} runs</span>
        <span
          className="text-[0.5rem] font-mono px-1.5 py-0.5 rounded shrink-0"
          style={{
            background: group.enabled ? 'rgba(0,245,255,0.1)' : 'rgba(148,163,184,0.08)',
            color: group.enabled ? '#00f5ff' : '#475569',
          }}
        >
          {group.enabled ? 'active' : 'paused'}
        </span>
      </button>

      {/* Calendar strip */}
      <div className="px-4 pb-2 flex flex-col gap-1">
        <div className="flex gap-0.5">
          {calendarDays.map((d, i) => {
            const cell = heatmap[d]?.[group.chatId]
            return (
              <CalendarCell
                key={d}
                day={d}
                ok={cell?.ok ?? 0}
                error={cell?.error ?? 0}
                hovered={hoverDay === d}
                onHover={setHoverDay}
              />
            )
          })}
        </div>
        {hoverDay && (
          <div className="text-[0.5rem] font-mono text-slate-400 pl-0.5">
            {fmtDay(hoverDay)}: {heatmap[hoverDay]?.[group.chatId]?.ok ?? 0} ok,{' '}
            {heatmap[hoverDay]?.[group.chatId]?.error ?? 0} error
          </div>
        )}
      </div>

      {/* Expanded run list */}
      {expanded && (
        <div className="border-t border-slate-800 px-4 py-3">
          {group.runs.length === 0 ? (
            <p className="text-[0.55rem] font-mono text-slate-600">No runs in this window.</p>
          ) : (
            <div className="flex flex-col gap-1 max-h-64 overflow-y-auto">
              <div className="flex gap-3 text-[0.5rem] font-mono text-slate-600 uppercase tracking-wider pb-1 border-b border-slate-800/60">
                <span className="w-3" />
                <span className="flex-1">fired at</span>
                <span className="w-14 text-right">duration</span>
                <span className="w-20 text-right">scheduled at</span>
              </div>
              {group.runs.map((r, i) => (
                <div key={i} className="flex gap-3 items-center text-[0.55rem] font-mono">
                  <span
                    className="w-3 h-3 rounded-full shrink-0"
                    style={{ background: STATUS_COLOR[r.status] ?? '#94a3b8' }}
                    title={r.status}
                  />
                  <span className="flex-1 text-slate-300">{fmtTs(r.firedAt)}</span>
                  <span className="w-14 text-right text-slate-400 tabular-nums">{fmtDuration(r.durationMs)}</span>
                  <span className="w-20 text-right text-slate-600 truncate" title={r.scheduledAt}>{r.scheduledAt}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function ScheduleHistoryPage() {
  const [days, setDays] = useState(30)
  const { data, isStale, lastError, lastSuccessAt } = useFreshness<ScheduleRunsResponse>(
    `/api/schedule-runs?days=${days}`,
    60_000,
  )
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState<'all' | 'errors' | 'active'>('all')

  const loading = data === null && lastError === null

  const { groups, calendarDays, heatmap } = useMemo(() => ({
    groups: data?.groups ?? [],
    calendarDays: data?.calendarDays ?? [],
    heatmap: data?.heatmap ?? {},
  }), [data])

  const displayed = useMemo(() => {
    if (filter === 'errors') return groups.filter((g) => g.errorCount > 0)
    if (filter === 'active') return groups.filter((g) => g.enabled)
    return groups
  }, [groups, filter])

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  if (loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center" style={{ background: '#060d1a' }}>
        <div className="text-xs font-mono text-slate-600 animate-pulse">Loading schedule history…</div>
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
            Schedule History
          </h1>
          <span className="text-[0.6rem] font-mono text-slate-500 border border-slate-700 px-2 py-0.5 rounded">did scheduled tasks actually run?</span>
          <FreshnessBadge isStale={isStale} lastError={lastError} lastSuccessAt={lastSuccessAt} />
          <div className="flex-1" />
          {/* Stats */}
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5">
              <span className="text-[0.55rem] font-mono text-slate-500 uppercase tracking-wider">runs</span>
              <span className="text-lg font-black tabular-nums text-cyber-cyan" style={{ fontFamily: 'Orbitron, monospace' }}>{data?.totalRuns ?? 0}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[0.55rem] font-mono text-slate-500 uppercase tracking-wider">errors</span>
              <span className="text-lg font-black tabular-nums" style={{ fontFamily: 'Orbitron, monospace', color: (data?.totalError ?? 0) > 0 ? '#ef4444' : '#475569' }}>
                {data?.totalError ?? 0}
              </span>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 p-6 max-w-5xl mx-auto w-full flex flex-col gap-4">
        {/* Controls */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1">
            {(['all', 'active', 'errors'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className="text-[0.55rem] font-mono px-2 py-1 rounded transition-colors capitalize"
                style={{
                  background: filter === f ? 'rgba(0,245,255,0.12)' : 'transparent',
                  color: filter === f ? '#00f5ff' : '#64748b',
                  border: '1px solid',
                  borderColor: filter === f ? 'rgba(0,245,255,0.3)' : '#1e293b',
                }}
              >
                {f}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1">
            {([7, 14, 30, 90] as const).map((d) => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className="text-[0.55rem] font-mono px-2 py-1 rounded transition-colors"
                style={{
                  background: days === d ? 'rgba(0,245,255,0.12)' : 'transparent',
                  color: days === d ? '#00f5ff' : '#64748b',
                  border: '1px solid',
                  borderColor: days === d ? 'rgba(0,245,255,0.3)' : '#1e293b',
                }}
              >
                {d}d
              </button>
            ))}
          </div>
          <button
            onClick={() => setExpanded(new Set(displayed.map((g) => g.scheduleId)))}
            className="text-[0.55rem] font-mono text-slate-500 hover:text-cyber-cyan transition-colors"
          >expand all</button>
          <button
            onClick={() => setExpanded(new Set())}
            className="text-[0.55rem] font-mono text-slate-500 hover:text-cyber-cyan transition-colors"
          >collapse all</button>
        </div>

        {/* Group cards */}
        {displayed.length === 0 ? (
          <div className="h-64 flex items-center justify-center text-slate-600 text-xs font-mono text-center px-6">
            {groups.length === 0
              ? 'No schedule runs recorded yet. Runs are logged to schedule-log.jsonl in the MCD channels directory.'
              : 'No schedules match the current filter.'}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {displayed.map((g) => (
              <GroupRow
                key={g.scheduleId}
                group={g}
                calendarDays={calendarDays}
                heatmap={heatmap}
                expanded={expanded.has(g.scheduleId)}
                onToggle={() => toggleExpand(g.scheduleId)}
              />
            ))}
          </div>
        )}

        <p className="text-[0.5rem] font-mono text-slate-700 mt-2">
          Reads <code>schedule-log.jsonl</code> from MCD_CHANNELS_DIR. Each row = one scheduler fire.
          Calendar strip: cyan = ok fires, red = stalled/skipped fires, intensity ∝ fire count that day.
          Expand a schedule to see the last 100 individual runs. Refreshes every 60s.
        </p>
      </main>
    </div>
  )
}
