'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import type { CommandLogResponse } from '../api/command-log/route'
import { useFreshness } from '../../lib/useFreshness'
import FreshnessBadge from '../../components/FreshnessBadge'

const VERB_COLORS: Record<string, string> = {
  create: '#22c55e',
  clone: '#22c55e',
  rm: '#ef4444',
  rename: '#f59e0b',
  set: '#a78bfa',
  stop: '#f97316',
  pull: '#60a5fa',
  schedule: '#06b6d4',
  list: '#94a3b8',
  show: '#94a3b8',
  status: '#94a3b8',
  help: '#94a3b8',
}

function verbColor(verb: string): string {
  return VERB_COLORS[verb] ?? '#00f5ff'
}

function fmtTs(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}

function fmtDay(d: string): string {
  return d.slice(5)
}

export default function CommandLogPage() {
  const [days, setDays] = useState(30)
  const [verbFilter, setVerbFilter] = useState('')
  const { data, isStale, lastError, lastSuccessAt } = useFreshness<CommandLogResponse>(
    `/api/command-log?days=${days}${verbFilter ? `&verb=${encodeURIComponent(verbFilter)}` : ''}`,
    30_000,
  )
  const [hoverDay, setHoverDay] = useState<string | null>(null)

  const loading = data === null && lastError === null

  const { entries, verbFrequency, calendarDays, dailyCounts } = useMemo(() => ({
    entries: data?.entries ?? [],
    verbFrequency: data?.verbFrequency ?? [],
    calendarDays: data?.calendarDays ?? [],
    dailyCounts: data?.dailyCounts ?? {},
  }), [data])

  if (loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center" style={{ background: '#060d1a' }}>
        <div className="text-xs font-mono text-slate-600 animate-pulse">Loading command log…</div>
      </div>
    )
  }

  const errorRate = data?.errorRate ?? 0

  return (
    <div className="min-h-dvh flex flex-col" style={{ background: '#060d1a' }}>
      <header className="sticky top-0 z-30 border-b border-cyber-cyan/12 bg-[#060d1a]/90 backdrop-blur-md px-6 py-3">
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-cyber-cyan/40 to-transparent" />
        <div className="flex items-center gap-3 flex-wrap">
          <Link href="/" className="text-[0.6rem] font-mono text-slate-500 hover:text-cyber-cyan transition-colors uppercase tracking-wider">← Dashboard</Link>
          <h1 className="text-sm font-black tracking-[0.18em] text-cyber-cyan" style={{ fontFamily: 'Orbitron, JetBrains Mono, monospace' }}>
            Operator Command Log
          </h1>
          <span className="text-[0.6rem] font-mono text-slate-500 border border-slate-700 px-2 py-0.5 rounded">audit trail for !project commands</span>
          <FreshnessBadge isStale={isStale} lastError={lastError} lastSuccessAt={lastSuccessAt} />
          <div className="flex-1" />
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5">
              <span className="text-[0.55rem] font-mono text-slate-500 uppercase tracking-wider">total</span>
              <span className="text-lg font-black tabular-nums text-cyber-cyan" style={{ fontFamily: 'Orbitron, monospace' }}>{data?.total ?? 0}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[0.55rem] font-mono text-slate-500 uppercase tracking-wider">error rate</span>
              <span className="text-lg font-black tabular-nums" style={{ fontFamily: 'Orbitron, monospace', color: errorRate > 0.1 ? '#ef4444' : errorRate > 0 ? '#f59e0b' : '#475569' }}>
                {Math.round(errorRate * 100)}%
              </span>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 p-6 max-w-5xl mx-auto w-full flex flex-col gap-5">
        {/* Controls */}
        <div className="flex items-center gap-3 flex-wrap">
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
          {verbFilter && (
            <button
              onClick={() => setVerbFilter('')}
              className="text-[0.55rem] font-mono text-amber-400 border border-amber-900 px-2 py-1 rounded hover:border-amber-500 transition-colors"
            >
              {verbFilter} ✕
            </button>
          )}
        </div>

        {/* Verb frequency bar chart */}
        {verbFrequency.length > 0 && (
          <div className="rounded-xl border border-cyber-cyan/12 p-4" style={{ background: 'rgba(0,245,255,0.02)' }}>
            <div className="text-[0.55rem] font-mono text-slate-500 uppercase tracking-wider mb-3">Command Frequency</div>
            <div className="flex flex-wrap gap-2">
              {verbFrequency.map((v) => {
                const maxCount = verbFrequency[0]?.count ?? 1
                const w = Math.max(4, Math.round((v.count / maxCount) * 120))
                return (
                  <button
                    key={v.verb}
                    onClick={() => setVerbFilter(verbFilter === v.verb ? '' : v.verb)}
                    className="flex items-center gap-1.5 rounded hover:opacity-80 transition-opacity"
                    title={`${v.verb}: ${v.count} runs, ${v.errorCount} errors`}
                  >
                    <span className="text-[0.55rem] font-mono w-16 text-right" style={{ color: verbColor(v.verb) }}>{v.verb}</span>
                    <div className="h-4 rounded-sm" style={{ width: `${w}px`, background: verbColor(v.verb), opacity: verbFilter === v.verb ? 1 : 0.7 }} />
                    <span className="text-[0.5rem] font-mono text-slate-500 tabular-nums">{v.count}</span>
                    {v.errorCount > 0 && (
                      <span className="text-[0.5rem] font-mono text-red-400 tabular-nums">({v.errorCount}✗)</span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* Activity calendar */}
        {calendarDays.length > 0 && (
          <div className="rounded-xl border border-cyber-cyan/12 p-4" style={{ background: 'rgba(0,245,255,0.02)' }}>
            <div className="text-[0.55rem] font-mono text-slate-500 uppercase tracking-wider mb-2">Daily Activity</div>
            <div className="flex gap-0.5">
              {calendarDays.map((d, i) => {
                const cell = dailyCounts[d]
                const total = (cell?.ok ?? 0) + (cell?.error ?? 0)
                const hasError = (cell?.error ?? 0) > 0
                const maxDay = Math.max(...Object.values(dailyCounts).map((c) => (c.ok + c.error)), 1)
                const intensity = total / maxDay
                return (
                  <div
                    key={d}
                    className="w-3.5 h-3.5 rounded-sm cursor-pointer"
                    style={{
                      background: total === 0 ? 'rgba(148,163,184,0.06)' : hasError ? `rgba(239,68,68,${0.2 + intensity * 0.7})` : `rgba(0,245,255,${0.15 + intensity * 0.75})`,
                      outline: hoverDay === d ? '1px solid #fbbf24' : 'none',
                    }}
                    title={`${d}: ${cell?.ok ?? 0} ok, ${cell?.error ?? 0} errors`}
                    onMouseEnter={() => setHoverDay(d)}
                    onMouseLeave={() => setHoverDay(null)}
                  />
                )
              })}
            </div>
            {hoverDay && (
              <div className="text-[0.5rem] font-mono text-slate-400 mt-1">
                {fmtDay(hoverDay)}: {dailyCounts[hoverDay]?.ok ?? 0} ok, {dailyCounts[hoverDay]?.error ?? 0} errors
              </div>
            )}
          </div>
        )}

        {/* Entry table */}
        {entries.length === 0 ? (
          <div className="h-48 flex items-center justify-center text-slate-600 text-xs font-mono text-center px-6">
            No command log entries found.
            {data?.total === 0 && (
              <> Command logging is written to <code className="mx-1">command-log.jsonl</code> — requires a bot restart to activate.</>
            )}
          </div>
        ) : (
          <div className="rounded-xl border border-cyber-cyan/12 overflow-hidden" style={{ background: 'rgba(0,245,255,0.01)' }}>
            <div className="flex gap-3 px-4 py-2 text-[0.5rem] font-mono text-slate-600 uppercase tracking-wider border-b border-slate-800">
              <span className="w-36 shrink-0">time</span>
              <span className="w-14 shrink-0">verb</span>
              <span className="w-16 shrink-0">user</span>
              <span className="flex-1">args / outcome</span>
            </div>
            <div className="flex flex-col max-h-[28rem] overflow-y-auto divide-y divide-slate-900">
              {entries.map((e, i) => (
                <div key={i} className="flex gap-3 px-4 py-2 text-[0.55rem] font-mono hover:bg-slate-900/30 transition-colors">
                  <span className="w-36 shrink-0 text-slate-500">{fmtTs(e.ts)}</span>
                  <span className="w-14 shrink-0 font-bold" style={{ color: verbColor(e.verb) }}>{e.verb}</span>
                  <span className="w-16 shrink-0 text-slate-400 truncate">{e.userId.slice(-6)}</span>
                  <div className="flex-1 min-w-0">
                    {e.args.length > 0 && (
                      <span className="text-slate-400">{e.args.join(' ')} → </span>
                    )}
                    {e.error ? (
                      <span className="text-red-400">{e.error}</span>
                    ) : (
                      <span className="text-slate-500 truncate">{e.outcomeSnippet}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <p className="text-[0.5rem] font-mono text-slate-700">
          Reads <code>command-log.jsonl</code> from MCD_CHANNELS_DIR. Populated by the bot after each
          <code> !project</code> command parse (requires bot restart after update). Click a verb bar to filter the table.
          Refreshes every 30s.
        </p>
      </main>
    </div>
  )
}
