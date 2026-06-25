'use client'

import { useEffect, useState, useCallback } from 'react'
import SubPageHeader from '../../components/SubPageHeader'
import type { SchedulerHistoryResponse, SchedulerHistoryEvent, ScheduleStats } from '../api/scheduler-history/route'

function fmtTs(ts: string): string {
  return ts.slice(0, 16).replace('T', ' ')
}

function timeAgo(ts: string): string {
  const diff = Date.now() - Date.parse(ts)
  const min = Math.floor(diff / 60_000)
  if (min < 60) return `${min}m ago`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export default function SchedulerHistoryPage() {
  const [data, setData] = useState<SchedulerHistoryResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [filterSlug, setFilterSlug] = useState('')
  const [filterScheduleId, setFilterScheduleId] = useState('')
  const [page, setPage] = useState(1)
  const [expandedSchedule, setExpandedSchedule] = useState<string | null>(null)
  const [slugOptions, setSlugOptions] = useState<string[]>([])

  const load = useCallback((p: number, slug: string, sid: string) => {
    setLoading(true)
    const params = new URLSearchParams({ page: String(p), page_size: '50' })
    if (slug) params.set('slug', slug)
    if (sid) params.set('schedule_id', sid)
    fetch(`/api/scheduler-history?${params}`)
      .then((r) => r.json())
      .then((d: SchedulerHistoryResponse) => {
        setData(d)
        setLoading(false)
        fetch('/api/fleet')
          .then((r) => r.json())
          .then((f: { projects?: Array<{ slug: string }> }) =>
            setSlugOptions((f.projects ?? []).map((pp) => pp.slug))
          )
          .catch(() => {})
      })
      .catch(() => setLoading(false))
  }, [])

  useEffect(() => { load(page, filterSlug, filterScheduleId) }, [load, page, filterSlug, filterScheduleId])

  function handleSlug(s: string) { setFilterSlug(s); setPage(1) }
  function handleSid(s: string) { setFilterScheduleId(s); setPage(1) }

  const totalPages = data ? Math.ceil(data.total / data.pageSize) : 1

  return (
    <div className="min-h-screen p-4 md:p-6" style={{ background: '#080f1c', color: '#E2E8F0' }}>
      <SubPageHeader title="Scheduler History">
        <span className="text-[0.6rem] font-mono text-slate-500">
          Cron job execution audit · per-schedule stats · inject success/error
        </span>
      </SubPageHeader>

      {loading && <div className="text-center py-20 text-slate-600 font-mono text-sm">Loading…</div>}

      {!loading && data && (
        <div className="max-w-5xl mx-auto">
          {/* Summary */}
          <div className="flex flex-wrap gap-4 mb-5">
            {[
              { label: 'Total fires', value: String(data.totalFires), color: '#E2E8F0' },
              { label: 'Total errors', value: String(data.totalErrors), color: data.totalErrors > 0 ? '#EF4444' : '#10B981' },
              { label: 'Schedules seen', value: String(data.scheduleStats.length), color: '#22D3EE' },
            ].map(({ label, value, color }) => (
              <div key={label} className="rounded border border-white/5 px-4 py-2 text-center min-w-[110px]" style={{ background: 'rgba(255,255,255,0.02)' }}>
                <div className="text-base font-mono font-bold" style={{ color }}>{value}</div>
                <div className="text-[0.5rem] font-mono text-slate-600">{label}</div>
              </div>
            ))}
          </div>

          {/* Per-schedule accordion */}
          {data.scheduleStats.length > 0 && (
            <div className="mb-5 rounded-lg border border-white/5 overflow-hidden" style={{ background: 'rgba(255,255,255,0.02)' }}>
              <div className="text-[0.6rem] font-mono text-slate-500 uppercase tracking-wider px-4 py-2 border-b border-white/5">
                Per-schedule summary
              </div>
              {data.scheduleStats.map((s: ScheduleStats) => {
                const exp = expandedSchedule === s.scheduleId
                return (
                  <div key={s.scheduleId} className="border-b border-white/[0.03] last:border-0">
                    <div
                      className="flex items-center gap-3 px-4 py-2 cursor-pointer hover:bg-white/[0.02] transition-colors"
                      onClick={() => setExpandedSchedule(exp ? null : s.scheduleId)}
                    >
                      <span className="text-[0.6rem] font-mono text-slate-400 w-40 truncate">{s.scheduleId}</span>
                      <span className="text-[0.55rem] font-mono text-cyan-400">{s.slug}</span>
                      <span className="text-[0.55rem] font-mono text-slate-600">{s.interval ?? '—'}</span>
                      <span className="ml-auto text-[0.55rem] font-mono text-slate-400">{s.fireCount}× fired</span>
                      {s.errorCount > 0 && (
                        <span className="text-[0.55rem] font-mono text-red-400">{s.errorCount} err</span>
                      )}
                      <span className="text-[0.5rem] font-mono text-slate-600">{s.lastFired ? timeAgo(s.lastFired) : '—'}</span>
                      <span className="text-[0.5rem] text-slate-600">{exp ? '▲' : '▼'}</span>
                    </div>
                    {exp && (
                      <div className="px-8 pb-3 text-[0.55rem] font-mono space-y-1">
                        <div><span className="text-slate-600">Last fired:</span> <span className="text-slate-300">{s.lastFired ? fmtTs(s.lastFired) : '—'}</span></div>
                        <div><span className="text-slate-600">Fire count:</span> <span className="text-slate-300">{s.fireCount}</span></div>
                        <div><span className="text-slate-600">Error count:</span> <span className={s.errorCount > 0 ? 'text-red-400' : 'text-slate-300'}>{s.errorCount}</span></div>
                        {s.lastError && (
                          <div>
                            <span className="text-slate-600">Last error:</span>
                            <div className="text-red-400 mt-0.5 rounded px-2 py-1" style={{ background: 'rgba(239,68,68,0.06)', wordBreak: 'break-word' }}>
                              {s.lastError.slice(0, 200)}
                            </div>
                          </div>
                        )}
                        <button
                          className="text-[0.5rem] text-cyan-500 hover:text-cyan-300 transition-colors mt-1"
                          onClick={() => { handleSid(s.scheduleId); setExpandedSchedule(null) }}
                        >
                          filter events to this schedule →
                        </button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {/* Filters */}
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <select
              value={filterSlug}
              onChange={(e) => handleSlug(e.target.value)}
              className="text-[0.65rem] font-mono px-2 py-1 rounded border border-white/10"
              style={{ background: '#0d1b2e', color: '#E2E8F0' }}
            >
              <option value="">All projects</option>
              {slugOptions.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            {filterScheduleId && (
              <div className="flex items-center gap-1.5">
                <span className="text-[0.55rem] font-mono text-slate-500">schedule: {filterScheduleId}</span>
                <button
                  className="text-[0.5rem] text-red-400 hover:text-red-300"
                  onClick={() => handleSid('')}
                >✕</button>
              </div>
            )}
            <span className="text-[0.55rem] font-mono text-slate-600 ml-auto">{data.total} events</span>
          </div>

          {data.events.length === 0 ? (
            <div className="text-center py-20 text-slate-600 font-mono text-sm">
              No scheduler history yet
              <div className="text-[0.55rem] mt-2 text-slate-700">
                Events are written to scheduler-history.jsonl when the scheduler fires a job
              </div>
            </div>
          ) : (
            <>
              <div className="rounded-lg border border-white/5 overflow-hidden mb-4" style={{ background: 'rgba(255,255,255,0.02)' }}>
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-white/5">
                      {['Timestamp', 'Schedule', 'Project', 'Interval', 'Message', 'Status'].map((h) => (
                        <th key={h} className="text-left text-[0.55rem] font-mono text-slate-500 pl-4 py-2 pr-3">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.events.map((e: SchedulerHistoryEvent, i) => (
                      <tr key={i} className="border-b border-white/[0.03] hover:bg-white/[0.02] transition-colors">
                        <td className="pl-4 py-2.5">
                          <div className="text-[0.6rem] font-mono text-slate-400">{fmtTs(e.ts)}</div>
                          <div className="text-[0.45rem] font-mono text-slate-600">{timeAgo(e.ts)}</div>
                        </td>
                        <td className="pr-3 py-2.5">
                          <button
                            className="text-[0.55rem] font-mono text-slate-400 hover:text-slate-200 transition-colors text-left truncate max-w-[100px]"
                            onClick={() => handleSid(e.scheduleId)}
                            title={e.scheduleId}
                          >
                            {e.scheduleId.slice(0, 20)}
                          </button>
                        </td>
                        <td className="pr-3 py-2.5">
                          <span className="text-[0.6rem] font-mono text-cyan-400">{e.slug}</span>
                        </td>
                        <td className="pr-3 py-2.5">
                          <span className="text-[0.55rem] font-mono text-slate-600">{e.interval ?? '—'}</span>
                        </td>
                        <td className="pr-3 py-2.5 max-w-[200px]">
                          <span className="text-[0.55rem] font-mono text-slate-500 line-clamp-2" title={e.message}>
                            {e.message.slice(0, 60)}{e.message.length > 60 ? '…' : ''}
                          </span>
                        </td>
                        <td className="pr-4 py-2.5">
                          {e.injected ? (
                            <span className="text-[0.55rem] font-mono px-1.5 py-0.5 rounded" style={{ color: '#10B981', background: 'rgba(16,185,129,0.1)' }}>
                              ok
                            </span>
                          ) : (
                            <span
                              className="text-[0.55rem] font-mono px-1.5 py-0.5 rounded cursor-pointer"
                              style={{ color: '#EF4444', background: 'rgba(239,68,68,0.1)' }}
                              title={e.error ?? 'unknown error'}
                            >
                              error
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {totalPages > 1 && (
                <div className="flex items-center justify-center gap-2">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="text-[0.6rem] font-mono px-3 py-1 rounded border border-white/10 text-slate-400 disabled:opacity-30"
                    style={{ background: 'rgba(255,255,255,0.02)' }}
                  >
                    ← prev
                  </button>
                  <span className="text-[0.55rem] font-mono text-slate-600">
                    page {page} / {totalPages}
                  </span>
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                    className="text-[0.6rem] font-mono px-3 py-1 rounded border border-white/10 text-slate-400 disabled:opacity-30"
                    style={{ background: 'rgba(255,255,255,0.02)' }}
                  >
                    next →
                  </button>
                </div>
              )}
            </>
          )}

          <div className="text-[0.55rem] font-mono text-slate-700 text-right mt-4">
            Generated {new Date(data.generatedAt).toLocaleString()}
          </div>
        </div>
      )}
    </div>
  )
}
