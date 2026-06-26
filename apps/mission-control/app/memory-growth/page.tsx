'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import SubPageHeader from '../../components/SubPageHeader'
import type { MemoryGrowthResponse, MemoryGrowthSeries } from '../api/memory-growth/route'

// Fixed project palette — 20 distinct hues cycling
const PALETTE = [
  '#22D3EE', '#A78BFA', '#F59E0B', '#34D399', '#F87171',
  '#60A5FA', '#FB923C', '#A3E635', '#E879F9', '#2DD4BF',
  '#FBBF24', '#818CF8', '#4ADE80', '#F472B6', '#38BDF8',
  '#C084FC', '#FCD34D', '#6EE7B7', '#FCA5A5', '#93C5FD',
]

function projectColor(index: number): string {
  return PALETTE[index % PALETTE.length]!
}

interface TooltipState {
  x: number
  dateIndex: number
  fleetTotal: number
  perProject: { slug: string; newCount: number; cumulative: number; color: string }[]
}

function StackedAreaChart({
  dates,
  series,
}: {
  dates: string[]
  series: MemoryGrowthSeries[]
}) {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)

  const W = 800
  const H = 260
  const PAD_L = 40
  const PAD_R = 16
  const PAD_T = 12
  const PAD_B = 24
  const chartW = W - PAD_L - PAD_R
  const chartH = H - PAD_T - PAD_B

  const n = dates.length

  // Compute cumulative stacks per day
  const cumulativeSeries = series.map((s) => {
    let cum = 0
    return s.dailyNew.map((v) => { cum += v; return cum })
  })

  // Stack from bottom: series[0] is bottom band
  const stackedTops: number[][] = [] // [seriesIdx][dayIdx] = top of this band
  for (let si = 0; si < series.length; si++) {
    const tops = cumulativeSeries[si]!
    if (si === 0) {
      stackedTops.push(tops)
    } else {
      stackedTops.push(tops.map((v, di) => v + (stackedTops[si - 1]![di] ?? 0)))
    }
  }

  const globalMax = stackedTops.length > 0
    ? Math.max(1, ...stackedTops[stackedTops.length - 1]!)
    : 1

  // Fleet total line = sum of all cumulative values per day
  const fleetLine = dates.map((_, di) =>
    cumulativeSeries.reduce((s, cum) => s + (cum[di] ?? 0), 0)
  )
  const fleetMax = Math.max(1, ...fleetLine)

  function xOf(di: number): number {
    return PAD_L + (di / Math.max(1, n - 1)) * chartW
  }
  function yOf(val: number): number {
    return PAD_T + chartH - (val / fleetMax) * chartH
  }

  // Build polygon points for each stacked band
  function bandPoints(si: number): string {
    const tops = stackedTops[si]!
    const bottoms = si === 0 ? Array(n).fill(0) : stackedTops[si - 1]!
    const top = tops.map((v, di) => `${xOf(di).toFixed(1)},${yOf(v).toFixed(1)}`).join(' ')
    const bot = bottoms.map((v, di) => `${xOf(di).toFixed(1)},${yOf(v).toFixed(1)}`).reverse().join(' ')
    return `${top} ${bot}`
  }

  // Fleet line points
  const fleetPts = fleetLine.map((v, di) => `${xOf(di).toFixed(1)},${yOf(v).toFixed(1)}`).join(' ')

  const handleMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return
    const mx = e.clientX - rect.left - PAD_L
    const di = Math.max(0, Math.min(n - 1, Math.round((mx / chartW) * (n - 1))))
    const perProject = series.map((s, si) => ({
      slug: s.slug,
      newCount: s.dailyNew[di] ?? 0,
      cumulative: cumulativeSeries[si]![di] ?? 0,
      color: projectColor(si),
    })).filter((p) => p.cumulative > 0)
    setTooltip({
      x: xOf(di),
      dateIndex: di,
      fleetTotal: fleetLine[di] ?? 0,
      perProject,
    })
  }, [series, cumulativeSeries, fleetLine, n, chartW])

  // Y-axis labels
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((t) => ({
    val: Math.round(t * fleetMax),
    y: yOf(t * fleetMax),
  }))

  // X-axis: show every 5th date label
  const xLabels = dates.map((d, i) => ({ d, i })).filter((_, i) => i % 5 === 0 || i === n - 1)

  return (
    <div className="relative overflow-x-auto">
      <svg
        ref={svgRef}
        width="100%"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        className="block"
        style={{ maxWidth: W }}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setTooltip(null)}
      >
        {/* Y-axis grid + labels */}
        {yTicks.map(({ val, y }) => (
          <g key={val}>
            <line x1={PAD_L} y1={y} x2={W - PAD_R} y2={y} stroke="rgba(255,255,255,0.04)" strokeWidth={0.5} />
            <text x={PAD_L - 4} y={y + 3} textAnchor="end" fill="#334155" fontSize="0.4rem" fontFamily="monospace">{val}</text>
          </g>
        ))}

        {/* Stacked area bands */}
        {series.map((s, si) => (
          <polygon
            key={s.slug}
            points={bandPoints(si)}
            fill={projectColor(si)}
            opacity={0.25}
          />
        ))}

        {/* Band borders (top edge of each band) */}
        {series.map((s, si) => {
          const tops = stackedTops[si]!
          const pts = tops.map((v, di) => `${xOf(di).toFixed(1)},${yOf(v).toFixed(1)}`).join(' ')
          return (
            <polyline
              key={`edge-${s.slug}`}
              points={pts}
              fill="none"
              stroke={projectColor(si)}
              strokeWidth={0.75}
              opacity={0.6}
            />
          )
        })}

        {/* Fleet total line */}
        <polyline
          points={fleetPts}
          fill="none"
          stroke="rgba(255,255,255,0.7)"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* X-axis labels */}
        {xLabels.map(({ d, i }) => (
          <text key={d} x={xOf(i)} y={H - 4} textAnchor="middle" fill="#334155" fontSize="0.38rem" fontFamily="monospace">
            {d.slice(5)}
          </text>
        ))}

        {/* Crosshair */}
        {tooltip && (
          <line
            x1={tooltip.x} y1={PAD_T}
            x2={tooltip.x} y2={H - PAD_B}
            stroke="rgba(255,255,255,0.25)"
            strokeWidth={1}
            strokeDasharray="3,3"
          />
        )}
      </svg>

      {/* Tooltip */}
      {tooltip && (
        <div
          className="fixed z-50 pointer-events-none rounded border border-white/10 px-2 py-1.5 text-[0.5rem] font-mono"
          style={{
            left: tooltip.x + 12,
            top: 80,
            background: 'rgba(8,15,28,0.95)',
            backdropFilter: 'blur(6px)',
            maxWidth: 200,
          }}
        >
          <div className="text-slate-400 mb-1">{dates[tooltip.dateIndex]}</div>
          <div className="text-white font-bold mb-1">Fleet: {tooltip.fleetTotal} cumulative</div>
          {tooltip.perProject.slice(0, 8).map((p) => (
            <div key={p.slug} className="flex items-center gap-1.5">
              <span className="inline-block w-2 h-2 rounded-sm shrink-0" style={{ background: p.color }} />
              <span className="text-slate-400 truncate flex-1">{p.slug}</span>
              <span style={{ color: p.color }}>{p.cumulative}</span>
            </div>
          ))}
          {tooltip.perProject.length > 8 && (
            <div className="text-slate-600 mt-0.5">+{tooltip.perProject.length - 8} more</div>
          )}
        </div>
      )}
    </div>
  )
}

export default function MemoryGrowthPage() {
  const [data, setData] = useState<MemoryGrowthResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/memory-growth')
      .then((r) => r.json())
      .then((d: MemoryGrowthResponse) => { setData(d); setLoading(false) })
      .catch((e) => { setError(String(e)); setLoading(false) })
  }, [])

  const { dates = [], series = [] } = data ?? {}

  return (
    <div className="min-h-screen p-4 md:p-6" style={{ background: '#080f1c', color: '#E2E8F0' }}>
      <SubPageHeader title="Fleet Memory Growth Timeline">
        <span className="text-[0.6rem] font-mono text-slate-500">
          Cumulative memory file growth by project · last 30 days
        </span>
      </SubPageHeader>

      {loading && <div className="text-center py-20 text-slate-600 font-mono text-sm">Loading…</div>}
      {error && <div className="text-center py-20 text-red-500 font-mono text-sm">{error}</div>}

      {!loading && !error && (
        <div className="max-w-5xl mx-auto">
          {series.length === 0 ? (
            <div className="text-center py-20 text-slate-600 font-mono text-sm">
              No new memory files found in git history for the last 30 days
            </div>
          ) : (
            <>
              <div
                className="rounded-lg border border-white/5 p-4 mb-5"
                style={{ background: 'rgba(255,255,255,0.02)' }}
              >
                <div className="text-[0.5rem] font-mono text-slate-600 uppercase tracking-wider mb-3">
                  Stacked cumulative · white line = fleet total · hover for crosshair detail
                </div>
                <StackedAreaChart dates={dates} series={series} />
              </div>

              {/* Legend */}
              <div
                className="rounded-lg border border-white/5 p-3"
                style={{ background: 'rgba(255,255,255,0.02)' }}
              >
                <div className="text-[0.5rem] font-mono text-slate-600 uppercase tracking-wider mb-2">
                  Projects ({series.length})
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                  {series.map((s, si) => {
                    const total = s.dailyNew.reduce((a, v) => a + v, 0)
                    return (
                      <div key={s.slug} className="flex items-center gap-1.5">
                        <span
                          className="inline-block w-3 h-3 rounded-sm shrink-0"
                          style={{ background: projectColor(si), opacity: 0.8 }}
                        />
                        <span className="text-[0.48rem] font-mono text-slate-400">{s.slug}</span>
                        <span className="text-[0.45rem] font-mono text-slate-600">+{total}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            </>
          )}

          {data && (
            <div className="text-[0.5rem] font-mono text-slate-700 text-right mt-3">
              Generated {new Date(data.generatedAt).toLocaleString()}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
