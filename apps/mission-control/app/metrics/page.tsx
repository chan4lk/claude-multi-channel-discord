'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import type { MetricsResponse } from '../api/metrics/route'
import type { SlugMetrics } from '../api/metrics/[slug]/route'
import Sparkline from '../../components/ui/Sparkline'

function fmtMs(ms: number): string {
  if (ms === 0) return '—'
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function fmtTokens(n: number): string {
  if (n === 0) return '0'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`
  return String(n)
}

function fmtCost(usd: number): string {
  if (usd === 0) return '$0.00'
  if (usd < 0.01) return '<$0.01'
  return `$${usd.toFixed(2)}`
}

function MetricsRow({ project, expanded, onToggle }: {
  project: SlugMetrics
  expanded: boolean
  onToggle: () => void
}) {
  const totalTokens = project.totalInputTokens + project.totalOutputTokens
  const sparkData = project.dayBuckets.map((b) => b.tokens)
  const hasData = totalTokens > 0

  return (
    <>
      <tr
        onClick={onToggle}
        className="border-b border-cyber-cyan/6 cursor-pointer transition-colors"
        style={{ background: expanded ? 'rgba(0,245,255,0.04)' : 'transparent' }}
      >
        <td className="px-4 py-3">
          <div className="flex items-center gap-2">
            <span
              className="text-[0.6rem] font-mono text-slate-500 transition-transform"
              style={{ transform: expanded ? 'rotate(90deg)' : 'none', display: 'inline-block' }}
            >▶</span>
            <span className="text-sm font-mono text-cyber-cyan">{project.slug}</span>
          </div>
        </td>
        <td className="px-4 py-3 text-right">
          <span className="text-xs font-mono text-slate-300">{hasData ? fmtTokens(totalTokens) : '—'}</span>
        </td>
        <td className="px-4 py-3 text-right">
          <span className="text-xs font-mono" style={{ color: project.estimatedCostUsd > 1 ? '#F59E0B' : '#4ADE80' }}>
            {hasData ? fmtCost(project.estimatedCostUsd) : '—'}
          </span>
        </td>
        <td className="px-4 py-3 text-right">
          <span className="text-xs font-mono text-slate-400">{hasData ? fmtMs(project.avgLatencyMs) : '—'}</span>
        </td>
        <td className="px-4 py-3 text-right">
          <span className="text-xs font-mono text-slate-500">{hasData ? fmtMs(project.p95LatencyMs) : '—'}</span>
        </td>
        <td className="px-4 py-3 text-right">
          <span className="text-xs font-mono text-slate-400">{hasData ? project.turnsPerDay : '—'}</span>
        </td>
        <td className="px-4 py-3">
          <Sparkline data={sparkData} width={80} height={22} color="#00F5FF" />
        </td>
      </tr>
      {expanded && (
        <tr style={{ background: 'rgba(0,245,255,0.02)' }}>
          <td colSpan={7} className="px-8 py-4 border-b border-cyber-cyan/8">
            <div className="flex flex-col gap-2">
              <p className="text-[0.6rem] font-mono text-slate-500 uppercase tracking-wider mb-1">7-Day Token Activity</p>
              <div className="flex items-end gap-2">
                {project.dayBuckets.map((b, i) => {
                  const maxVal = Math.max(...project.dayBuckets.map((x) => x.tokens), 1)
                  const h = Math.max(4, (b.tokens / maxVal) * 48)
                  return (
                    <div key={i} className="flex flex-col items-center gap-1">
                      <div
                        className="w-6 rounded-sm"
                        style={{ height: h, background: b.tokens > 0 ? '#00F5FF' : '#1e2a3a', opacity: 0.8 }}
                        title={`${b.date}: ${fmtTokens(b.tokens)} tokens`}
                      />
                      <span className="text-[0.5rem] font-mono text-slate-600">{b.date.slice(5)}</span>
                    </div>
                  )
                })}
              </div>
              <div className="flex gap-6 mt-2 text-[0.6rem] font-mono text-slate-500">
                <span>Input: {fmtTokens(project.totalInputTokens)}</span>
                <span>Output: {fmtTokens(project.totalOutputTokens)}</span>
                <span>Total turns/day: {project.turnsPerDay}</span>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

function exportCsv(data: MetricsResponse) {
  const headers = ['slug', 'totalInputTokens', 'totalOutputTokens', 'estimatedCostUsd', 'avgLatencyMs', 'p95LatencyMs', 'turnsPerDay']
  const rows: string[][] = data.projects.map((p) => [
    p.slug,
    String(p.totalInputTokens),
    String(p.totalOutputTokens),
    p.estimatedCostUsd.toFixed(4),
    String(p.avgLatencyMs),
    String(p.p95LatencyMs),
    String(p.turnsPerDay),
  ])
  const agg = data.aggregate
  if (agg) {
    rows.push([
      '__total__',
      String(agg.totalInputTokens),
      String(agg.totalOutputTokens),
      agg.estimatedCostUsd.toFixed(4),
      '—',
      '—',
      '—',
    ])
  }
  const csv = [headers, ...rows].map((r) => r.map((v) => `"${v}"`).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  const date = new Date().toISOString().slice(0, 10)
  a.href = url
  a.download = `mcd-metrics-${date}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

export default function MetricsPage() {
  const [data, setData] = useState<MetricsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [stale, setStale] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const load = useCallback(() => {
    setStale(false)
    fetch('/api/metrics')
      .then((r) => r.json())
      .then((d: MetricsResponse) => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  useEffect(() => {
    load()
    const interval = setInterval(() => { setStale(true); load() }, 60_000)
    return () => clearInterval(interval)
  }, [load])

  function toggleExpand(slug: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(slug)) next.delete(slug)
      else next.add(slug)
      return next
    })
  }

  const agg = data?.aggregate
  const projects = data?.projects ?? []

  return (
    <div className="min-h-dvh flex flex-col" style={{ background: '#060d1a' }}>
      <header className="relative border-b border-cyber-cyan/12 bg-cyber-surface/70 backdrop-blur-md px-6 py-3">
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-cyber-cyan/40 to-transparent" />
        <div className="flex items-center gap-4">
          <Link href="/" className="text-[0.6rem] font-mono text-slate-500 hover:text-cyber-cyan transition-colors uppercase tracking-wider">
            ← Dashboard
          </Link>
          <h1 className="text-lg font-black tracking-[0.18em] text-cyber-cyan" style={{ fontFamily: 'Orbitron, JetBrains Mono, monospace' }}>
            METRICS
          </h1>
          {stale && (
            <span className="text-[0.55rem] font-mono text-amber-400 border border-amber-400/30 px-1.5 py-0.5 rounded">REFRESHING…</span>
          )}
          <div className="flex-1" />
          <button
            onClick={() => { if (data) exportCsv(data) }}
            disabled={loading || !data}
            className="text-[0.6rem] font-mono text-slate-500 hover:text-cyber-cyan transition-colors uppercase tracking-wider border border-slate-700 hover:border-cyber-cyan/30 px-2 py-1 rounded disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {loading ? 'Loading…' : '⬇ Export CSV'}
          </button>
          <button
            onClick={load}
            className="text-[0.6rem] font-mono text-slate-500 hover:text-cyber-cyan transition-colors uppercase tracking-wider border border-slate-700 hover:border-cyber-cyan/30 px-2 py-1 rounded"
          >
            Refresh
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-auto p-4">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="text-xs font-mono text-slate-600 animate-pulse">Loading metrics…</div>
          </div>
        ) : (
          <div className="max-w-5xl mx-auto space-y-4">
            {/* Aggregate row */}
            {agg && (
              <div className="rounded-lg border border-cyber-cyan/20 p-4 flex flex-wrap gap-6"
                style={{ background: 'rgba(0,245,255,0.03)' }}>
                <div>
                  <p className="text-[0.55rem] font-mono text-slate-600 uppercase tracking-wider">Total Tokens</p>
                  <p className="text-xl font-mono font-bold text-cyber-cyan">{fmtTokens(agg.totalInputTokens + agg.totalOutputTokens)}</p>
                </div>
                <div>
                  <p className="text-[0.55rem] font-mono text-slate-600 uppercase tracking-wider">Est. Cost</p>
                  <p className="text-xl font-mono font-bold text-amber-400">{fmtCost(agg.estimatedCostUsd)}</p>
                </div>
                <div>
                  <p className="text-[0.55rem] font-mono text-slate-600 uppercase tracking-wider">Projects</p>
                  <p className="text-xl font-mono font-bold text-slate-300">{agg.projectCount}</p>
                </div>
                <div>
                  <p className="text-[0.55rem] font-mono text-slate-600 uppercase tracking-wider">Input</p>
                  <p className="text-sm font-mono text-slate-400">{fmtTokens(agg.totalInputTokens)}</p>
                </div>
                <div>
                  <p className="text-[0.55rem] font-mono text-slate-600 uppercase tracking-wider">Output</p>
                  <p className="text-sm font-mono text-slate-400">{fmtTokens(agg.totalOutputTokens)}</p>
                </div>
              </div>
            )}

            {/* Per-project table */}
            {projects.length === 0 ? (
              <div className="flex items-center justify-center h-48 flex-col gap-2 text-slate-600">
                <div className="text-3xl opacity-20">◎</div>
                <span className="text-xs font-mono">No project metrics available</span>
              </div>
            ) : (
              <div className="rounded-lg border border-cyber-cyan/12 overflow-hidden">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-cyber-cyan/12" style={{ background: 'rgba(0,245,255,0.04)' }}>
                      <th className="px-4 py-2 text-[0.6rem] font-mono text-slate-500 uppercase tracking-wider">Project</th>
                      <th className="px-4 py-2 text-[0.6rem] font-mono text-slate-500 uppercase tracking-wider text-right">Tokens</th>
                      <th className="px-4 py-2 text-[0.6rem] font-mono text-slate-500 uppercase tracking-wider text-right">Cost</th>
                      <th className="px-4 py-2 text-[0.6rem] font-mono text-slate-500 uppercase tracking-wider text-right">Avg Latency</th>
                      <th className="px-4 py-2 text-[0.6rem] font-mono text-slate-500 uppercase tracking-wider text-right">p95 Latency</th>
                      <th className="px-4 py-2 text-[0.6rem] font-mono text-slate-500 uppercase tracking-wider text-right">Turns/Day</th>
                      <th className="px-4 py-2 text-[0.6rem] font-mono text-slate-500 uppercase tracking-wider">7d Trend</th>
                    </tr>
                  </thead>
                  <tbody>
                    {projects
                      .sort((a: SlugMetrics, b: SlugMetrics) => b.totalInputTokens + b.totalOutputTokens - (a.totalInputTokens + a.totalOutputTokens))
                      .map((p: SlugMetrics) => (
                        <MetricsRow
                          key={p.slug}
                          project={p}
                          expanded={expanded.has(p.slug)}
                          onToggle={() => toggleExpand(p.slug)}
                        />
                      ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </main>

      <footer className="border-t border-cyber-cyan/8 px-6 py-2">
        <p className="text-[0.55rem] font-mono text-slate-600">
          {projects.length} projects · Refreshes every 60s · Cost estimates use list pricing (Haiku/Sonnet/Opus)
          {data?.checkedAt && ` · Updated ${new Date(data.checkedAt).toLocaleTimeString()}`}
        </p>
      </footer>
    </div>
  )
}
