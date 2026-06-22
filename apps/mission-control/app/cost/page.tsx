'use client'

import { useEffect, useState, useMemo } from 'react'
import Link from 'next/link'
import type { CostResponse, ProjectCost } from '../api/cost/route'

function fmtUsd(n: number): string {
  if (n >= 1) return `$${n.toFixed(2)}`
  if (n >= 0.01) return `$${n.toFixed(3)}`
  return `$${n.toFixed(4)}`
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`
  return String(n)
}

const PROJECT_COLORS = [
  '#00F5FF', '#A855F7', '#4ADE80', '#F59E0B', '#EF4444',
  '#38BDF8', '#FB7185', '#34D399', '#FBBF24', '#C084FC',
]

type SortKey = 'cost' | 'tokens' | 'cache' | 'trend'
type SortDir = 'asc' | 'desc'

// Stacked bar chart — one bar per day, color per project
function StackedBarChart({ projects, days }: { projects: ProjectCost[]; days: string[] }) {
  const maxTotal = useMemo(() => {
    let max = 0
    for (const d of days) {
      let total = 0
      for (const p of projects) {
        const entry = p.days.find((x) => x.date === d)
        if (entry) total += entry.costUsd
      }
      if (total > max) max = total
    }
    return max
  }, [projects, days])

  if (maxTotal === 0) {
    return (
      <div className="flex items-center justify-center h-32 text-xs font-mono text-slate-600">
        No cost data in this period
      </div>
    )
  }

  // Show last 30 days but only last 14 labels to keep it readable
  const showDays = days.slice(-30)

  return (
    <div className="relative">
      <div className="flex items-end gap-0.5 h-40 overflow-x-auto">
        {showDays.map((d) => {
          const segments: { slug: string; costUsd: number; color: string }[] = []
          let total = 0
          projects.forEach((p, i) => {
            const entry = p.days.find((x) => x.date === d)
            if (entry && entry.costUsd > 0) {
              segments.push({ slug: p.slug, costUsd: entry.costUsd, color: PROJECT_COLORS[i % PROJECT_COLORS.length] })
              total += entry.costUsd
            }
          })
          const heightPct = maxTotal > 0 ? (total / maxTotal) * 100 : 0

          return (
            <div
              key={d}
              className="flex-1 min-w-[6px] flex flex-col-reverse group relative"
              style={{ height: '100%', alignItems: 'stretch' }}
              title={`${d}: ${fmtUsd(total)}`}
            >
              <div style={{ height: `${heightPct}%`, display: 'flex', flexDirection: 'column-reverse' }}>
                {segments.map((seg) => (
                  <div
                    key={seg.slug}
                    style={{
                      height: `${(seg.costUsd / total) * 100}%`,
                      background: seg.color,
                      opacity: 0.8,
                      minHeight: 1,
                    }}
                  />
                ))}
              </div>
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover:block z-10 pointer-events-none">
                <div
                  className="text-[0.5rem] font-mono whitespace-nowrap rounded px-1.5 py-0.5 border"
                  style={{ background: '#080f1c', borderColor: 'rgba(0,245,255,0.2)', color: '#94a3b8' }}
                >
                  {d.slice(5)}: {fmtUsd(total)}
                  {segments.map((s) => (
                    <div key={s.slug} className="flex items-center gap-1">
                      <div className="w-1.5 h-1.5 rounded-sm" style={{ background: s.color }} />
                      {s.slug}: {fmtUsd(s.costUsd)}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )
        })}
      </div>
      <div className="flex justify-between mt-1">
        <span className="text-[0.45rem] font-mono text-slate-700">{showDays[0]?.slice(5)}</span>
        <span className="text-[0.45rem] font-mono text-slate-700">{showDays[showDays.length - 1]?.slice(5)}</span>
      </div>
    </div>
  )
}

// Simple CSS pie chart
function PieChart({ projects, total }: { projects: ProjectCost[]; total: number }) {
  if (total === 0) {
    return (
      <div className="flex items-center justify-center h-40 text-xs font-mono text-slate-600">
        No data
      </div>
    )
  }

  let cumPct = 0
  const slices = projects.filter((p) => p.totalCostUsd > 0).map((p, i) => {
    const pct = (p.totalCostUsd / total) * 100
    const start = cumPct
    cumPct += pct
    return { slug: p.slug, pct, start, color: PROJECT_COLORS[i % PROJECT_COLORS.length] }
  })

  // Build conic-gradient
  let gradient = 'conic-gradient('
  gradient += slices.map((s) => `${s.color} ${s.start.toFixed(1)}% ${(s.start + s.pct).toFixed(1)}%`).join(', ')
  gradient += ')'

  return (
    <div className="flex items-center gap-6">
      <div
        className="rounded-full flex-shrink-0"
        style={{ width: 120, height: 120, background: gradient }}
      />
      <div className="flex flex-col gap-1 overflow-hidden">
        {slices.slice(0, 8).map((s) => (
          <div key={s.slug} className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-sm flex-shrink-0" style={{ background: s.color }} />
            <span className="text-[0.6rem] font-mono text-slate-400 truncate max-w-[6rem]">{s.slug}</span>
            <span className="text-[0.6rem] font-mono text-slate-500 ml-auto">{s.pct.toFixed(1)}%</span>
          </div>
        ))}
        {slices.length > 8 && (
          <span className="text-[0.55rem] font-mono text-slate-600">+{slices.length - 8} more</span>
        )}
      </div>
    </div>
  )
}

export default function CostPage() {
  const [data, setData] = useState<CostResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [sortKey, setSortKey] = useState<SortKey>('cost')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  useEffect(() => {
    fetch('/api/cost')
      .then((r) => r.json() as Promise<CostResponse>)
      .then((d) => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  const allDays = useMemo(() => {
    if (!data) return []
    const days = new Set<string>()
    for (const p of data.projects) for (const d of p.days) days.add(d.date)
    return [...days].sort()
  }, [data])

  const sorted = useMemo(() => {
    if (!data) return []
    return [...data.projects].sort((a, b) => {
      let av = 0, bv = 0
      if (sortKey === 'cost') { av = a.totalCostUsd; bv = b.totalCostUsd }
      else if (sortKey === 'tokens') { av = a.totalInputTokens + a.totalOutputTokens; bv = b.totalInputTokens + b.totalOutputTokens }
      else if (sortKey === 'cache') { av = a.cacheHitPct; bv = b.cacheHitPct }
      else if (sortKey === 'trend') { av = a.trend7d; bv = b.trend7d }
      return sortDir === 'desc' ? bv - av : av - bv
    })
  }, [data, sortKey, sortDir])

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))
    else { setSortKey(key); setSortDir('desc') }
  }

  function sortIcon(key: SortKey) {
    if (sortKey !== key) return <span style={{ opacity: 0.2 }}>↕</span>
    return <span style={{ color: '#00F5FF' }}>{sortDir === 'desc' ? '↓' : '↑'}</span>
  }

  function trendColor(t: number) {
    if (t <= -10) return '#4ADE80'
    if (t >= 10) return '#EF4444'
    return '#64748b'
  }

  function trendLabel(t: number) {
    if (t === 0) return '—'
    return `${t > 0 ? '+' : ''}${t.toFixed(1)}%`
  }

  if (loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center" style={{ background: '#060d1a' }}>
        <div className="text-xs font-mono text-slate-600 animate-pulse">Loading cost data…</div>
      </div>
    )
  }

  const total = data?.totalCostUsd ?? 0
  const projects = data?.projects ?? []

  return (
    <div className="min-h-dvh flex flex-col" style={{ background: '#060d1a' }}>
      <header className="sticky top-0 z-30 border-b border-cyber-cyan/12 bg-[#060d1a]/90 backdrop-blur-md px-6 py-3">
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-cyber-cyan/40 to-transparent" />
        <div className="flex items-center gap-3 flex-wrap">
          <Link href="/" className="text-[0.6rem] font-mono text-slate-500 hover:text-cyber-cyan transition-colors uppercase tracking-wider">← Dashboard</Link>
          <h1 className="text-sm font-black tracking-[0.18em] text-cyber-cyan" style={{ fontFamily: 'Orbitron, JetBrains Mono, monospace' }}>
            Fleet Cost
          </h1>
          <span
            className="text-[0.6rem] font-mono text-slate-500 border border-slate-700 px-2 py-0.5 rounded"
          >
            30 days · {fmtUsd(total)} total
          </span>
          <div className="flex-1" />
          <a
            href="/api/cost"
            download="fleet-cost.json"
            className="text-[0.6rem] font-mono text-slate-500 hover:text-cyber-cyan transition-colors border border-slate-700 hover:border-cyber-cyan/30 px-2 py-1 rounded"
          >
            ↓ JSON
          </a>
        </div>
      </header>

      <main className="flex-1 p-6 max-w-6xl mx-auto w-full">
        {/* Charts row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
          <div className="rounded-lg border border-cyber-cyan/12 p-4" style={{ background: 'rgba(0,245,255,0.02)' }}>
            <p className="text-[0.55rem] font-mono text-slate-500 uppercase tracking-wider mb-3">Daily Cost — Last 30 Days</p>
            <StackedBarChart projects={projects} days={allDays} />
            {/* Legend */}
            <div className="flex flex-wrap gap-x-3 gap-y-1 mt-3">
              {projects.filter((p) => p.totalCostUsd > 0).slice(0, 6).map((p, i) => (
                <div key={p.slug} className="flex items-center gap-1">
                  <div className="w-2 h-2 rounded-sm" style={{ background: PROJECT_COLORS[i % PROJECT_COLORS.length] }} />
                  <span className="text-[0.5rem] font-mono text-slate-500">{p.slug}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-cyber-cyan/12 p-4" style={{ background: 'rgba(0,245,255,0.02)' }}>
            <p className="text-[0.55rem] font-mono text-slate-500 uppercase tracking-wider mb-3">Cost Share — 30-Day Cumulative</p>
            <PieChart projects={projects} total={total} />
          </div>
        </div>

        {/* Table */}
        <div className="rounded-lg border border-cyber-cyan/12 overflow-hidden" style={{ background: 'rgba(0,245,255,0.02)' }}>
          <div className="overflow-x-auto">
            <table className="w-full text-[0.65rem] font-mono">
              <thead>
                <tr className="border-b border-cyber-cyan/10">
                  <th className="text-left px-4 py-2.5 text-slate-500 uppercase tracking-wider font-normal">Project</th>
                  <th className="text-left px-4 py-2.5 text-slate-500 uppercase tracking-wider font-normal">Model</th>
                  <th
                    className="text-right px-4 py-2.5 text-slate-500 uppercase tracking-wider font-normal cursor-pointer hover:text-cyber-cyan transition-colors"
                    onClick={() => toggleSort('cost')}
                  >
                    Est. Cost {sortIcon('cost')}
                  </th>
                  <th
                    className="text-right px-4 py-2.5 text-slate-500 uppercase tracking-wider font-normal cursor-pointer hover:text-cyber-cyan transition-colors"
                    onClick={() => toggleSort('tokens')}
                  >
                    Tokens {sortIcon('tokens')}
                  </th>
                  <th
                    className="text-right px-4 py-2.5 text-slate-500 uppercase tracking-wider font-normal cursor-pointer hover:text-cyber-cyan transition-colors"
                    onClick={() => toggleSort('cache')}
                  >
                    Cache% {sortIcon('cache')}
                  </th>
                  <th
                    className="text-right px-4 py-2.5 text-slate-500 uppercase tracking-wider font-normal cursor-pointer hover:text-cyber-cyan transition-colors"
                    onClick={() => toggleSort('trend')}
                  >
                    7d Trend {sortIcon('trend')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {sorted.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-center py-8 text-slate-600">No cost data found. Transcripts may be empty.</td>
                  </tr>
                ) : sorted.map((p, i) => {
                  const totalTok = p.totalInputTokens + p.totalOutputTokens
                  const sharePct = total > 0 ? (p.totalCostUsd / total) * 100 : 0
                  return (
                    <tr key={p.slug} className="border-b border-white/4 hover:bg-white/2 transition-colors">
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 rounded-sm flex-shrink-0" style={{ background: PROJECT_COLORS[i % PROJECT_COLORS.length] }} />
                          <Link
                            href={`/projects/${encodeURIComponent(p.slug)}`}
                            className="text-cyber-cyan hover:underline"
                          >
                            {p.slug}
                          </Link>
                          <div
                            className="h-1 rounded-full ml-1"
                            style={{ width: `${Math.max(sharePct, 2)}px`, background: PROJECT_COLORS[i % PROJECT_COLORS.length], opacity: 0.5, maxWidth: 80 }}
                          />
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-slate-500">{p.model.replace('claude-', '').slice(0, 12)}</td>
                      <td className="px-4 py-2.5 text-right text-slate-200">{fmtUsd(p.totalCostUsd)}</td>
                      <td className="px-4 py-2.5 text-right text-slate-400">{fmtTokens(totalTok)}</td>
                      <td className="px-4 py-2.5 text-right" style={{ color: p.cacheHitPct > 20 ? '#4ADE80' : '#64748b' }}>
                        {p.cacheHitPct.toFixed(1)}%
                      </td>
                      <td className="px-4 py-2.5 text-right font-bold" style={{ color: trendColor(p.trend7d) }}>
                        {trendLabel(p.trend7d)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              {sorted.length > 0 && (
                <tfoot>
                  <tr className="border-t border-cyber-cyan/15">
                    <td colSpan={2} className="px-4 py-2.5 text-slate-500 font-bold">Total</td>
                    <td className="px-4 py-2.5 text-right text-cyber-cyan font-bold">{fmtUsd(total)}</td>
                    <td className="px-4 py-2.5 text-right text-slate-400">
                      {fmtTokens(sorted.reduce((s, p) => s + p.totalInputTokens + p.totalOutputTokens, 0))}
                    </td>
                    <td className="px-4 py-2.5 text-right text-slate-500">
                      {sorted.length > 0
                        ? `${(sorted.reduce((s, p) => s + p.cacheHitPct, 0) / sorted.length).toFixed(1)}%`
                        : '—'}
                    </td>
                    <td className="px-4 py-2.5" />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>

        <p className="text-[0.5rem] font-mono text-slate-700 mt-3">
          Pricing: Haiku $0.80/$4 · Sonnet $3/$15 · Opus $15/$75 per million tokens (input/output).
          Cached tokens counted but not billed separately. Last 30 days only.
        </p>
      </main>
    </div>
  )
}
