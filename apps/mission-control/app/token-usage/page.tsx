'use client'

import { useEffect, useState, useCallback } from 'react'
import SubPageHeader from '../../components/SubPageHeader'
import type { TokenUsageResponse, ProjectTokenStats } from '../api/token-usage/route'

const MODEL_CONTEXT = 200_000

function pressureColor(pct: number): string {
  if (pct < 50) return '#10B981'
  if (pct < 80) return '#F59E0B'
  return '#EF4444'
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

function fmtRate(n: number): string {
  return `${fmtTokens(n)}/h`
}

// Render a sparkline of cumulative tokens over time (last N turns)
function TurnSparkline({ turns, color }: { turns: Array<{ totalTokens: number }>; color: string }) {
  const W = 80, H = 22
  if (turns.length < 2) {
    return <svg width={W} height={H}><line x1={0} y1={H / 2} x2={W} y2={H / 2} stroke="#1e293b" strokeWidth={1} /></svg>
  }
  // Cumulative
  const cumulative: number[] = []
  let sum = 0
  for (const t of turns) { sum += t.totalTokens; cumulative.push(sum) }
  const max = cumulative[cumulative.length - 1]!
  const pts = cumulative.map((v, i) => {
    const x = (i / (cumulative.length - 1)) * W
    const y = H - (v / max) * (H - 2) - 1
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
  return (
    <svg width={W} height={H} className="inline-block align-middle">
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} opacity={0.8} />
    </svg>
  )
}

export default function TokenUsagePage() {
  const [data, setData] = useState<TokenUsageResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [windowDays, setWindowDays] = useState(7)
  const [selectedSlug, setSelectedSlug] = useState<string>('')
  const [slugOptions, setSlugOptions] = useState<string[]>([])
  const [expanded, setExpanded] = useState<string | null>(null)

  const load = useCallback((days: number, slug: string) => {
    setLoading(true)
    const params = new URLSearchParams({ window: String(days) })
    if (slug) params.set('slug', slug)
    fetch(`/api/token-usage?${params}`)
      .then((r) => r.json())
      .then((d: TokenUsageResponse) => {
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

  useEffect(() => { load(windowDays, selectedSlug) }, [load, windowDays, selectedSlug])

  const projects = (data?.projects ?? []).slice(0, 15)

  const topBurner = projects[0] ?? null
  const avgBurn = projects.length > 0
    ? Math.round(projects.reduce((s, p) => s + p.burnRatePerHour, 0) / projects.length)
    : 0
  const highPressure = projects.filter((p) => p.contextPressurePct >= 80).length

  return (
    <div className="min-h-screen p-4 md:p-6" style={{ background: '#080f1c', color: '#E2E8F0' }}>
      <SubPageHeader title="Token Usage Trend">
        <span className="text-[0.6rem] font-mono text-slate-500">
          Context burn rate per project · cumulative tokens · pressure indicator
        </span>
      </SubPageHeader>

      {loading && <div className="text-center py-20 text-slate-600 font-mono text-sm">Loading…</div>}

      {!loading && data && (
        <div className="max-w-5xl mx-auto">
          {/* Summary cards */}
          <div className="flex flex-wrap gap-4 mb-5">
            {[
              { label: 'Top burn rate', value: topBurner ? fmtRate(topBurner.burnRatePerHour) : '—', sub: topBurner?.slug ?? '', color: '#EF4444' },
              { label: 'Fleet avg burn', value: fmtRate(avgBurn), sub: 'tokens/hour', color: '#F59E0B' },
              { label: 'High pressure', value: String(highPressure), sub: '≥80% context', color: highPressure > 0 ? '#EF4444' : '#10B981' },
            ].map(({ label, value, sub, color }) => (
              <div key={label} className="rounded border border-white/5 px-4 py-2 text-center min-w-[130px]" style={{ background: 'rgba(255,255,255,0.02)' }}>
                <div className="text-base font-mono font-bold" style={{ color }}>{value}</div>
                <div className="text-[0.5rem] font-mono text-slate-600">{label}</div>
                {sub && <div className="text-[0.45rem] font-mono text-slate-700">{sub}</div>}
              </div>
            ))}
          </div>

          {/* Controls */}
          <div className="flex flex-wrap items-center gap-3 mb-4">
            {[3, 7, 14, 30].map((d) => (
              <button
                key={d}
                onClick={() => setWindowDays(d)}
                className="text-[0.65rem] font-mono px-3 py-1 rounded border transition-colors"
                style={{
                  borderColor: windowDays === d ? '#22D3EE' : 'rgba(255,255,255,0.1)',
                  color: windowDays === d ? '#22D3EE' : '#64748B',
                  background: windowDays === d ? 'rgba(34,211,238,0.08)' : 'transparent',
                }}
              >
                {d}d
              </button>
            ))}
            <select
              value={selectedSlug}
              onChange={(e) => setSelectedSlug(e.target.value)}
              className="text-[0.65rem] font-mono px-2 py-1 rounded border border-white/10"
              style={{ background: '#0d1b2e', color: '#E2E8F0' }}
            >
              <option value="">All projects (top 15)</option>
              {slugOptions.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          {projects.length === 0 ? (
            <div className="text-center py-20 text-slate-600 font-mono text-sm">
              No token usage data found in transcripts for this window
            </div>
          ) : (
            <div className="rounded-lg border border-white/5 overflow-hidden" style={{ background: 'rgba(255,255,255,0.02)' }}>
              <table className="w-full">
                <thead>
                  <tr className="border-b border-white/5">
                    {['Project', 'Burn rate', 'Avg/turn', 'Total', 'Context %', 'Trend', 'Turns'].map((h) => (
                      <th key={h} className="text-left text-[0.55rem] font-mono text-slate-500 pl-4 py-2 pr-3">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {projects.map((p: ProjectTokenStats) => {
                    const color = pressureColor(p.contextPressurePct)
                    const isExp = expanded === p.slug
                    return (
                      <>
                        <tr
                          key={p.slug}
                          className="border-b border-white/[0.03] hover:bg-white/[0.02] transition-colors cursor-pointer"
                          onClick={() => setExpanded(isExp ? null : p.slug)}
                        >
                          <td className="pl-4 py-2.5">
                            <span className="text-[0.65rem] font-mono text-slate-300">{p.slug}</span>
                          </td>
                          <td className="pr-3 py-2.5">
                            <span className="text-[0.65rem] font-mono" style={{ color: p.burnRatePerHour > 0 ? '#F59E0B' : '#475569' }}>
                              {p.burnRatePerHour > 0 ? fmtRate(p.burnRatePerHour) : '—'}
                            </span>
                          </td>
                          <td className="pr-3 py-2.5">
                            <span className="text-[0.65rem] font-mono text-slate-400">{fmtTokens(p.avgTokensPerTurn)}</span>
                          </td>
                          <td className="pr-3 py-2.5">
                            <span className="text-[0.65rem] font-mono text-slate-400">{fmtTokens(p.totalTokens)}</span>
                          </td>
                          <td className="pr-3 py-2.5">
                            <span
                              className="text-[0.65rem] font-mono px-1.5 py-0.5 rounded"
                              style={{ color, background: `${color}15` }}
                            >
                              {p.contextPressurePct}%
                            </span>
                          </td>
                          <td className="pr-3 py-2.5">
                            <TurnSparkline turns={p.turns.slice(-40)} color={color} />
                          </td>
                          <td className="pr-4 py-2.5">
                            <span className="text-[0.6rem] font-mono text-slate-600">{p.turns.length}</span>
                          </td>
                        </tr>
                        {isExp && (
                          <tr key={`${p.slug}-exp`} className="border-b border-white/[0.03]">
                            <td colSpan={7} className="pl-8 pr-4 py-3">
                              <div className="flex gap-6 text-[0.55rem] font-mono text-slate-500">
                                <div>
                                  <div className="text-slate-600 mb-1">Input tokens</div>
                                  <div className="text-slate-300">{fmtTokens(p.totalInputTokens)}</div>
                                </div>
                                <div>
                                  <div className="text-slate-600 mb-1">Output tokens</div>
                                  <div className="text-slate-300">{fmtTokens(p.totalOutputTokens)}</div>
                                </div>
                                <div>
                                  <div className="text-slate-600 mb-1">Context limit</div>
                                  <div className="text-slate-300">{fmtTokens(MODEL_CONTEXT)}</div>
                                </div>
                                <div>
                                  <div className="text-slate-600 mb-1">Pressure</div>
                                  <div style={{ color }}>{p.contextPressurePct}% of limit</div>
                                </div>
                              </div>
                              {/* Mini bar */}
                              <div className="mt-2 h-1.5 rounded-full bg-slate-800 overflow-hidden w-48">
                                <div
                                  className="h-full rounded-full transition-all"
                                  style={{ width: `${p.contextPressurePct}%`, background: color }}
                                />
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

          {/* Legend */}
          <div className="flex items-center gap-4 mt-4 text-[0.55rem] font-mono">
            {[['<50%', '#10B981'], ['50–80%', '#F59E0B'], ['≥80%', '#EF4444']].map(([label, hex]) => (
              <div key={label} className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full" style={{ background: hex }} />
                <span className="text-slate-600">{label} context</span>
              </div>
            ))}
          </div>

          <div className="text-[0.55rem] font-mono text-slate-700 text-right mt-4">
            Generated {new Date(data.generatedAt).toLocaleString()} · {windowDays}d window
          </div>
        </div>
      )}
    </div>
  )
}
