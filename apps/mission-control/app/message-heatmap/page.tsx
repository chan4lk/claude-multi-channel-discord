'use client'

import { useEffect, useState, useCallback } from 'react'
import SubPageHeader from '../../components/SubPageHeader'
import type { MessageHeatmapResponse, HeatGrid } from '../api/message-heatmap/route'

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const HOURS = Array.from({ length: 24 }, (_, i) => i)

function cellBg(count: number, max: number): string {
  if (count === 0 || max === 0) return 'rgba(255,255,255,0.03)'
  const t = Math.pow(count / max, 0.6)
  // Cyan gradient: dark → bright
  const r = Math.round(8 + t * (34 - 8))
  const g = Math.round(15 + t * (211 - 15))
  const b = Math.round(28 + t * (238 - 28))
  return `rgb(${r},${g},${b})`
}

function gridMax(grid: HeatGrid): number {
  return Math.max(1, ...grid.flatMap((r) => r))
}

interface TooltipState {
  day: number
  hour: number
  count: number
  x: number
  y: number
}

function HeatGrid({ grid, peakDay, peakHour }: { grid: HeatGrid; peakDay: number; peakHour: number }) {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null)
  const max = gridMax(grid)

  const CELL_W = 22, CELL_H = 22, LABEL_W = 30, LABEL_H = 18

  const W = LABEL_W + 24 * CELL_W
  const H = LABEL_H + 7 * CELL_H

  return (
    <div className="relative overflow-x-auto">
      <svg width={W} height={H} className="block" style={{ minWidth: W }}>
        {/* Hour labels */}
        {HOURS.map((h) => (
          (h % 3 === 0) && (
            <text
              key={h}
              x={LABEL_W + h * CELL_W + CELL_W / 2}
              y={LABEL_H - 3}
              textAnchor="middle"
              fill="#475569"
              fontSize="0.45rem"
              fontFamily="monospace"
            >
              {String(h).padStart(2, '0')}
            </text>
          )
        ))}

        {/* Day rows */}
        {DAYS.map((day, di) => (
          <g key={day}>
            <text
              x={LABEL_W - 4}
              y={LABEL_H + di * CELL_H + CELL_H / 2 + 4}
              textAnchor="end"
              fill="#64748B"
              fontSize="0.5rem"
              fontFamily="monospace"
            >
              {day}
            </text>

            {HOURS.map((h) => {
              const count = grid[di]?.[h] ?? 0
              const isPeak = di === peakDay && h === peakHour && count > 0
              return (
                <rect
                  key={h}
                  x={LABEL_W + h * CELL_W}
                  y={LABEL_H + di * CELL_H}
                  width={CELL_W - 1}
                  height={CELL_H - 1}
                  fill={cellBg(count, max)}
                  stroke={isPeak ? '#F59E0B' : 'rgba(255,255,255,0.03)'}
                  strokeWidth={isPeak ? 1.5 : 0.5}
                  rx={2}
                  style={{ cursor: count > 0 ? 'pointer' : 'default' }}
                  onMouseEnter={(e) => {
                    const rect = (e.target as SVGRectElement).getBoundingClientRect()
                    setTooltip({ day: di, hour: h, count, x: rect.left + CELL_W / 2, y: rect.top })
                  }}
                  onMouseLeave={() => setTooltip(null)}
                />
              )
            })}
          </g>
        ))}
      </svg>

      {/* Tooltip */}
      {tooltip && (
        <div
          className="fixed z-50 pointer-events-none rounded border border-white/10 px-2 py-1 text-[0.55rem] font-mono"
          style={{
            left: tooltip.x - 60,
            top: tooltip.y - 36,
            background: 'rgba(8,15,28,0.95)',
            backdropFilter: 'blur(6px)',
            transform: 'translateX(-50%)',
          }}
        >
          <span className="text-slate-300">{DAYS[tooltip.day]} {String(tooltip.hour).padStart(2,'0')}:00–{String(tooltip.hour+1).padStart(2,'0')}:00</span>
          <span className="text-cyan-400 ml-2">{tooltip.count} msg{tooltip.count !== 1 ? 's' : ''}</span>
        </div>
      )}
    </div>
  )
}

function HourBar({ grid }: { grid: HeatGrid }) {
  const byHour = HOURS.map((h) => grid.reduce((s, row) => s + (row[h] ?? 0), 0))
  const max = Math.max(1, ...byHour)
  return (
    <div className="flex items-end gap-px h-10">
      {byHour.map((v, h) => (
        <div
          key={h}
          className="flex-1 rounded-t-sm"
          style={{
            height: `${Math.max(2, (v / max) * 40)}px`,
            background: v > 0 ? `rgba(34,211,238,${0.3 + 0.7 * (v / max)})` : 'rgba(255,255,255,0.04)',
          }}
          title={`${String(h).padStart(2,'0')}:00 — ${v}`}
        />
      ))}
    </div>
  )
}

function DayBar({ grid }: { grid: HeatGrid }) {
  const byDay = DAYS.map((_, d) => (grid[d] ?? []).reduce((s, v) => s + v, 0))
  const max = Math.max(1, ...byDay)
  return (
    <div className="flex flex-col gap-px">
      {byDay.map((v, d) => (
        <div key={d} className="flex items-center gap-2">
          <span className="text-[0.5rem] font-mono text-slate-600 w-6">{DAYS[d]}</span>
          <div className="flex-1 h-2 rounded-full bg-slate-800 overflow-hidden">
            <div
              className="h-full rounded-full"
              style={{
                width: `${v > 0 ? Math.max(4, (v / max) * 100) : 0}%`,
                background: '#22D3EE',
                opacity: 0.3 + 0.7 * (v / max),
              }}
            />
          </div>
          <span className="text-[0.5rem] font-mono text-slate-600 w-6 text-right">{v}</span>
        </div>
      ))}
    </div>
  )
}

export default function MessageHeatmapPage() {
  const [data, setData] = useState<MessageHeatmapResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null)
  const [windowDays, setWindowDays] = useState(30)

  const load = useCallback(() => {
    const params = new URLSearchParams({ days: String(windowDays) })
    if (selectedSlug) params.set('slug', selectedSlug)
    fetch(`/api/message-heatmap?${params}`)
      .then((r) => r.json())
      .then((d: MessageHeatmapResponse) => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [windowDays, selectedSlug])

  useEffect(() => { setLoading(true); load() }, [load])

  const grid = data?.grid ?? Array.from({ length: 7 }, () => Array(24).fill(0))
  const peakDay = data?.peakDay ?? 0
  const peakHour = data?.peakHour ?? 0

  return (
    <div className="min-h-screen p-4 md:p-6" style={{ background: '#080f1c', color: '#E2E8F0' }}>
      <SubPageHeader title="Message Volume Heatmap">
        <span className="text-[0.6rem] font-mono text-slate-500">
          Operator engagement by hour-of-day × day-of-week
        </span>
      </SubPageHeader>

      {loading && (
        <div className="text-center py-20 text-slate-600 font-mono text-sm">Loading…</div>
      )}

      {!loading && data && (
        <div className="max-w-5xl mx-auto">
          {/* Controls */}
          <div className="flex flex-wrap items-center gap-3 mb-5">
            {[7, 14, 30, 60].map((d) => (
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
              value={selectedSlug ?? ''}
              onChange={(e) => setSelectedSlug(e.target.value || null)}
              className="text-[0.65rem] font-mono px-2 py-1 rounded border border-white/10"
              style={{ background: '#0d1b2e', color: '#E2E8F0' }}
            >
              <option value="">Fleet aggregate</option>
              {data.slugs.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          {data.totalMessages === 0 ? (
            <div className="text-center py-20 text-slate-600 font-mono text-sm">
              No inbound messages found in transcripts for this window
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_200px] gap-6">
              {/* Main heatmap */}
              <div
                className="rounded-lg border border-white/5 p-4"
                style={{ background: 'rgba(255,255,255,0.02)' }}
              >
                <div className="text-[0.6rem] font-mono text-slate-500 uppercase tracking-wider mb-1">
                  {selectedSlug ?? 'Fleet'} — messages by hour (UTC)
                </div>
                <div className="text-[0.55rem] font-mono text-slate-700 mb-3">
                  Peak: {DAYS[peakDay]} {String(peakHour).padStart(2,'0')}:00 UTC
                  · {data.totalMessages.toLocaleString()} total
                </div>

                <HeatGrid grid={grid} peakDay={peakDay} peakHour={peakHour} />

                {/* Hour distribution */}
                <div className="mt-4">
                  <div className="text-[0.5rem] font-mono text-slate-600 mb-1">By hour</div>
                  <HourBar grid={grid} />
                  <div className="flex justify-between text-[0.4rem] font-mono text-slate-700 mt-0.5">
                    <span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>23:00</span>
                  </div>
                </div>

                {/* Color scale */}
                <div className="flex items-center gap-2 mt-3">
                  <span className="text-[0.5rem] font-mono text-slate-600">0</span>
                  <div className="flex h-2 w-24 rounded overflow-hidden">
                    {Array.from({ length: 12 }, (_, i) => (
                      <div key={i} className="flex-1" style={{ background: cellBg(i + 1, 12) }} />
                    ))}
                  </div>
                  <span className="text-[0.5rem] font-mono text-slate-600">max</span>
                  <span className="text-[0.5rem] font-mono text-amber-500 ml-3">▣ peak cell</span>
                </div>
              </div>

              {/* Day sidebar */}
              <div
                className="rounded-lg border border-white/5 p-4"
                style={{ background: 'rgba(255,255,255,0.02)' }}
              >
                <div className="text-[0.6rem] font-mono text-slate-500 uppercase tracking-wider mb-3">
                  By day of week
                </div>
                <DayBar grid={grid} />

                {/* Per-project totals if fleet view */}
                {!selectedSlug && data.slugs.length > 0 && (
                  <div className="mt-5">
                    <div className="text-[0.6rem] font-mono text-slate-500 uppercase tracking-wider mb-2">
                      Per project
                    </div>
                    <div className="space-y-1.5 max-h-48 overflow-y-auto">
                      {data.slugs
                        .map((s) => ({
                          s,
                          total: (data.perSlug[s] ?? []).flatMap((r) => r).reduce((a, v) => a + v, 0),
                        }))
                        .sort((a, b) => b.total - a.total)
                        .map(({ s, total }) => (
                          <button
                            key={s}
                            onClick={() => setSelectedSlug(s)}
                            className="w-full flex items-center gap-2 text-left hover:bg-white/5 px-1 py-0.5 rounded"
                          >
                            <span className="text-[0.55rem] font-mono text-slate-400 flex-1 truncate">{s}</span>
                            <span className="text-[0.55rem] font-mono text-cyan-600">{total}</span>
                          </button>
                        ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="text-[0.55rem] font-mono text-slate-700 text-right mt-4">
            Generated {new Date(data.generatedAt).toLocaleString()} UTC
          </div>
        </div>
      )}
    </div>
  )
}
