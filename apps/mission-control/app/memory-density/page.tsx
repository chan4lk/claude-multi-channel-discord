'use client'

import { useEffect, useState } from 'react'
import SubPageHeader from '../../components/SubPageHeader'
import type { MemoryDensityResponse, MemoryDensityProject } from '../api/memory-density/route'

const HOURS = Array.from({ length: 24 }, (_, i) => i)

function cellColor(count: number, max: number): string {
  if (count === 0 || max === 0) return 'rgba(255,255,255,0.03)'
  const t = Math.pow(count / max, 0.6)
  const r = Math.round(8 + t * (34 - 8))
  const g = Math.round(15 + t * (211 - 15))
  const b = Math.round(28 + t * (238 - 28))
  return `rgb(${r},${g},${b})`
}

interface TooltipState {
  slug: string
  hour: number
  count: number
  x: number
  y: number
}

function HeatGrid({ projects }: { projects: MemoryDensityProject[] }) {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null)

  const allCounts = projects.flatMap((p) => p.hourCounts)
  const globalMax = Math.max(1, ...allCounts)

  const colTotals = HOURS.map((h) => projects.reduce((s, p) => s + (p.hourCounts[h] ?? 0), 0))
  const colMax = Math.max(1, ...colTotals)

  const CELL_W = 24
  const CELL_H = 18
  const LABEL_W = 80   // project slug label
  const TOTAL_W = 36   // row total bar
  const HOUR_LABEL_H = 18
  const COL_BAR_H = 24

  const svgW = LABEL_W + 24 * CELL_W + TOTAL_W
  const svgH = HOUR_LABEL_H + projects.length * CELL_H + COL_BAR_H + 6

  return (
    <div className="relative overflow-x-auto">
      <svg width={svgW} height={svgH} className="block" style={{ minWidth: svgW }}>
        {/* Hour labels */}
        {HOURS.map((h) =>
          h % 3 === 0 ? (
            <text
              key={h}
              x={LABEL_W + h * CELL_W + CELL_W / 2}
              y={HOUR_LABEL_H - 3}
              textAnchor="middle"
              fill="#475569"
              fontSize="0.45rem"
              fontFamily="monospace"
            >
              {String(h).padStart(2, '0')}
            </text>
          ) : null
        )}

        {/* Project rows */}
        {projects.map((p, pi) => {
          const y = HOUR_LABEL_H + pi * CELL_H
          const rowTotal = p.total
          return (
            <g key={p.slug}>
              {/* Slug label */}
              <text
                x={LABEL_W - 4}
                y={y + CELL_H / 2 + 4}
                textAnchor="end"
                fill={rowTotal === 0 ? '#334155' : '#64748B'}
                fontSize="0.48rem"
                fontFamily="monospace"
              >
                {p.slug.length > 14 ? p.slug.slice(0, 13) + '…' : p.slug}
              </text>

              {/* Hour cells */}
              {HOURS.map((h) => {
                const count = p.hourCounts[h] ?? 0
                return (
                  <rect
                    key={h}
                    x={LABEL_W + h * CELL_W}
                    y={y}
                    width={CELL_W - 1}
                    height={CELL_H - 1}
                    fill={cellColor(count, globalMax)}
                    rx={2}
                    style={{ cursor: count > 0 ? 'pointer' : 'default' }}
                    onMouseEnter={(e) => {
                      const r = (e.target as SVGRectElement).getBoundingClientRect()
                      setTooltip({ slug: p.slug, hour: h, count, x: r.left + CELL_W / 2, y: r.top })
                    }}
                    onMouseLeave={() => setTooltip(null)}
                  />
                )
              })}

              {/* Row total bar */}
              <rect
                x={LABEL_W + 24 * CELL_W + 4}
                y={y + 3}
                width={Math.max(0, (rowTotal / Math.max(1, projects[0]?.total ?? 1)) * (TOTAL_W - 8))}
                height={CELL_H - 7}
                fill="rgba(34,211,238,0.5)"
                rx={1}
              />
              <text
                x={LABEL_W + 24 * CELL_W + TOTAL_W - 2}
                y={y + CELL_H / 2 + 4}
                textAnchor="end"
                fill="#64748B"
                fontSize="0.42rem"
                fontFamily="monospace"
              >
                {rowTotal}
              </text>
            </g>
          )
        })}

        {/* Column total bars (bottom) */}
        {HOURS.map((h) => {
          const v = colTotals[h] ?? 0
          const barH = v > 0 ? Math.max(3, (v / colMax) * (COL_BAR_H - 4)) : 0
          const y0 = HOUR_LABEL_H + projects.length * CELL_H + 4
          return (
            <rect
              key={h}
              x={LABEL_W + h * CELL_W}
              y={y0 + (COL_BAR_H - 4 - barH)}
              width={CELL_W - 1}
              height={barH}
              fill="rgba(34,211,238,0.35)"
              rx={1}
            />
          )
        })}
      </svg>

      {/* Tooltip */}
      {tooltip && (
        <div
          className="fixed z-50 pointer-events-none rounded border border-white/10 px-2 py-1 text-[0.55rem] font-mono"
          style={{
            left: tooltip.x,
            top: tooltip.y - 38,
            background: 'rgba(8,15,28,0.95)',
            backdropFilter: 'blur(6px)',
            transform: 'translateX(-50%)',
          }}
        >
          <span className="text-slate-300">{tooltip.slug}</span>
          <span className="text-slate-500 mx-1">·</span>
          <span className="text-slate-400">
            {String(tooltip.hour).padStart(2, '0')}:00–{String(tooltip.hour + 1).padStart(2, '0')}:00
          </span>
          <span className="text-cyan-400 ml-2">
            {tooltip.count} write{tooltip.count !== 1 ? 's' : ''}
          </span>
        </div>
      )}
    </div>
  )
}

function ColorLegend({ max }: { max: number }) {
  return (
    <div className="flex items-center gap-2 mt-4">
      <span className="text-[0.5rem] font-mono text-slate-600">0</span>
      <div className="flex h-2 w-28 rounded overflow-hidden">
        {Array.from({ length: 14 }, (_, i) => (
          <div key={i} className="flex-1" style={{ background: cellColor(i + 1, 14) }} />
        ))}
      </div>
      <span className="text-[0.5rem] font-mono text-slate-600">max ({max})</span>
    </div>
  )
}

export default function MemoryDensityPage() {
  const [data, setData] = useState<MemoryDensityResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/memory-density')
      .then((r) => r.json())
      .then((d: MemoryDensityResponse) => { setData(d); setLoading(false) })
      .catch((e) => { setError(String(e)); setLoading(false) })
  }, [])

  const projects = data?.projects ?? []
  const globalMax = Math.max(1, ...projects.flatMap((p) => p.hourCounts))
  const colTotals = HOURS.map((h) => projects.reduce((s, p) => s + (p.hourCounts[h] ?? 0), 0))
  const peakHour = colTotals.indexOf(Math.max(...colTotals))

  return (
    <div className="min-h-screen p-4 md:p-6" style={{ background: '#080f1c', color: '#E2E8F0' }}>
      <SubPageHeader title="Memory Density Heatmap">
        <span className="text-[0.6rem] font-mono text-slate-500">
          Memory write frequency by project × hour-of-day · last 7 days
        </span>
      </SubPageHeader>

      {loading && (
        <div className="text-center py-20 text-slate-600 font-mono text-sm">Loading…</div>
      )}

      {error && (
        <div className="text-center py-20 text-red-500 font-mono text-sm">{error}</div>
      )}

      {!loading && !error && (
        <div className="max-w-6xl mx-auto">
          {projects.length === 0 ? (
            <div className="text-center py-20 text-slate-600 font-mono text-sm">
              No memory git history found for any project
            </div>
          ) : (
            <>
              {/* Peak hour callout */}
              <div className="flex items-center gap-4 mb-5 text-[0.6rem] font-mono text-slate-500">
                <span>
                  Peak hour:{' '}
                  <span className="text-cyan-400">
                    {String(peakHour).padStart(2, '0')}:00–{String(peakHour + 1).padStart(2, '0')}:00 UTC
                  </span>
                </span>
                <span>
                  Projects shown: <span className="text-slate-300">{projects.length}</span>
                  {projects.length === 30 && (
                    <span className="text-slate-600"> (top 30 by total)</span>
                  )}
                </span>
              </div>

              <div
                className="rounded-lg border border-white/5 p-4 overflow-x-auto"
                style={{ background: 'rgba(255,255,255,0.02)' }}
              >
                <div className="text-[0.55rem] font-mono text-slate-600 uppercase tracking-wider mb-3">
                  Projects (rows) × Hour UTC (cols) · right bar = row total · bottom bar = column total
                </div>
                <HeatGrid projects={projects} />
                <ColorLegend max={globalMax} />
              </div>
            </>
          )}

          {data && (
            <div className="text-[0.5rem] font-mono text-slate-700 text-right mt-3">
              Generated {new Date(data.generatedAt).toLocaleString()} UTC
            </div>
          )}
        </div>
      )}
    </div>
  )
}
