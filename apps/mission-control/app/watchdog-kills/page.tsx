'use client'

import { useEffect, useState, useCallback } from 'react'
import SubPageHeader from '../../components/SubPageHeader'
import type { WatchdogKillsResponse, WatchdogKillEvent } from '../api/watchdog-kills/route'

function fmtRuntime(ms: number | null): string {
  if (ms === null) return '—'
  const sec = Math.round(ms / 1000)
  if (sec < 60) return `${sec}s`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ${sec % 60}s`
  return `${Math.floor(min / 60)}h ${min % 60}m`
}

function fmtTs(ts: string): string {
  return ts.slice(0, 16).replace('T', ' ')
}

function shortTool(name: string | null): string {
  if (!name) return '—'
  return name.replace('mcp__mcd__', 'mcd:').replace('mcp__', '')
}

export default function WatchdogKillsPage() {
  const [data, setData] = useState<WatchdogKillsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [filterSlug, setFilterSlug] = useState<string>('')
  const [page, setPage] = useState(1)
  const [slugOptions, setSlugOptions] = useState<string[]>([])

  const load = useCallback((p: number, slug: string) => {
    setLoading(true)
    const params = new URLSearchParams({ page: String(p), page_size: '50' })
    if (slug) params.set('slug', slug)
    fetch(`/api/watchdog-kills?${params}`)
      .then((r) => r.json())
      .then((d: WatchdogKillsResponse) => {
        setData(d)
        setLoading(false)
        fetch('/api/fleet')
          .then((r) => r.json())
          .then((f: { projects?: Array<{ slug: string }> }) =>
            setSlugOptions((f.projects ?? []).map((p) => p.slug))
          )
          .catch(() => {})
      })
      .catch(() => setLoading(false))
  }, [])

  useEffect(() => { load(page, filterSlug) }, [load, page, filterSlug])

  function handleSlugChange(s: string) {
    setFilterSlug(s)
    setPage(1)
  }

  const totalPages = data ? Math.ceil(data.total / data.pageSize) : 1

  return (
    <div className="min-h-screen p-4 md:p-6" style={{ background: '#080f1c', color: '#E2E8F0' }}>
      <SubPageHeader title="Watchdog Kill Log">
        <span className="text-[0.6rem] font-mono text-slate-500">
          Stuck-agent kill history · per-project · last-tool snapshot
        </span>
      </SubPageHeader>

      {!loading && data && (
        <div className="max-w-5xl mx-auto">
          {/* Summary */}
          <div className="flex flex-wrap gap-4 mb-5">
            {[
              { label: 'Total kills', value: data.summary.totalKills.toString(), color: data.summary.totalKills > 0 ? '#EF4444' : '#10B981' },
              { label: 'This week', value: data.summary.killsThisWeek.toString(), color: data.summary.killsThisWeek > 0 ? '#F59E0B' : '#10B981' },
              {
                label: 'Most killed',
                value: data.summary.worstSlug ? `${data.summary.worstSlug} (${data.summary.worstSlugCount}×)` : '—',
                color: data.summary.worstSlug ? '#EF4444' : '#475569',
              },
            ].map(({ label, value, color }) => (
              <div key={label} className="rounded border border-white/5 px-4 py-2 text-center min-w-[120px]" style={{ background: 'rgba(255,255,255,0.02)' }}>
                <div className="text-base font-mono font-bold" style={{ color }}>{value}</div>
                <div className="text-[0.5rem] font-mono text-slate-600">{label}</div>
              </div>
            ))}
          </div>

          {/* Filter */}
          <div className="flex items-center gap-3 mb-4">
            <select
              value={filterSlug}
              onChange={(e) => handleSlugChange(e.target.value)}
              className="text-[0.65rem] font-mono px-2 py-1 rounded border border-white/10"
              style={{ background: '#0d1b2e', color: '#E2E8F0' }}
            >
              <option value="">All projects</option>
              {slugOptions.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <span className="text-[0.55rem] font-mono text-slate-600">{data.total} total events</span>
          </div>

          {data.events.length === 0 ? (
            <div className="text-center py-20 text-slate-600 font-mono text-sm">
              No watchdog kills recorded yet
              <div className="text-[0.55rem] mt-2 text-slate-700">
                Kills are logged when the stuck-watchdog terminates a subprocess after exceeding stuckThresholdMinutes
              </div>
            </div>
          ) : (
            <>
              <div className="rounded-lg border border-white/5 overflow-hidden mb-4" style={{ background: 'rgba(255,255,255,0.02)' }}>
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-white/5">
                      {['Timestamp', 'Project', 'Runtime', 'Last tool', 'Reason'].map((h) => (
                        <th key={h} className="text-left text-[0.55rem] font-mono text-slate-500 pl-4 py-2 pr-3">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.events.map((e: WatchdogKillEvent, i) => (
                      <tr key={i} className="border-b border-white/[0.03] hover:bg-white/[0.02] transition-colors">
                        <td className="pl-4 py-2.5">
                          <span className="text-[0.6rem] font-mono text-slate-400">{fmtTs(e.ts)}</span>
                        </td>
                        <td className="pr-3 py-2.5">
                          <a
                            href={`/circuit-timeline?slug=${e.slug}`}
                            className="text-[0.6rem] font-mono text-cyan-400 hover:text-cyan-300 transition-colors"
                          >
                            {e.slug}
                          </a>
                        </td>
                        <td className="pr-3 py-2.5">
                          <span className="text-[0.6rem] font-mono text-slate-400">{fmtRuntime(e.runtimeMs)}</span>
                        </td>
                        <td className="pr-3 py-2.5">
                          <span
                            className="text-[0.6rem] font-mono px-1.5 py-0.5 rounded"
                            style={{
                              background: e.lastToolCall ? 'rgba(245,158,11,0.1)' : 'transparent',
                              color: e.lastToolCall ? '#F59E0B' : '#475569',
                            }}
                          >
                            {shortTool(e.lastToolCall)}
                          </span>
                        </td>
                        <td className="pr-4 py-2.5">
                          <span className="text-[0.55rem] font-mono text-red-400/70">{e.reason}</span>
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

      {loading && (
        <div className="text-center py-20 text-slate-600 font-mono text-sm">Loading…</div>
      )}
    </div>
  )
}
