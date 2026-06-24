'use client'

import Link from 'next/link'
import { useState } from 'react'
import type { ImpactResponse, SeriesPoint, ShippedProposal } from '../api/impact/route'
import { useFreshness } from '../../lib/useFreshness'
import FreshnessBadge from '../../components/FreshnessBadge'

const W = 920
const H = 240
const PAD_L = 40
const PAD_R = 16
const PAD_T = 20
const PAD_B = 28

function deltaColor(d: number | null): string {
  if (d == null) return '#475569'
  if (d > 0.05) return '#34d399'
  if (d < -0.05) return '#ef4444'
  return '#94a3b8'
}

function deltaLabel(d: number | null): string {
  if (d == null) return 'n/a'
  const s = d > 0 ? '+' : ''
  return `${s}${d.toFixed(1)}`
}

function buildScale(convergence: SeriesPoint[], proposals: ShippedProposal[]) {
  // x domain spans the union of series dates and proposal ship dates.
  const dates = [...convergence.map((p) => p.date), ...proposals.map((p) => p.shipDate)].sort()
  const minDate = dates[0]
  const maxDate = dates[dates.length - 1]
  const t0 = new Date(`${minDate}T00:00:00Z`).getTime()
  const t1 = new Date(`${maxDate}T00:00:00Z`).getTime()
  const span = Math.max(1, t1 - t0)
  const x = (date: string) => {
    const t = new Date(`${date}T00:00:00Z`).getTime()
    return PAD_L + ((t - t0) / span) * (W - PAD_L - PAD_R)
  }
  // y is convergence score 0–100.
  const y = (score: number) => PAD_T + (1 - score / 100) * (H - PAD_T - PAD_B)
  return { x, y, minDate, maxDate }
}

export default function ImpactPage() {
  const { data, isStale, lastError, lastSuccessAt } = useFreshness<ImpactResponse>('/api/impact', 60_000)
  const [active, setActive] = useState<string | null>(null)
  const loading = data === null && lastError === null

  if (loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center" style={{ background: '#060d1a' }}>
        <div className="text-xs font-mono text-slate-600 animate-pulse">Loading proposal impact…</div>
      </div>
    )
  }

  const convergence = data?.convergence ?? []
  const proposals = data?.proposals ?? []
  const topMovers = data?.topMovers ?? []
  const slug = data?.slug ?? null
  const hasChart = convergence.length >= 2

  const scale = hasChart ? buildScale(convergence, proposals) : null
  const linePath = scale
    ? convergence.map((p, i) => `${i === 0 ? 'M' : 'L'}${scale.x(p.date).toFixed(1)},${scale.y(p.score).toFixed(1)}`).join(' ')
    : ''

  return (
    <div className="min-h-dvh flex flex-col" style={{ background: '#060d1a' }}>
      <header className="sticky top-0 z-30 border-b border-cyber-violet/12 bg-[#060d1a]/90 backdrop-blur-md px-6 py-3">
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-cyber-violet/40 to-transparent" />
        <div className="flex items-center gap-3 flex-wrap">
          <Link href="/" className="text-[0.6rem] font-mono text-slate-500 hover:text-cyber-violet transition-colors uppercase tracking-wider">← Dashboard</Link>
          <h1 className="text-sm font-black tracking-[0.18em]" style={{ fontFamily: 'Orbitron, JetBrains Mono, monospace', color: '#A78BFA' }}>
            Proposal Impact Trace
          </h1>
          <span className="text-[0.6rem] font-mono text-slate-500 border border-slate-700 px-2 py-0.5 rounded">
            {slug ? `${slug} · ` : ''}{data?.windowDays ?? 90}d · ±{data?.deltaWindowDays ?? 7}d delta
          </span>
          <FreshnessBadge isStale={isStale} lastError={lastError} lastSuccessAt={lastSuccessAt} />
          <div className="flex-1" />
          <div className="flex items-center gap-1.5">
            <span className="text-[0.55rem] font-mono text-slate-500 uppercase tracking-wider">shipped</span>
            <span className="text-lg font-black tabular-nums" style={{ fontFamily: 'Orbitron, monospace', color: '#A78BFA' }}>{proposals.length}</span>
          </div>
        </div>
      </header>

      <main className="flex-1 p-6 w-full flex gap-6 flex-wrap">
        <div className="flex-1 min-w-[480px]">
          {!hasChart ? (
            <div className="h-64 flex items-center justify-center text-slate-600 text-xs font-mono">
              {slug == null
                ? 'No convergence data tracked yet.'
                : 'Not enough convergence history to plot a trend (need ≥ 2 points).'}
            </div>
          ) : (
            <div className="rounded-lg border border-cyber-violet/10 bg-[#0a1424]/30 p-4">
              <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 280 }}>
                {/* y gridlines */}
                {[0, 25, 50, 75, 100].map((g) => (
                  <g key={g}>
                    <line x1={PAD_L} y1={scale!.y(g)} x2={W - PAD_R} y2={scale!.y(g)} stroke="#1e293b" strokeWidth={1} />
                    <text x={PAD_L - 6} y={scale!.y(g) + 3} textAnchor="end" fontSize={8} fill="#475569" fontFamily="monospace">{g}</text>
                  </g>
                ))}

                {/* proposal markers */}
                {proposals.map((p) => {
                  const px = scale!.x(p.shipDate)
                  const isActive = active === p.id
                  const col = deltaColor(p.delta)
                  return (
                    <g key={p.id} onMouseEnter={() => setActive(p.id)} style={{ cursor: 'pointer' }}>
                      <line x1={px} y1={PAD_T} x2={px} y2={H - PAD_B} stroke={col} strokeWidth={isActive ? 1.5 : 0.75} strokeDasharray="3 3" opacity={isActive ? 0.9 : 0.45} />
                      <circle cx={px} cy={PAD_T} r={isActive ? 4 : 3} fill={col} />
                      {isActive && (
                        <text x={px} y={PAD_T - 6} textAnchor="middle" fontSize={9} fill={col} fontFamily="monospace" fontWeight="bold">{p.id} {deltaLabel(p.delta)}</text>
                      )}
                    </g>
                  )
                })}

                {/* convergence line */}
                <path d={linePath} fill="none" stroke="#A78BFA" strokeWidth={1.75} />
                {convergence.map((p) => (
                  <circle key={p.date} cx={scale!.x(p.date)} cy={scale!.y(p.score)} r={1.5} fill="#A78BFA" />
                ))}

                {/* x axis labels */}
                <text x={PAD_L} y={H - 8} fontSize={8} fill="#475569" fontFamily="monospace">{scale!.minDate}</text>
                <text x={W - PAD_R} y={H - 8} textAnchor="end" fontSize={8} fill="#475569" fontFamily="monospace">{scale!.maxDate}</text>
              </svg>
              <p className="text-[0.55rem] font-mono text-slate-600 mt-1">
                Convergence trend for <span className="text-slate-400">{slug}</span> with dashed flags at each shipped proposal.
                Flag colour = before/after convergence delta (green up · red down). Hover a flag for its id and delta.
              </p>
            </div>
          )}
        </div>

        {/* side list ranked by |delta| */}
        <div className="w-72 shrink-0">
          <div className="text-[0.6rem] font-mono text-slate-500 uppercase tracking-wider mb-2">Top movers (|Δ| convergence)</div>
          {topMovers.length === 0 ? (
            <div className="text-[0.6rem] font-mono text-slate-600 py-4">No proposals with measurable convergence delta in window.</div>
          ) : (
            <div className="flex flex-col gap-1.5">
              {topMovers.map((p) => {
                const col = deltaColor(p.delta)
                return (
                  <div
                    key={p.id}
                    onMouseEnter={() => setActive(p.id)}
                    className="flex items-center gap-2 px-3 py-2 rounded border border-slate-800/60 bg-[#0a1424]/40 hover:bg-[#0a1424]/70 transition-colors cursor-pointer"
                    style={active === p.id ? { borderColor: `${col}80` } : undefined}
                  >
                    <span className="text-[0.6rem] font-mono font-bold text-slate-300 w-10 shrink-0">{p.id}</span>
                    <span className="flex-1 text-[0.6rem] text-slate-400 truncate" title={p.title}>{p.title}</span>
                    <span className="text-[0.65rem] font-mono font-bold tabular-nums shrink-0" style={{ color: col }}>{deltaLabel(p.delta)}</span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </main>

      <p className="text-[0.5rem] font-mono text-slate-700 px-6 pb-6 max-w-3xl">
        Links shipped proposals to their downstream effect on convergence. Parses done proposals from <code>BACKLOG.md</code>
        (created date as ship marker) and overlays them on the most-tracked project&apos;s convergence series. Each proposal
        shows the mean-score delta in the {data?.deltaWindowDays ?? 7} days after vs before it shipped; the side list ranks by
        absolute delta. Sparse/missing score data handled gracefully. Reuses <code>/api/impact</code>. Refreshes every 60s.
      </p>
    </div>
  )
}
