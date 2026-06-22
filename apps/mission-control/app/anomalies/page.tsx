'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import type { AnomaliesResponse, AnomalyEntry } from '../api/anomalies/route'

const METRIC_ICON: Record<string, string> = {
  interTurnGapMins: '⏱',
  toolCallsPerTurn: '⬡',
  outputTokensPerTurn: '⟨⟩',
}

function Sparkline({ values, width = 80, height = 24 }: { values: number[]; width?: number; height?: number }) {
  if (values.length < 2) return <span className="text-slate-700 text-[0.5rem]">—</span>
  const max = Math.max(...values, 0.001)
  const min = Math.min(...values)
  const range = max - min || 1
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * width
    const y = height - ((v - min) / range) * (height - 2) - 1
    return `${x},${y}`
  })
  const anomalyStart = Math.max(0, values.length - 3)
  const anomalyPts = values.slice(anomalyStart).map((v, i) => {
    const idx = anomalyStart + i
    const x = (idx / (values.length - 1)) * width
    const y = height - ((v - min) / range) * (height - 2) - 1
    return `${x},${y}`
  })
  return (
    <svg width={width} height={height} style={{ overflow: 'visible' }}>
      <polyline points={pts.join(' ')} fill="none" stroke="#334155" strokeWidth={1} />
      {anomalyPts.length >= 2 && (
        <polyline points={anomalyPts.join(' ')} fill="none" stroke="#EF4444" strokeWidth={1.5} />
      )}
    </svg>
  )
}

function SeverityBadge({ severity }: { severity: AnomalyEntry['severity'] }) {
  const color = severity === 'critical' ? '#EF4444' : '#F59E0B'
  const label = severity === 'critical' ? '● CRITICAL' : '▲ WARN'
  return (
    <span
      className="text-[0.5rem] font-mono px-1.5 py-0.5 rounded border"
      style={{ color, borderColor: color + '40', background: color + '10' }}
    >
      {label}
    </span>
  )
}

function Row({ a }: { a: AnomalyEntry }) {
  return (
    <tr className="border-t border-white/5 hover:bg-white/[0.02] transition-colors">
      <td className="px-3 py-2.5">
        <Link href={`/projects/${encodeURIComponent(a.slug)}`} className="text-[0.65rem] font-mono font-bold text-cyber-cyan hover:underline">
          {a.slug}
        </Link>
      </td>
      <td className="px-3 py-2.5">
        <div className="flex items-center gap-1.5">
          <span className="text-[0.6rem]">{METRIC_ICON[a.metric] ?? '?'}</span>
          <span className="text-[0.6rem] font-mono text-slate-300">{a.metricLabel}</span>
        </div>
      </td>
      <td className="px-3 py-2.5 text-right">
        <span className="text-[0.65rem] font-mono" style={{ color: a.severity === 'critical' ? '#EF4444' : '#F59E0B' }}>
          {a.currentValue}
        </span>
      </td>
      <td className="px-3 py-2.5 text-right">
        <span className="text-[0.6rem] font-mono text-slate-400">
          {a.baselineMean} ± {a.baselineStd}
        </span>
      </td>
      <td className="px-3 py-2.5 text-right">
        <span
          className="text-[0.65rem] font-mono font-bold"
          style={{ color: a.zScore >= 3 ? '#EF4444' : '#F59E0B' }}
        >
          {a.zScore}σ
        </span>
      </td>
      <td className="px-3 py-2.5">
        <SeverityBadge severity={a.severity} />
      </td>
      <td className="px-3 py-2.5">
        <Sparkline values={a.sparkline} />
      </td>
    </tr>
  )
}

export default function AnomaliesPage() {
  const [data, setData] = useState<AnomaliesResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [sortField, setSortField] = useState<'zScore' | 'slug'>('zScore')
  const [sortAsc, setSortAsc] = useState(false)
  const [filterSeverity, setFilterSeverity] = useState<'all' | 'warn' | 'critical'>('all')

  const load = useCallback(() => {
    setLoading(true)
    fetch('/api/anomalies')
      .then((r) => r.json())
      .then((d: AnomaliesResponse) => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  useEffect(() => {
    load()
    const id = setInterval(load, 60_000)
    return () => clearInterval(id)
  }, [load])

  function toggleSort(field: typeof sortField) {
    if (sortField === field) setSortAsc((v) => !v)
    else { setSortField(field); setSortAsc(false) }
  }

  const anomalies = (data?.anomalies ?? [])
    .filter((a) => filterSeverity === 'all' || a.severity === filterSeverity)
    .sort((a, b) => {
      let cmp = 0
      if (sortField === 'zScore') cmp = a.zScore - b.zScore
      else cmp = a.slug.localeCompare(b.slug)
      return sortAsc ? cmp : -cmp
    })

  const critCount = (data?.anomalies ?? []).filter((a) => a.severity === 'critical').length
  const warnCount = (data?.anomalies ?? []).filter((a) => a.severity === 'warn').length

  function SortHeader({ field, label }: { field: typeof sortField; label: string }) {
    const active = sortField === field
    return (
      <th
        className="px-3 py-2 text-right text-[0.55rem] font-mono uppercase tracking-wider cursor-pointer select-none transition-colors"
        style={{ color: active ? '#00F5FF' : '#475569' }}
        onClick={() => toggleSort(field)}
      >
        {label} {active ? (sortAsc ? '▲' : '▼') : ''}
      </th>
    )
  }

  return (
    <div className="min-h-dvh flex flex-col font-mono" style={{ background: '#060d1a' }}>
      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-cyber-cyan/12 bg-[#060d1a]/90 backdrop-blur-md px-4 py-2.5">
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-cyber-cyan/40 to-transparent" />
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-[0.65rem] font-mono font-bold text-cyber-cyan uppercase tracking-widest">Fleet Anomaly Detection</span>
          <div className="flex items-center gap-1.5">
            {critCount > 0 && (
              <span className="text-[0.5rem] font-mono px-1.5 py-0.5 rounded border" style={{ color: '#EF4444', borderColor: '#EF444440', background: '#EF444410' }}>
                {critCount} critical
              </span>
            )}
            {warnCount > 0 && (
              <span className="text-[0.5rem] font-mono px-1.5 py-0.5 rounded border" style={{ color: '#F59E0B', borderColor: '#F59E0B40', background: '#F59E0B10' }}>
                {warnCount} warn
              </span>
            )}
          </div>
          <div className="flex-1" />
          {/* Severity filter */}
          <div className="flex gap-1">
            {(['all', 'warn', 'critical'] as const).map((s) => (
              <button
                key={s}
                onClick={() => setFilterSeverity(s)}
                className="text-[0.55rem] px-2 py-0.5 rounded border transition-all capitalize"
                style={{
                  borderColor: filterSeverity === s ? '#00F5FF' : '#374151',
                  color: filterSeverity === s ? '#00F5FF' : '#6B7280',
                  background: filterSeverity === s ? 'rgba(0,245,255,0.08)' : 'transparent',
                }}
              >
                {s}
              </button>
            ))}
          </div>
          <button onClick={load} className="text-[0.55rem] text-slate-500 hover:text-cyber-cyan transition-colors border border-slate-700 hover:border-cyber-cyan/30 px-2 py-0.5 rounded">
            ↻ Refresh
          </button>
        </div>
      </header>

      <main className="flex-1 p-4">
        {loading && !data ? (
          <div className="flex items-center justify-center py-20">
            <span className="text-cyan-400/40 text-sm animate-pulse">Scanning transcripts…</span>
          </div>
        ) : anomalies.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 gap-3">
            <div className="text-5xl opacity-10">✓</div>
            <p className="text-sm font-mono text-slate-500">No anomalies detected</p>
            {data?.projectsChecked !== undefined && (
              <p className="text-[0.6rem] font-mono text-slate-700">
                {data.projectsChecked} projects scanned · {data.checkedAt ? new Date(data.checkedAt).toLocaleTimeString() : ''}
              </p>
            )}
          </div>
        ) : (
          <>
            <div className="overflow-x-auto rounded-lg border border-white/8" style={{ background: 'rgba(0,245,255,0.015)' }}>
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    <th
                      className="px-3 py-2 text-left text-[0.55rem] font-mono uppercase tracking-wider cursor-pointer select-none transition-colors"
                      style={{ color: sortField === 'slug' ? '#00F5FF' : '#475569' }}
                      onClick={() => toggleSort('slug')}
                    >
                      Project {sortField === 'slug' ? (sortAsc ? '▲' : '▼') : ''}
                    </th>
                    <th className="px-3 py-2 text-left text-[0.55rem] font-mono uppercase tracking-wider text-slate-600">Metric</th>
                    <th className="px-3 py-2 text-right text-[0.55rem] font-mono uppercase tracking-wider text-slate-600">Current (3-turn avg)</th>
                    <th className="px-3 py-2 text-right text-[0.55rem] font-mono uppercase tracking-wider text-slate-600">Baseline (mean ± σ)</th>
                    <SortHeader field="zScore" label="Z-score" />
                    <th className="px-3 py-2 text-left text-[0.55rem] font-mono uppercase tracking-wider text-slate-600">Severity</th>
                    <th className="px-3 py-2 text-left text-[0.55rem] font-mono uppercase tracking-wider text-slate-600">Trend (last 20 turns)</th>
                  </tr>
                </thead>
                <tbody>
                  {anomalies.map((a, i) => <Row key={`${a.slug}-${a.metric}-${i}`} a={a} />)}
                </tbody>
              </table>
            </div>
            <p className="text-[0.5rem] font-mono text-slate-700 mt-3 text-right">
              {data?.projectsChecked} projects scanned · last checked {data?.checkedAt ? new Date(data.checkedAt).toLocaleTimeString() : '—'} · red segment = anomalous region
            </p>
          </>
        )}
      </main>
    </div>
  )
}
