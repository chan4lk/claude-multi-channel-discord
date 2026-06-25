'use client'

import { useEffect, useState, useCallback } from 'react'
import SubPageHeader from '../../components/SubPageHeader'
import type { ToolErrorRateResponse, ToolErrorStat, ToolErrorDay } from '../api/tool-error-rate/route'

function rateColor(rate: number): string {
  if (rate === 0) return '#10B981'
  if (rate < 10) return '#F59E0B'
  return '#EF4444'
}

function shortName(tool: string): string {
  return tool.replace('mcp__mcd__', 'mcd:').replace('mcp__', '')
}

function Sparkline({ data }: { data: ToolErrorDay[] }) {
  const max = Math.max(1, ...data.map((d) => d.errors))
  return (
    <svg width={70} height={18} className="inline-block align-middle">
      {data.map((d, i) => {
        const h = d.errors > 0 ? Math.max(2, (d.errors / max) * 18) : 1
        return (
          <rect
            key={d.date}
            x={i * (70 / data.length)}
            y={18 - h}
            width={Math.max(1, 70 / data.length - 0.5)}
            height={h}
            fill={d.errors > 0 ? '#EF4444' : '#1e293b'}
            opacity={0.8}
          />
        )
      })}
    </svg>
  )
}

type SortKey = 'tool' | 'calls' | 'errors' | 'errorRate'

export default function ToolErrorRatePage() {
  const [data, setData] = useState<ToolErrorRateResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null)
  const [includeMcd, setIncludeMcd] = useState(false)
  const [windowDays, setWindowDays] = useState(30)
  const [sortKey, setSortKey] = useState<SortKey>('errorRate')
  const [sortDir, setSortDir] = useState<1 | -1>(-1)
  const [expandedTool, setExpandedTool] = useState<string | null>(null)
  const [slugOptions, setSlugOptions] = useState<string[]>([])

  const load = useCallback(() => {
    const params = new URLSearchParams({ days: String(windowDays) })
    if (selectedSlug) params.set('slug', selectedSlug)
    if (includeMcd) params.set('include_mcd', '1')
    fetch(`/api/tool-error-rate?${params}`)
      .then((r) => r.json())
      .then((d: ToolErrorRateResponse) => {
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
  }, [windowDays, selectedSlug, includeMcd])

  useEffect(() => { setLoading(true); load() }, [load])

  function toggleSort(k: SortKey) {
    if (k === sortKey) setSortDir((d) => (d === -1 ? 1 : -1))
    else { setSortKey(k); setSortDir(-1) }
  }

  const tools = data
    ? [...data.tools].sort((a, b) => {
        let va: number | string, vb: number | string
        if (sortKey === 'tool') { va = a.tool; vb = b.tool }
        else { va = a[sortKey] as number; vb = b[sortKey] as number }
        if (va < vb) return sortDir
        if (va > vb) return -sortDir
        return 0
      })
    : []

  function SortHdr({ k, label }: { k: SortKey; label: string }) {
    const active = sortKey === k
    return (
      <th
        className="text-left text-[0.55rem] font-mono text-slate-500 pb-2 pr-4 cursor-pointer select-none hover:text-slate-300 transition-colors"
        onClick={() => toggleSort(k)}
      >
        {label}{active ? (sortDir === -1 ? ' ↓' : ' ↑') : ''}
      </th>
    )
  }

  return (
    <div className="min-h-screen p-4 md:p-6" style={{ background: '#080f1c', color: '#E2E8F0' }}>
      <SubPageHeader title="Tool Error Rate Monitor">
        <span className="text-[0.6rem] font-mono text-slate-500">
          Per-tool failure frequency · error rate · last 14d sparkline
        </span>
      </SubPageHeader>

      {loading && (
        <div className="text-center py-20 text-slate-600 font-mono text-sm">Loading…</div>
      )}

      {!loading && data && (
        <div className="max-w-5xl mx-auto">
          {/* Controls */}
          <div className="flex flex-wrap items-center gap-3 mb-4">
            {[7, 14, 30, 60].map((d) => (
              <button
                key={d}
                onClick={() => setWindowDays(d)}
                className="text-[0.65rem] font-mono px-3 py-1 rounded border transition-colors"
                style={{
                  borderColor: windowDays === d ? '#EF4444' : 'rgba(255,255,255,0.1)',
                  color: windowDays === d ? '#EF4444' : '#64748B',
                  background: windowDays === d ? 'rgba(239,68,68,0.08)' : 'transparent',
                }}
              >
                {d}d
              </button>
            ))}
            <select
              value={selectedSlug ?? ''}
              onChange={(e) => setSelectedSlug(e.target.value || null)}
              className="text-[0.65rem] font-mono px-2 py-1 rounded border border-white/10"
              style={{ background: '#0d1b2e', color: '#E2E8F0' }}
            >
              <option value="">All projects</option>
              {slugOptions.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <button
              onClick={() => setIncludeMcd(!includeMcd)}
              className="text-[0.65rem] font-mono px-3 py-1 rounded border transition-colors"
              style={{
                borderColor: includeMcd ? '#F59E0B' : 'rgba(255,255,255,0.1)',
                color: includeMcd ? '#F59E0B' : '#64748B',
                background: includeMcd ? 'rgba(245,158,11,0.08)' : 'transparent',
              }}
            >
              {includeMcd ? 'hide mcd tools' : 'show mcd tools'}
            </button>
          </div>

          {/* Summary */}
          <div className="flex gap-4 mb-4">
            {[
              { label: 'Total calls', value: data.totalCalls.toLocaleString(), color: '#E2E8F0' },
              { label: 'Total errors', value: data.totalErrors.toLocaleString(), color: data.totalErrors > 0 ? '#EF4444' : '#10B981' },
              {
                label: 'Fleet error rate',
                value: data.totalCalls > 0 ? `${((data.totalErrors / data.totalCalls) * 100).toFixed(1)}%` : '—',
                color: data.totalErrors > 0 ? rateColor((data.totalErrors / Math.max(1, data.totalCalls)) * 100) : '#10B981',
              },
            ].map(({ label, value, color }) => (
              <div key={label} className="rounded border border-white/5 px-3 py-2 text-center" style={{ background: 'rgba(255,255,255,0.02)' }}>
                <div className="text-base font-mono font-bold" style={{ color }}>{value}</div>
                <div className="text-[0.5rem] font-mono text-slate-600">{label}</div>
              </div>
            ))}
          </div>

          {tools.length === 0 ? (
            <div className="text-center py-20 text-slate-600 font-mono text-sm">
              No tool errors found in transcripts for this window
            </div>
          ) : (
            <div className="rounded-lg border border-white/5 overflow-hidden" style={{ background: 'rgba(255,255,255,0.02)' }}>
              <table className="w-full">
                <thead>
                  <tr className="border-b border-white/5">
                    <th className="pl-4 py-2"><SortHdr k="tool" label="Tool" /></th>
                    <th><SortHdr k="calls" label="Calls" /></th>
                    <th><SortHdr k="errors" label="Errors" /></th>
                    <th><SortHdr k="errorRate" label="Rate%" /></th>
                    <th className="text-left text-[0.55rem] font-mono text-slate-500 pb-2 pr-4">14d trend</th>
                    <th className="text-left text-[0.55rem] font-mono text-slate-500 pb-2 pr-4">Last error</th>
                  </tr>
                </thead>
                <tbody>
                  {tools.map((t: ToolErrorStat) => {
                    const hex = rateColor(t.errorRate)
                    const expanded = expandedTool === t.tool
                    return (
                      <>
                        <tr
                          key={t.tool}
                          className="border-b border-white/[0.03] hover:bg-white/[0.02] transition-colors cursor-pointer"
                          onClick={() => setExpandedTool(expanded ? null : t.tool)}
                        >
                          <td className="pl-4 py-2.5">
                            <span className="text-[0.65rem] font-mono text-slate-300">{shortName(t.tool)}</span>
                            {t.commonErrorPrefix && (
                              <span className="text-[0.5rem] font-mono text-slate-600 ml-2">▶</span>
                            )}
                          </td>
                          <td className="pr-4 py-2.5">
                            <span className="text-[0.65rem] font-mono text-slate-400">{t.calls}</span>
                          </td>
                          <td className="pr-4 py-2.5">
                            <span className="text-[0.65rem] font-mono" style={{ color: t.errors > 0 ? '#EF4444' : '#475569' }}>{t.errors}</span>
                          </td>
                          <td className="pr-4 py-2.5">
                            <span
                              className="text-[0.65rem] font-mono px-1.5 py-0.5 rounded"
                              style={{ color: hex, background: `${hex}15` }}
                            >
                              {t.errorRate}%
                            </span>
                          </td>
                          <td className="pr-4 py-2.5">
                            <Sparkline data={t.sparkline} />
                          </td>
                          <td className="pr-4 py-2.5">
                            <span className="text-[0.5rem] font-mono text-slate-600">
                              {t.lastErrorTs ? t.lastErrorTs.slice(0, 16).replace('T', ' ') : '—'}
                            </span>
                          </td>
                        </tr>
                        {expanded && t.commonErrorPrefix && (
                          <tr key={`${t.tool}-exp`} className="border-b border-white/[0.03]">
                            <td colSpan={6} className="pl-8 pr-4 py-2">
                              <div className="text-[0.55rem] font-mono text-slate-500">Most common error:</div>
                              <div
                                className="text-[0.55rem] font-mono text-red-400 mt-0.5 rounded px-2 py-1"
                                style={{ background: 'rgba(239,68,68,0.06)', wordBreak: 'break-word' }}
                              >
                                {t.commonErrorPrefix}
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex items-center gap-4 mt-4 text-[0.55rem] font-mono">
            {[['green', '0%', '#10B981'], ['amber', '<10%', '#F59E0B'], ['red', '≥10%', '#EF4444']].map(([, label, hex]) => (
              <div key={label} className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full" style={{ background: hex }} />
                <span className="text-slate-600">{label} error rate</span>
              </div>
            ))}
          </div>

          <div className="text-[0.55rem] font-mono text-slate-700 text-right mt-4">
            Generated {new Date(data.generatedAt).toLocaleString()}
          </div>
        </div>
      )}
    </div>
  )
}
