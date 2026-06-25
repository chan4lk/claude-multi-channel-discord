'use client'

import SubPageHeader from '../../components/SubPageHeader'
import { useFreshness } from '../../lib/useFreshness'
import FreshnessBadge from '../../components/FreshnessBadge'
import type { BudgetForecastResponse, ProjectForecast } from '../api/budget-forecast/route'

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`
  return String(n)
}

function daysColor(days: number | null): string {
  if (days === null) return '#4ADE80'
  if (days < 7) return '#EF4444'
  if (days < 14) return '#F59E0B'
  return '#4ADE80'
}

function usagePct(used: number, budget: number): number {
  if (budget === 0) return 0
  return Math.min(100, Math.round((used / budget) * 100))
}

function Sparkline({ daily }: { daily: ProjectForecast['daily14d'] }) {
  const max = Math.max(1, ...daily.map(d => d.tokens))
  const W = 80
  const H = 20
  const barW = Math.floor(W / daily.length) - 1

  return (
    <svg width={W} height={H} style={{ display: 'block' }}>
      {daily.map((d, i) => {
        const h = Math.max(1, Math.round((d.tokens / max) * (H - 2)))
        const x = i * (barW + 1)
        const y = H - h
        const isToday = i === daily.length - 1
        return (
          <rect
            key={i}
            x={x}
            y={y}
            width={barW}
            height={h}
            fill={isToday ? '#60a5fa' : '#1d4ed8'}
            opacity={d.tokens === 0 ? 0.2 : 0.85}
          />
        )
      })}
    </svg>
  )
}

function ProgressBar({ pct, color }: { pct: number; color: string }) {
  return (
    <div className="relative w-24 h-2 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
      <div
        className="absolute inset-y-0 left-0 rounded-full"
        style={{ width: `${Math.min(100, pct)}%`, background: color }}
      />
    </div>
  )
}

export default function BudgetForecastPage() {
  const { data, isStale, lastError, lastSuccessAt } = useFreshness<BudgetForecastResponse>(
    '/api/budget-forecast', 120_000
  )

  const projects = data?.projects ?? []

  return (
    <div className="min-h-screen p-4 md:p-6" style={{ background: '#080f1c', color: '#E2E8F0' }}>
      <SubPageHeader title="Token Budget Exhaustion Forecast">
        <FreshnessBadge isStale={isStale} lastError={lastError} lastSuccessAt={lastSuccessAt} />
      </SubPageHeader>

      {!data && (
        <div className="text-center py-20 text-slate-600 font-mono text-sm">Loading…</div>
      )}

      {data && projects.length === 0 && (
        <div className="text-center py-20 text-slate-600 font-mono text-sm">
          No projects with a monthly token budget set
          <div className="text-[0.5rem] mt-2 text-slate-700">
            Set monthlyTokenBudget on project entries in channels.json
          </div>
        </div>
      )}

      {data && projects.length > 0 && (
        <div className="max-w-5xl mx-auto">
          {/* Alert summary */}
          {projects.some(p => p.daysToExhaustion !== null && p.daysToExhaustion < 7) && (
            <div
              className="mb-4 p-3 rounded border text-[0.65rem] font-mono"
              style={{ background: 'rgba(239,68,68,0.08)', borderColor: 'rgba(239,68,68,0.3)', color: '#FCA5A5' }}
            >
              ⚠ {projects.filter(p => p.daysToExhaustion !== null && p.daysToExhaustion < 7).length} project
              {projects.filter(p => p.daysToExhaustion !== null && p.daysToExhaustion < 7).length !== 1 ? 's' : ''}{' '}
              will exhaust budget within 7 days
            </div>
          )}

          {/* Table */}
          <div
            className="rounded border border-white/08 overflow-x-auto"
            style={{ background: '#060d19' }}
          >
            <table className="w-full text-[0.6rem] font-mono">
              <thead>
                <tr className="text-slate-600 border-b border-white/08 text-right">
                  <th className="text-left px-4 py-2.5">project</th>
                  <th className="px-3 py-2.5">used</th>
                  <th className="px-3 py-2.5">budget</th>
                  <th className="px-3 py-2.5 text-left">usage%</th>
                  <th className="px-3 py-2.5">projected</th>
                  <th className="px-3 py-2.5">burn/day</th>
                  <th className="px-3 py-2.5">days left</th>
                  <th className="px-3 py-2.5">R²</th>
                  <th className="px-4 py-2.5">14d trend</th>
                </tr>
              </thead>
              <tbody>
                {projects.map((p: ProjectForecast) => {
                  const pct = usagePct(p.monthlyUsed, p.monthlyBudget)
                  const projPct = usagePct(p.projectedMonthlyTotal, p.monthlyBudget)
                  const dayCol = daysColor(p.daysToExhaustion)
                  const projOver = p.projectedMonthlyTotal > p.monthlyBudget
                  return (
                    <tr key={p.slug} className="border-b border-white/04 hover:bg-white/02">
                      <td className="px-4 py-2 text-cyan-300 text-left">{p.slug}</td>
                      <td className="px-3 py-2 text-right text-slate-400">
                        {fmtTokens(p.monthlyUsed)}
                      </td>
                      <td className="px-3 py-2 text-right text-slate-500">
                        {fmtTokens(p.monthlyBudget)}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <ProgressBar pct={pct} color={daysColor(p.daysToExhaustion)} />
                          <span className="text-slate-500">{pct}%</span>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right" style={{ color: projOver ? '#EF4444' : '#94A3B8' }}>
                        {fmtTokens(p.projectedMonthlyTotal)}
                        {projOver && <span className="text-red-500 ml-1">↑{Math.round(projPct - 100)}%</span>}
                      </td>
                      <td className="px-3 py-2 text-right text-slate-500">
                        {fmtTokens(p.burnRatePerDay)}/d
                      </td>
                      <td className="px-3 py-2 text-right font-bold" style={{ color: dayCol }}>
                        {p.daysToExhaustion === null ? '—' : `${p.daysToExhaustion}d`}
                      </td>
                      <td className="px-3 py-2 text-right text-slate-600">
                        {p.regressionR2.toFixed(2)}
                      </td>
                      <td className="px-4 py-2">
                        <Sparkline daily={p.daily14d} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="mt-3 flex gap-6 text-[0.5rem] font-mono text-slate-600 flex-wrap">
            <span><span className="text-red-400">■</span> &lt;7d remaining</span>
            <span><span className="text-amber-400">■</span> 7–14d remaining</span>
            <span><span className="text-green-400">■</span> &gt;14d or no limit</span>
            <span className="ml-auto">R² = regression confidence (0–1) · sparkline = last 14 days · blue bar = today</span>
          </div>

          <div className="text-[0.5rem] font-mono text-slate-700 text-right mt-2">
            generated {data.generatedAt.slice(0, 16).replace('T', ' ')} UTC
          </div>
        </div>
      )}
    </div>
  )
}
