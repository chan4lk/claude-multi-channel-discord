'use client'

import { useEffect, useState } from 'react'
import SubPageHeader from '../../components/SubPageHeader'
import type { InactivityHeatmapResponse, InactivityProject } from '../api/inactivity-heatmap/route'

function cellColor(count: number, max: number): string {
  if (count === 0 || max === 0) return 'rgba(255,255,255,0.03)'
  const t = Math.pow(count / max, 0.5)
  const r = Math.round(8 + t * (34 - 8))
  const g = Math.round(15 + t * (211 - 15))
  const b = Math.round(28 + t * (238 - 28))
  return `rgb(${r},${g},${b})`
}

interface TooltipState { project: string; date: string; count: number; x: number; y: number }

function CalendarStrip({
  projects,
  dates,
}: {
  projects: InactivityProject[]
  dates: string[]
}) {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null)

  const CELL_W = 10
  const CELL_H = 16
  const LABEL_W = 84
  const INACTIVE_W = 28
  const HEADER_H = 20
  const n = dates.length

  const globalMax = Math.max(1, ...projects.flatMap((p) => p.dailyTurns.map((d) => d.count)))

  const svgW = LABEL_W + n * CELL_W + INACTIVE_W
  const svgH = HEADER_H + projects.length * CELL_H + 4

  // X-axis: label every 10 days
  const xLabels = dates.map((d, i) => ({ d, i })).filter((_, i) => i % 10 === 0 || i === n - 1)

  return (
    <div className="relative overflow-x-auto">
      <svg width={svgW} height={svgH} className="block" style={{ minWidth: svgW }}>
        {/* Date header labels */}
        {xLabels.map(({ d, i }) => (
          <text key={d} x={LABEL_W + i * CELL_W + CELL_W / 2} y={HEADER_H - 4}
            textAnchor="middle" fill="#334155" fontSize="0.38rem" fontFamily="monospace">
            {d.slice(5)}
          </text>
        ))}

        {/* Project rows */}
        {projects.map((p, pi) => {
          const y = HEADER_H + pi * CELL_H
          return (
            <g key={p.slug}>
              {/* Slug label */}
              <text x={LABEL_W - 4} y={y + CELL_H / 2 + 4}
                textAnchor="end" fill={p.totalTurns === 0 ? '#1E293B' : '#64748B'}
                fontSize="0.44rem" fontFamily="monospace">
                {p.slug.length > 13 ? p.slug.slice(0, 12) + '…' : p.slug}
              </text>

              {/* Day cells */}
              {p.dailyTurns.map((dt, di) => (
                <rect key={dt.date}
                  x={LABEL_W + di * CELL_W} y={y}
                  width={CELL_W - 1} height={CELL_H - 1}
                  fill={cellColor(dt.count, globalMax)}
                  rx={1}
                  style={{ cursor: dt.count > 0 ? 'pointer' : 'default' }}
                  onMouseEnter={(e) => {
                    const r = (e.target as SVGRectElement).getBoundingClientRect()
                    setTooltip({ project: p.slug, date: dt.date, count: dt.count, x: r.left + CELL_W / 2, y: r.top })
                  }}
                  onMouseLeave={() => setTooltip(null)}
                />
              ))}

              {/* Inactive day count */}
              <text x={LABEL_W + n * CELL_W + INACTIVE_W - 2} y={y + CELL_H / 2 + 4}
                textAnchor="end" fill="#475569" fontSize="0.4rem" fontFamily="monospace">
                {p.inactiveDays}d
              </text>
            </g>
          )
        })}
      </svg>

      {tooltip && (
        <div className="fixed z-50 pointer-events-none rounded border border-white/10 px-2 py-1 text-[0.52rem] font-mono"
          style={{ left: tooltip.x, top: tooltip.y - 40, background: 'rgba(8,15,28,0.95)', backdropFilter: 'blur(6px)', transform: 'translateX(-50%)' }}>
          <span className="text-slate-300">{tooltip.project}</span>
          <span className="text-slate-600 mx-1">·</span>
          <span className="text-slate-400">{tooltip.date}</span>
          {tooltip.count > 0
            ? <span className="text-cyan-400 ml-2">{tooltip.count} turn{tooltip.count !== 1 ? 's' : ''}</span>
            : <span className="text-slate-600 ml-2">inactive</span>}
        </div>
      )}
    </div>
  )
}

export default function InactivityHeatmapPage() {
  const [data, setData] = useState<InactivityHeatmapResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/inactivity-heatmap')
      .then((r) => r.json())
      .then((d: InactivityHeatmapResponse) => { setData(d); setLoading(false) })
      .catch((e) => { setError(String(e)); setLoading(false) })
  }, [])

  const projects = data?.projects ?? []

  return (
    <div className="min-h-screen p-4 md:p-6" style={{ background: '#080f1c', color: '#E2E8F0' }}>
      <SubPageHeader title="Project Inactivity Heatmap">
        <span className="text-[0.6rem] font-mono text-slate-500">
          Per-project turn activity over last 60 days · sorted by inactive days desc
        </span>
      </SubPageHeader>

      {loading && <div className="text-center py-20 text-slate-600 font-mono text-sm">Loading…</div>}
      {error && <div className="text-center py-20 text-red-500 font-mono text-sm">{error}</div>}

      {!loading && !error && (
        <div className="max-w-6xl mx-auto">
          {projects.length === 0 ? (
            <div className="text-center py-20 text-slate-600 font-mono text-sm">No project data found</div>
          ) : (
            <>
              <div className="flex items-center gap-4 mb-4 text-[0.55rem] font-mono text-slate-500">
                <span>{projects.length} projects · right column = inactive day count</span>
                <span className="flex items-center gap-1.5">
                  <span className="inline-block w-3 h-3 rounded-sm" style={{ background: 'rgba(34,211,238,0.8)' }} />
                  Active (cyan intensity = turn count)
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="inline-block w-3 h-3 rounded-sm" style={{ background: 'rgba(255,255,255,0.03)' }} />
                  Inactive
                </span>
              </div>

              <div className="rounded-lg border border-white/5 p-4 overflow-x-auto"
                style={{ background: 'rgba(255,255,255,0.02)' }}>
                <CalendarStrip projects={projects} dates={data?.dates ?? []} />
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
