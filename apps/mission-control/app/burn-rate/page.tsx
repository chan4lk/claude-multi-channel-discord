'use client'

import { useEffect, useState, useMemo } from 'react'
import Link from 'next/link'
import type { BurnRateResponse, BurnRateProject } from '../api/metrics/burn-rate/route'

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`
  return String(Math.round(n))
}

// "Exhausts in N days" badge color: red ≤7, amber 8–14, green >14 or no budget
function exhaustColor(days: number | null): string {
  if (days == null) return '#64748b'
  if (days <= 7) return '#EF4444'
  if (days <= 14) return '#F59E0B'
  return '#4ADE80'
}

function exhaustLabel(days: number | null, budget: number): string {
  if (budget === 0) return 'no budget'
  if (days == null) return 'idle'
  return `exhausts in ${days}d`
}

// Inline SVG sparkline — one bar per day, last 7 days
function Sparkline({ spark }: { spark: number[] }) {
  const max = Math.max(...spark, 1)
  const W = 70, H = 22, n = spark.length
  const bw = W / n
  return (
    <svg width={W} height={H} className="inline-block align-middle">
      {spark.map((v, i) => {
        const h = Math.max((v / max) * H, v > 0 ? 1.5 : 0)
        return (
          <rect
            key={i}
            x={i * bw + 0.5}
            y={H - h}
            width={bw - 1}
            height={h}
            fill={i === n - 1 ? '#00F5FF' : '#38BDF8'}
            opacity={i === n - 1 ? 0.9 : 0.45}
          >
            <title>{fmtTokens(v)} tokens</title>
          </rect>
        )
      })}
    </svg>
  )
}

function BudgetBar({ pct }: { pct: number | null }) {
  if (pct == null) return <span className="text-slate-700 text-[0.6rem]">—</span>
  const clamped = Math.min(pct, 100)
  const color = pct >= 100 ? '#EF4444' : pct >= 80 ? '#F59E0B' : '#4ADE80'
  return (
    <div className="flex items-center gap-1.5 justify-end">
      <div className="w-16 h-1.5 rounded-full overflow-hidden" style={{ background: '#1e293b' }}>
        <div style={{ width: `${clamped}%`, height: '100%', background: color }} />
      </div>
      <span className="text-[0.6rem]" style={{ color, minWidth: 34, textAlign: 'right' }}>{pct.toFixed(0)}%</span>
    </div>
  )
}

// On-pace highlight: red if projected end-of-month exceeds budget, amber within 20%
function rowTint(p: BurnRateProject): string {
  if (p.budget === 0) return 'transparent'
  if (p.projectedMonthEnd >= p.budget) return 'rgba(239,68,68,0.07)'
  if (p.projectedMonthEnd >= p.budget * 0.8) return 'rgba(245,158,11,0.06)'
  return 'transparent'
}

export default function BurnRatePage() {
  const [data, setData] = useState<BurnRateResponse | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    function load() {
      fetch('/api/metrics/burn-rate')
        .then((r) => r.json() as Promise<BurnRateResponse>)
        .then((d) => { setData(d); setLoading(false) })
        .catch(() => setLoading(false))
    }
    load()
    const t = setInterval(load, 60_000)
    return () => clearInterval(t)
  }, [])

  const projects = useMemo(() => data?.projects ?? [], [data])

  if (loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center" style={{ background: '#060d1a' }}>
        <div className="text-xs font-mono text-slate-600 animate-pulse">Loading burn-rate forecast…</div>
      </div>
    )
  }

  const fleet = data?.fleet
  const daysRemaining = data?.daysRemaining ?? 0

  return (
    <div className="min-h-dvh flex flex-col" style={{ background: '#060d1a' }}>
      <header className="sticky top-0 z-30 border-b border-cyber-cyan/12 bg-[#060d1a]/90 backdrop-blur-md px-6 py-3">
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-cyber-cyan/40 to-transparent" />
        <div className="flex items-center gap-3 flex-wrap">
          <Link href="/" className="text-[0.6rem] font-mono text-slate-500 hover:text-cyber-cyan transition-colors uppercase tracking-wider">← Dashboard</Link>
          <h1 className="text-sm font-black tracking-[0.18em] text-cyber-cyan" style={{ fontFamily: 'Orbitron, JetBrains Mono, monospace' }}>
            Burn Rate Forecast
          </h1>
          <span className="text-[0.6rem] font-mono text-slate-500 border border-slate-700 px-2 py-0.5 rounded">
            {daysRemaining}d left in month
          </span>
          <div className="flex-1" />
          <Link href="/cost" className="text-[0.6rem] font-mono text-slate-500 hover:text-cyber-cyan transition-colors border border-slate-700 hover:border-cyber-cyan/30 px-2 py-1 rounded">
            Fleet Cost →
          </Link>
        </div>
      </header>

      <main className="flex-1 p-6 max-w-6xl mx-auto w-full">
        <div className="rounded-lg border border-cyber-cyan/12 overflow-hidden" style={{ background: 'rgba(0,245,255,0.02)' }}>
          <div className="overflow-x-auto">
            <table className="w-full text-[0.65rem] font-mono">
              <thead>
                <tr className="border-b border-cyber-cyan/10">
                  <th className="text-left px-4 py-2.5 text-slate-500 uppercase tracking-wider font-normal">Project</th>
                  <th className="text-right px-4 py-2.5 text-slate-500 uppercase tracking-wider font-normal">Daily Rate</th>
                  <th className="text-center px-4 py-2.5 text-slate-500 uppercase tracking-wider font-normal">7-Day Trend</th>
                  <th className="text-right px-4 py-2.5 text-slate-500 uppercase tracking-wider font-normal">Month-to-Date</th>
                  <th className="text-right px-4 py-2.5 text-slate-500 uppercase tracking-wider font-normal">Projected End</th>
                  <th className="text-right px-4 py-2.5 text-slate-500 uppercase tracking-wider font-normal">Budget</th>
                  <th className="text-right px-4 py-2.5 text-slate-500 uppercase tracking-wider font-normal">Forecast</th>
                </tr>
              </thead>
              <tbody>
                {/* Fleet total — pinned to top */}
                {fleet && (
                  <tr className="border-b border-cyber-cyan/15" style={{ background: 'rgba(0,245,255,0.04)' }}>
                    <td className="px-4 py-2.5 text-cyber-cyan font-bold">▣ Fleet Total</td>
                    <td className="px-4 py-2.5 text-right text-cyber-cyan font-bold">{fmtTokens(fleet.dailyRate)}/d</td>
                    <td className="px-4 py-2.5 text-center"><Sparkline spark={fleet.spark} /></td>
                    <td className="px-4 py-2.5 text-right text-slate-300">{fmtTokens(fleet.monthTokens)}</td>
                    <td className="px-4 py-2.5 text-right text-slate-300">{fmtTokens(fleet.projectedMonthEnd)}</td>
                    <td className="px-4 py-2.5 text-right text-slate-700">—</td>
                    <td className="px-4 py-2.5 text-right text-slate-700">—</td>
                  </tr>
                )}
                {projects.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="text-center py-8 text-slate-600">No projects found.</td>
                  </tr>
                ) : projects.map((p) => (
                  <tr key={p.slug} className="border-b border-white/4 hover:bg-white/2 transition-colors" style={{ background: rowTint(p) }}>
                    <td className="px-4 py-2.5">
                      <Link href={`/projects/${encodeURIComponent(p.slug)}`} className="text-cyber-cyan hover:underline">{p.slug}</Link>
                    </td>
                    <td className="px-4 py-2.5 text-right text-slate-300">{fmtTokens(p.dailyRate)}/d</td>
                    <td className="px-4 py-2.5 text-center"><Sparkline spark={p.spark} /></td>
                    <td className="px-4 py-2.5 text-right text-slate-400">{fmtTokens(p.monthTokens)}</td>
                    <td className="px-4 py-2.5 text-right text-slate-400">{fmtTokens(p.projectedMonthEnd)}</td>
                    <td className="px-4 py-2.5"><BudgetBar pct={p.budgetPct} /></td>
                    <td className="px-4 py-2.5 text-right">
                      <span
                        className="text-[0.6rem] font-mono px-1.5 py-0.5 rounded whitespace-nowrap"
                        style={{ background: `${exhaustColor(p.daysUntilExhausted)}18`, color: exhaustColor(p.daysUntilExhausted) }}
                      >
                        {exhaustLabel(p.daysUntilExhausted, p.budget)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <p className="text-[0.5rem] font-mono text-slate-700 mt-3">
          Daily rate = mean tokens/day over last 7 days. Projected end-of-month = month-to-date + rate × {daysRemaining} days remaining.
          Set <span className="text-slate-500">monthlyTokenBudget</span> per project in channels.json to enable exhaustion forecast. Refreshes every 60s.
        </p>
      </main>
    </div>
  )
}
