'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import type { LifecycleHeatmapResponse, ProjectLifecycleRow } from '../api/lifecycle-heatmap/route'

function cellColor(count: number, maxCount: number, normalize: boolean, rowMax: number): string {
  const max = normalize ? rowMax : maxCount
  if (count === 0 || max === 0) return 'rgba(255,255,255,0.03)'
  const ratio = count / max
  if (ratio < 0.25) return 'rgba(34,211,238,0.18)'
  if (ratio < 0.55) return 'rgba(34,211,238,0.45)'
  return `rgba(34,211,238,${Math.min(0.95, 0.7 + ratio * 0.25)})`
}

function cellGlow(count: number, maxCount: number, normalize: boolean, rowMax: number): string {
  const max = normalize ? rowMax : maxCount
  if (!max) return ''
  const ratio = count / max
  if (ratio >= 0.8) return '0 0 6px rgba(34,211,238,0.6)'
  return ''
}

function weekLabel(wk: string): string {
  // wk = "2025-W03"
  const [, w] = wk.split('-W')
  return `W${w}`
}

function Row({ row, weeks, maxCount, normalize, p75 }: {
  row: ProjectLifecycleRow
  weeks: string[]
  maxCount: number
  normalize: boolean
  p75: number
}) {
  const [tooltip, setTooltip] = useState<{ wk: string; count: number } | null>(null)
  const rowMax = Math.max(...Object.values(row.weekCounts), 0)

  return (
    <tr className="border-t border-white/5 hover:bg-white/[0.01] group">
      <td className="pl-3 pr-2 py-1 min-w-[90px]">
        <Link
          href={`/projects/${encodeURIComponent(row.slug)}`}
          className="text-[0.55rem] font-mono text-cyber-cyan hover:underline"
        >
          {row.slug}
        </Link>
      </td>
      {weeks.map((wk) => {
        const count = row.weekCounts[wk] ?? 0
        const isPulse = count >= p75 && count > 0
        return (
          <td key={wk} className="p-px relative">
            <div
              className={isPulse ? 'animate-pulse' : ''}
              style={{
                width: 12,
                height: 12,
                borderRadius: 2,
                background: cellColor(count, maxCount, normalize, rowMax),
                boxShadow: cellGlow(count, maxCount, normalize, rowMax),
                cursor: count > 0 ? 'pointer' : 'default',
              }}
              onMouseEnter={() => setTooltip({ wk, count })}
              onMouseLeave={() => setTooltip(null)}
            />
            {tooltip?.wk === wk && count > 0 && (
              <div
                className="absolute z-50 pointer-events-none"
                style={{ bottom: '100%', left: '50%', transform: 'translateX(-50%)', marginBottom: 4 }}
              >
                <div
                  className="text-[0.5rem] font-mono px-2 py-1 rounded border whitespace-nowrap"
                  style={{ background: '#0a1628', borderColor: 'rgba(0,245,255,0.2)', color: '#22D3EE' }}
                >
                  {row.slug} · {wk} · {count} turn{count !== 1 ? 's' : ''}
                </div>
              </div>
            )}
          </td>
        )
      })}
      <td className="px-2 text-right">
        <span className="text-[0.5rem] font-mono text-slate-600">{row.totalTurns}</span>
      </td>
    </tr>
  )
}

export default function LifecycleHeatmapPage() {
  const [data, setData] = useState<LifecycleHeatmapResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [normalize, setNormalize] = useState(false)
  const [search, setSearch] = useState('')

  const load = useCallback(() => {
    setLoading(true)
    fetch('/api/lifecycle-heatmap')
      .then((r) => r.json())
      .then((d: LifecycleHeatmapResponse) => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  useEffect(() => {
    load()
    const id = setInterval(load, 120_000)
    return () => clearInterval(id)
  }, [load])

  const rows = (data?.rows ?? []).filter((r) =>
    !search || r.slug.toLowerCase().includes(search.toLowerCase())
  )
  const weeks = data?.weeks ?? []
  const maxCount = data?.maxCount ?? 0

  // 75th-percentile for pulse
  const allCounts = rows.flatMap((r) => Object.values(r.weekCounts))
  allCounts.sort((a, b) => a - b)
  const p75 = allCounts[Math.floor(allCounts.length * 0.75)] ?? 0

  // Show every 4th week label to avoid clutter
  const labeledWeeks = new Set(weeks.filter((_, i) => i % 4 === 0))

  return (
    <div className="min-h-dvh flex flex-col font-mono" style={{ background: '#060d1a' }}>
      <header className="sticky top-0 z-30 border-b border-cyber-cyan/12 bg-[#060d1a]/90 backdrop-blur-md px-4 py-2.5">
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-cyber-cyan/40 to-transparent" />
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-[0.65rem] font-mono font-bold text-cyber-cyan uppercase tracking-widest">Project Lifecycle Heatmap</span>
          {data && (
            <span className="text-[0.55rem] font-mono text-slate-600">
              {data.rows.length} projects · {weeks.length} weeks
            </span>
          )}
          <div className="flex-1" />
          <input
            type="text"
            placeholder="Filter slug…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="text-[0.55rem] font-mono bg-transparent border border-slate-700 hover:border-cyber-cyan/30 focus:border-cyber-cyan/40 rounded px-2 py-0.5 outline-none text-slate-400 w-28"
          />
          <button
            onClick={() => setNormalize((v) => !v)}
            className="text-[0.55rem] px-2 py-0.5 rounded border transition-all"
            style={{
              borderColor: normalize ? '#00F5FF' : '#374151',
              color: normalize ? '#00F5FF' : '#6B7280',
              background: normalize ? 'rgba(0,245,255,0.08)' : 'transparent',
            }}
          >
            Normalize per-row
          </button>
          <button
            onClick={load}
            className="text-[0.55rem] text-slate-500 hover:text-cyber-cyan transition-colors border border-slate-700 hover:border-cyber-cyan/30 px-2 py-0.5 rounded"
          >
            ↻ Refresh
          </button>
        </div>
      </header>

      <main className="flex-1 p-4">
        {loading && !data ? (
          <div className="flex items-center justify-center py-20">
            <span className="text-cyan-400/40 text-sm animate-pulse">Reading transcripts…</span>
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 gap-3">
            <div className="text-5xl opacity-10">◫</div>
            <p className="text-sm font-mono text-slate-500">No project activity in the last 52 weeks</p>
          </div>
        ) : (
          <>
            {/* Legend */}
            <div className="flex items-center gap-3 mb-3 flex-wrap">
              <span className="text-[0.5rem] font-mono text-slate-600">Activity intensity:</span>
              {([0, 0.1, 0.35, 0.65, 1] as const).map((r, i) => {
                const labels = ['none', 'low', 'medium', 'high', 'peak']
                const count = Math.round(r * (normalize ? 20 : maxCount))
                return (
                  <div key={i} className="flex items-center gap-1">
                    <div
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: 2,
                        background: r === 0
                          ? 'rgba(255,255,255,0.03)'
                          : r < 0.25
                            ? 'rgba(34,211,238,0.18)'
                            : r < 0.55
                              ? 'rgba(34,211,238,0.45)'
                              : `rgba(34,211,238,${0.7 + r * 0.25})`,
                      }}
                    />
                    <span className="text-[0.45rem] font-mono text-slate-600">{labels[i]}</span>
                  </div>
                )
              })}
              <span className="text-[0.45rem] font-mono text-amber-400/60 ml-2">⚡ amber pulse = above 75th percentile</span>
            </div>

            <div className="overflow-x-auto rounded-lg border border-white/8" style={{ background: 'rgba(0,245,255,0.015)' }}>
              <table className="border-collapse" style={{ tableLayout: 'fixed' }}>
                <thead>
                  <tr>
                    <th className="pl-3 pr-2 py-1.5 text-left text-[0.5rem] font-mono uppercase tracking-wider text-slate-600 min-w-[90px]">
                      Project
                    </th>
                    {weeks.map((wk) => (
                      <th key={wk} className="p-px" style={{ width: 14 }}>
                        {labeledWeeks.has(wk) ? (
                          <span
                            className="text-[0.4rem] font-mono text-slate-700"
                            style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', lineHeight: 1 }}
                          >
                            {weekLabel(wk)}
                          </span>
                        ) : null}
                      </th>
                    ))}
                    <th className="px-2 py-1.5 text-right text-[0.5rem] font-mono uppercase tracking-wider text-slate-600">
                      Total
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <Row
                      key={row.slug}
                      row={row}
                      weeks={weeks}
                      maxCount={maxCount}
                      normalize={normalize}
                      p75={p75}
                    />
                  ))}
                </tbody>
              </table>
            </div>

            <p className="text-[0.5rem] font-mono text-slate-700 mt-3 text-right">
              52-week window · generated {data?.generatedAt ? new Date(data.generatedAt).toLocaleTimeString() : '—'}
            </p>
          </>
        )}
      </main>
    </div>
  )
}
