'use client'

import { useEffect, useState } from 'react'
import SubPageHeader from '../../components/SubPageHeader'
import type { ToolHeatmapResponse } from '../api/tool-heatmap/route'

function cellColor(count: number, max: number): string {
  if (count === 0 || max === 0) return 'rgba(255,255,255,0.03)'
  const t = Math.pow(count / max, 0.55)
  const r = Math.round(8 + t * (34 - 8))
  const g = Math.round(15 + t * (211 - 15))
  const b = Math.round(28 + t * (238 - 28))
  return `rgb(${r},${g},${b})`
}

interface TooltipState { project: string; tool: string; count: number; x: number; y: number }

function HeatMatrix({ data }: { data: ToolHeatmapResponse }) {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null)
  const { projects, tools, matrix, rowTotals, colTotals } = data

  const globalMax = Math.max(1, ...matrix.flatMap((r) => r))
  const colMax = Math.max(1, ...colTotals)
  const rowMax = Math.max(1, ...rowTotals)

  const CELL_W = 18
  const CELL_H = 16
  const LABEL_W = 90
  const TOTAL_W = 36
  const HEADER_H = 60
  const COL_BAR_H = 20

  const svgW = LABEL_W + tools.length * CELL_W + TOTAL_W
  const svgH = HEADER_H + projects.length * CELL_H + COL_BAR_H + 4

  return (
    <div className="relative overflow-x-auto">
      <svg width={svgW} height={svgH} className="block" style={{ minWidth: svgW }}>
        {/* Tool header labels — rotated */}
        {tools.map((tool, ti) => {
          const label = tool.replace(/^mcp__[^_]+__/, '').replace(/_/g, ' ')
          return (
            <text
              key={tool}
              x={LABEL_W + ti * CELL_W + CELL_W / 2}
              y={HEADER_H - 4}
              transform={`rotate(-55, ${LABEL_W + ti * CELL_W + CELL_W / 2}, ${HEADER_H - 4})`}
              textAnchor="end"
              fill="#475569"
              fontSize="0.4rem"
              fontFamily="monospace"
            >
              {label.length > 16 ? label.slice(0, 15) + '…' : label}
            </text>
          )
        })}

        {/* Project rows */}
        {projects.map((slug, pi) => {
          const y = HEADER_H + pi * CELL_H
          const rowTotal = rowTotals[pi] ?? 0
          return (
            <g key={slug}>
              <text
                x={LABEL_W - 4}
                y={y + CELL_H / 2 + 4}
                textAnchor="end"
                fill={rowTotal === 0 ? '#334155' : '#64748B'}
                fontSize="0.45rem"
                fontFamily="monospace"
              >
                {slug.length > 14 ? slug.slice(0, 13) + '…' : slug}
              </text>
              {tools.map((tool, ti) => {
                const count = matrix[pi]?.[ti] ?? 0
                return (
                  <rect
                    key={tool}
                    x={LABEL_W + ti * CELL_W}
                    y={y}
                    width={CELL_W - 1}
                    height={CELL_H - 1}
                    fill={cellColor(count, globalMax)}
                    rx={1}
                    style={{ cursor: count > 0 ? 'pointer' : 'default' }}
                    onMouseEnter={(e) => {
                      const r = (e.target as SVGRectElement).getBoundingClientRect()
                      setTooltip({ project: slug, tool, count, x: r.left + CELL_W / 2, y: r.top })
                    }}
                    onMouseLeave={() => setTooltip(null)}
                  />
                )
              })}
              {/* Row total bar */}
              <rect
                x={LABEL_W + tools.length * CELL_W + 4}
                y={y + 3}
                width={Math.max(0, (rowTotal / rowMax) * (TOTAL_W - 8))}
                height={CELL_H - 7}
                fill="rgba(34,211,238,0.4)"
                rx={1}
              />
              <text
                x={LABEL_W + tools.length * CELL_W + TOTAL_W - 2}
                y={y + CELL_H / 2 + 4}
                textAnchor="end"
                fill="#475569"
                fontSize="0.38rem"
                fontFamily="monospace"
              >
                {rowTotal}
              </text>
            </g>
          )
        })}

        {/* Column total bars */}
        {tools.map((tool, ti) => {
          const v = colTotals[ti] ?? 0
          const barH = v > 0 ? Math.max(3, (v / colMax) * (COL_BAR_H - 4)) : 0
          const y0 = HEADER_H + projects.length * CELL_H + 2
          return (
            <rect
              key={tool}
              x={LABEL_W + ti * CELL_W}
              y={y0 + (COL_BAR_H - 4 - barH)}
              width={CELL_W - 1}
              height={barH}
              fill="rgba(34,211,238,0.3)"
              rx={1}
            />
          )
        })}
      </svg>

      {tooltip && (
        <div
          className="fixed z-50 pointer-events-none rounded border border-white/10 px-2 py-1 text-[0.52rem] font-mono"
          style={{
            left: tooltip.x,
            top: tooltip.y - 42,
            background: 'rgba(8,15,28,0.95)',
            backdropFilter: 'blur(6px)',
            transform: 'translateX(-50%)',
          }}
        >
          <span className="text-slate-300">{tooltip.project}</span>
          <span className="text-slate-600 mx-1">·</span>
          <span className="text-slate-400">{tooltip.tool}</span>
          <span className="text-cyan-400 ml-2">{tooltip.count}</span>
        </div>
      )}
    </div>
  )
}

export default function ToolHeatmapPage() {
  const [data, setData] = useState<ToolHeatmapResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/tool-heatmap?days=30')
      .then((r) => r.json())
      .then((d: ToolHeatmapResponse) => { setData(d); setLoading(false) })
      .catch((e) => { setError(String(e)); setLoading(false) })
  }, [])

  return (
    <div className="min-h-screen p-4 md:p-6" style={{ background: '#080f1c', color: '#E2E8F0' }}>
      <SubPageHeader title="Cross-Project Tool Usage Heatmap">
        <span className="text-[0.6rem] font-mono text-slate-500">
          Tool call frequency by project × tool · last 30 days
        </span>
      </SubPageHeader>

      {loading && <div className="text-center py-20 text-slate-600 font-mono text-sm">Loading…</div>}
      {error && <div className="text-center py-20 text-red-500 font-mono text-sm">{error}</div>}

      {!loading && !error && data && (
        <div className="max-w-full mx-auto">
          {data.projects.length === 0 ? (
            <div className="text-center py-20 text-slate-600 font-mono text-sm">
              No tool call data found in transcripts
            </div>
          ) : (
            <>
              <div className="flex items-center gap-4 mb-4 text-[0.55rem] font-mono text-slate-500">
                <span>
                  <span className="text-slate-300">{data.projects.length}</span> projects ×{' '}
                  <span className="text-slate-300">{data.tools.length}</span> tools
                </span>
                <span>right bar = project total · bottom bar = tool fleet total</span>
              </div>
              <div
                className="rounded-lg border border-white/5 p-4 overflow-x-auto"
                style={{ background: 'rgba(255,255,255,0.02)' }}
              >
                <HeatMatrix data={data} />
                {/* Color scale */}
                <div className="flex items-center gap-2 mt-4">
                  <span className="text-[0.45rem] font-mono text-slate-600">0</span>
                  <div className="flex h-2 w-24 rounded overflow-hidden">
                    {Array.from({ length: 12 }, (_, i) => (
                      <div key={i} className="flex-1" style={{ background: cellColor(i + 1, 12) }} />
                    ))}
                  </div>
                  <span className="text-[0.45rem] font-mono text-slate-600">max</span>
                </div>
              </div>
            </>
          )}

          <div className="text-[0.5rem] font-mono text-slate-700 text-right mt-3">
            Generated {new Date(data.generatedAt).toLocaleString()}
          </div>
        </div>
      )}
    </div>
  )
}
