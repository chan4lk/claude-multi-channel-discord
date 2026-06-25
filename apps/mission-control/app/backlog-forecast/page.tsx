'use client'

import { useEffect, useState, useCallback } from 'react'
import SubPageHeader from '../../components/SubPageHeader'
import type { BacklogForecastResponse, HistoricalWeek, ProjectedWeek } from '../api/backlog-forecast/route'

type Mode = 'linear' | 'optimistic'

function fmtDate(d: string | null): string {
  if (!d) return '—'
  return new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function BurndownChart({
  historical,
  projected,
  totalProposals,
  mode,
}: {
  historical: HistoricalWeek[]
  projected: ProjectedWeek[]
  totalProposals: number
  mode: Mode
}) {
  const W = 600, H = 260, PAD_L = 50, PAD_B = 36, PAD_T = 16, PAD_R = 16

  const allWeeks = [
    ...historical.map((h) => ({ week: h.weekStart, remaining: h.remaining, type: 'actual' as const })),
    ...projected.map((p) => ({ week: p.weekStart, remaining: p.remaining, type: 'projected' as const })),
  ]

  if (allWeeks.length === 0) return null

  const minWeek = allWeeks[0]!.week
  const maxWeek = allWeeks[allWeeks.length - 1]!.week
  const weekCount = allWeeks.length

  function xFrac(weekStr: string): number {
    const total = Math.max(1, weekCount - 1)
    const idx = allWeeks.findIndex((w) => w.week === weekStr)
    return idx < 0 ? 0 : idx / total
  }

  function xPx(weekStr: string): number {
    return PAD_L + xFrac(weekStr) * (W - PAD_L - PAD_R)
  }

  function yPx(remaining: number): number {
    const frac = remaining / Math.max(1, totalProposals)
    return PAD_T + (1 - frac) * (H - PAD_T - PAD_B)
  }

  const actualPts = historical.map((h) => `${xPx(h.weekStart)},${yPx(h.remaining)}`).join(' ')
  const projPts = [
    historical.length > 0 ? `${xPx(historical[historical.length - 1]!.weekStart)},${yPx(historical[historical.length - 1]!.remaining)}` : '',
    ...projected.map((p) => `${xPx(p.weekStart)},${yPx(p.remaining)}`),
  ].filter(Boolean).join(' ')

  // Confidence band: ±20% of remaining at each projected step
  const bandTop = projected.map((p) => `${xPx(p.weekStart)},${yPx(Math.min(totalProposals, p.remaining * 1.2))}`).join(' ')
  const bandBot = projected.map((p) => `${xPx(p.weekStart)},${yPx(Math.max(0, p.remaining * 0.8))}`).join(' ').split(' ').reverse().join(' ')
  const bandPoly = projected.length > 0
    ? `${xPx(historical[historical.length - 1]?.weekStart ?? '')} ${yPx(historical[historical.length - 1]?.remaining ?? 0)} ${bandTop} ${bandBot}`
    : ''

  const yTicks = [0, 25, 50, 75, 100].map((pct) => Math.round((pct / 100) * totalProposals))

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 280 }}>
      <defs>
        <linearGradient id="bf-band" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#A855F7" stopOpacity="0.12" />
          <stop offset="100%" stopColor="#A855F7" stopOpacity="0.03" />
        </linearGradient>
      </defs>

      {/* Y-axis ticks */}
      {yTicks.map((val) => (
        <g key={val}>
          <line
            x1={PAD_L} y1={yPx(val)} x2={W - PAD_R} y2={yPx(val)}
            stroke="rgba(255,255,255,0.05)" strokeWidth={1}
          />
          <text x={PAD_L - 4} y={yPx(val) + 4} textAnchor="end"
            fill="#475569" fontSize="0.45rem" fontFamily="monospace">{val}</text>
        </g>
      ))}

      {/* X-axis label first/last */}
      <text x={PAD_L} y={H - 4} fill="#475569" fontSize="0.45rem" fontFamily="monospace">{minWeek.slice(0, 7)}</text>
      <text x={W - PAD_R} y={H - 4} textAnchor="end" fill="#475569" fontSize="0.45rem" fontFamily="monospace">{maxWeek.slice(0, 7)}</text>

      {/* Divider line between actual and projected */}
      {historical.length > 0 && projected.length > 0 && (
        <line
          x1={xPx(historical[historical.length - 1]!.weekStart)}
          y1={PAD_T}
          x2={xPx(historical[historical.length - 1]!.weekStart)}
          y2={H - PAD_B}
          stroke="rgba(255,255,255,0.1)" strokeWidth={1} strokeDasharray="3,3"
        />
      )}

      {/* Confidence band */}
      {bandPoly && projected.length > 0 && (
        <polygon points={bandPoly} fill="url(#bf-band)" />
      )}

      {/* Projected line */}
      {projPts && (
        <polyline
          points={projPts}
          fill="none"
          stroke="#A855F7"
          strokeWidth={1.5}
          strokeDasharray="5,3"
          opacity={0.8}
        />
      )}

      {/* Actual line */}
      {actualPts && (
        <polyline
          points={actualPts}
          fill="none"
          stroke="#22D3EE"
          strokeWidth={2}
        />
      )}

      {/* Zero line */}
      <line x1={PAD_L} y1={yPx(0)} x2={W - PAD_R} y2={yPx(0)}
        stroke="rgba(255,255,255,0.06)" strokeWidth={1} />
    </svg>
  )
}

export default function BacklogForecastPage() {
  const [data, setData] = useState<BacklogForecastResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [mode, setMode] = useState<Mode>('linear')

  const load = useCallback(() => {
    fetch('/api/backlog-forecast')
      .then((r) => r.json())
      .then((d: BacklogForecastResponse) => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  const doneDate = data
    ? (mode === 'linear' ? data.estimatedDoneDate : data.estimatedDoneDateOptimistic)
    : null
  const velocity = data
    ? (mode === 'linear' ? data.velocity4w : data.velocityOptimistic)
    : 0

  return (
    <div className="min-h-screen p-4 md:p-6" style={{ background: '#080f1c', color: '#E2E8F0' }}>
      <SubPageHeader title="Backlog Completion Forecast">
        <span className="text-[0.6rem] font-mono text-slate-500">
          Historical burndown + velocity projection
        </span>
      </SubPageHeader>

      {loading && (
        <div className="text-center py-20 text-slate-600 font-mono text-sm">Loading…</div>
      )}

      {!loading && data && (
        <div className="max-w-4xl mx-auto">
          {/* Header stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            {[
              { label: 'Total proposals', value: String(data.totalProposals), color: '#E2E8F0' },
              { label: 'Done', value: String(data.totalDone), color: '#10B981' },
              { label: 'Pending', value: String(data.totalPending), color: '#F59E0B' },
              {
                label: data.stalled ? 'Stalled' : `Est. done (${mode})`,
                value: data.stalled ? 'No velocity' : fmtDate(doneDate),
                color: data.stalled ? '#EF4444' : '#A855F7',
              },
            ].map(({ label, value, color }) => (
              <div
                key={label}
                className="rounded-lg border border-white/5 p-3 text-center"
                style={{ background: 'rgba(255,255,255,0.02)' }}
              >
                <div className="text-lg font-mono font-bold" style={{ color }}>{value}</div>
                <div className="text-[0.5rem] font-mono text-slate-600 mt-0.5">{label}</div>
              </div>
            ))}
          </div>

          {/* Mode toggle + velocity */}
          <div className="flex items-center gap-4 mb-4">
            {(['linear', 'optimistic'] as Mode[]).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className="text-[0.65rem] font-mono px-3 py-1 rounded border transition-colors"
                style={{
                  borderColor: mode === m ? '#A855F7' : 'rgba(255,255,255,0.1)',
                  color: mode === m ? '#A855F7' : '#64748B',
                  background: mode === m ? 'rgba(168,85,247,0.08)' : 'transparent',
                }}
              >
                {m === 'linear' ? `Linear (${data.velocity4w}/wk last 4w)` : `Optimistic (${data.velocityOptimistic}/wk p75)`}
              </button>
            ))}
          </div>

          {data.stalled && data.historical.length === 0 ? (
            <div className="text-center py-20 text-slate-600 font-mono text-sm">
              No done proposals with created dates found in BACKLOG.md
            </div>
          ) : (
            <div
              className="rounded-lg border border-white/5 p-4"
              style={{ background: 'rgba(255,255,255,0.02)' }}
            >
              <div className="text-[0.6rem] font-mono text-slate-500 uppercase tracking-wider mb-3">
                Remaining proposals over time
              </div>

              <BurndownChart
                historical={data.historical}
                projected={mode === 'linear' ? data.projected : (() => {
                  if (data.velocityOptimistic <= 0) return []
                  const result: ProjectedWeek[] = []
                  const lastHist = data.historical[data.historical.length - 1]
                  const todayWeek = lastHist?.weekStart ?? new Date().toISOString().slice(0, 10)
                  let rem = data.totalPending
                  for (let i = 0; i < 52 && rem > 0; i++) {
                    const d = new Date(todayWeek + 'T12:00:00Z')
                    d.setUTCDate(d.getUTCDate() + (i + 1) * 7)
                    const ws = d.toISOString().slice(0, 10)
                    rem = Math.max(0, rem - data.velocityOptimistic)
                    result.push({ weekStart: ws, remaining: rem })
                  }
                  return result
                })()}
                totalProposals={data.totalProposals}
                mode={mode}
              />

              {/* Legend */}
              <div className="flex items-center gap-4 mt-3 text-[0.55rem] font-mono">
                <div className="flex items-center gap-1.5">
                  <div className="w-6 h-0 border-t-2 border-cyan-400" />
                  <span className="text-slate-500">Actual (by created date)</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-6 h-0 border-t border-dashed border-purple-500" />
                  <span className="text-slate-500">Projected ({mode})</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-4 h-3 rounded-sm opacity-30" style={{ background: '#A855F7' }} />
                  <span className="text-slate-500">Confidence band (±20%)</span>
                </div>
              </div>
            </div>
          )}

          <div className="text-[0.55rem] font-mono text-slate-700 text-right mt-4">
            Generated {new Date(data.generatedAt).toLocaleString()}
          </div>
        </div>
      )}
    </div>
  )
}
