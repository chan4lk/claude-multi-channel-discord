'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import SubPageHeader from '../../components/SubPageHeader'
import type { GanttEvent, GanttProject, GanttResponse } from '../api/fleet/gantt/route'

const EVENT_COLOR: Record<GanttEvent['type'], string> = {
  turn: '#22D3EE',
  stall: '#EF4444',
  inject: '#A78BFA',
}

const EVENT_LABEL: Record<GanttEvent['type'], string> = {
  turn: '●',
  stall: '✗',
  inject: '⚡',
}

const DAY_OPTIONS = [1, 3, 7, 14] as const
type DayOption = typeof DAY_OPTIONS[number]

interface TooltipState {
  x: number
  y: number
  event: GanttEvent
}

interface SparkData {
  slug: string
  counts: number[]
  labels: string[]
}

const ROW_H = 36
const LABEL_W = 140
const HEADER_H = 36
const DOT_R = 4

function MiniBar({ counts, color }: { counts: number[]; color: string }) {
  const max = Math.max(...counts, 1)
  return (
    <div className="flex items-end gap-px h-8 mt-1">
      {counts.map((v, i) => (
        <div
          key={i}
          className="flex-1 rounded-sm"
          style={{
            height: `${Math.max((v / max) * 100, v > 0 ? 8 : 2)}%`,
            background: v > 0 ? color : 'rgba(100,116,139,0.2)',
          }}
        />
      ))}
    </div>
  )
}

export default function GanttPage() {
  const [projects, setProjects] = useState<GanttProject[]>([])
  const [loading, setLoading] = useState(true)
  const [days, setDays] = useState<DayOption>(7)
  const [lastUpdated, setLastUpdated] = useState('')
  const [tooltip, setTooltip] = useState<TooltipState | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [spark, setSpark] = useState<Record<string, SparkData>>({})
  const [showInactive, setShowInactive] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  const loadData = useCallback(() => {
    setLoading(true)
    fetch(`/api/fleet/gantt?days=${days}`)
      .then((r) => r.json())
      .then((data: GanttResponse) => {
        setProjects(data.projects)
        setLastUpdated(new Date().toLocaleTimeString())
      })
      .catch(() => {/* ignore */})
      .finally(() => setLoading(false))
  }, [days])

  useEffect(() => {
    loadData()
    const id = setInterval(loadData, 60_000)
    return () => clearInterval(id)
  }, [loadData])

  // Compute sparklines for expanded rows
  useEffect(() => {
    const newSpark: Record<string, SparkData> = {}
    const now = Date.now()
    const windowMs = days * 24 * 60 * 60 * 1000
    const bucketMs = windowMs / days

    for (const proj of projects) {
      if (!expanded.has(proj.slug)) continue
      const counts = Array.from({ length: days }, () => 0)
      const labels = Array.from({ length: days }, (_, i) => {
        const d = new Date(now - (days - 1 - i) * bucketMs)
        return `${d.getMonth() + 1}/${d.getDate()}`
      })
      for (const ev of proj.events) {
        if (ev.type !== 'turn') continue
        const tsMs = new Date(ev.ts).getTime()
        const idx = Math.floor((tsMs - (now - windowMs)) / bucketMs)
        if (idx >= 0 && idx < days) counts[idx]++
      }
      newSpark[proj.slug] = { slug: proj.slug, counts, labels }
    }
    setSpark(newSpark)
  }, [projects, expanded, days])

  const activeProjects = showInactive
    ? projects
    : projects.filter((p) => p.events.length > 0)

  // Time range
  const now = Date.now()
  const windowMs = days * 24 * 60 * 60 * 1000
  const startMs = now - windowMs

  function toPx(width: number, tsMs: number): number {
    return ((tsMs - startMs) / windowMs) * width
  }

  // Export as SVG download
  function exportSvg() {
    const svgEl = document.querySelector('#gantt-svg') as SVGSVGElement | null
    if (!svgEl) return
    const blob = new Blob([svgEl.outerHTML], { type: 'image/svg+xml' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `gantt-${days}d.svg`
    a.click()
    URL.revokeObjectURL(url)
  }

  // Generate time axis ticks
  function getTimeTicks(width: number): Array<{ x: number; label: string }> {
    const tickCount = days <= 3 ? days * 4 : days
    const ticks: Array<{ x: number; label: string }> = []
    for (let i = 0; i <= tickCount; i++) {
      const tsMs = startMs + (i / tickCount) * windowMs
      const x = (i / tickCount) * width
      const d = new Date(tsMs)
      const label = days <= 1
        ? `${d.getHours().toString().padStart(2, '0')}:00`
        : `${d.getMonth() + 1}/${d.getDate()}`
      ticks.push({ x, label })
    }
    return ticks
  }

  const totalHeight = activeProjects.reduce((acc, p) => {
    return acc + ROW_H + (expanded.has(p.slug) ? 60 : 0)
  }, 0) + HEADER_H

  const svgWidth = Math.max(900, typeof window !== 'undefined' ? window.innerWidth - LABEL_W - 32 : 900)

  return (
    <div className="min-h-dvh flex flex-col font-mono" style={{ background: '#0a0a0a' }}>
      <SubPageHeader title="PROJECT LIFECYCLE GANTT">
        <div className="flex items-center gap-1">
          {DAY_OPTIONS.map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className="text-[0.6rem] px-2 py-0.5 rounded border transition-all"
              style={{
                borderColor: days === d ? '#22D3EE' : '#374151',
                color: days === d ? '#22D3EE' : '#6B7280',
                background: days === d ? 'rgba(34,211,238,0.1)' : 'transparent',
              }}
            >
              {d}d
            </button>
          ))}
        </div>
        <button
          onClick={() => setShowInactive((v) => !v)}
          className="text-[0.6rem] px-2 py-0.5 rounded border transition-all"
          style={{
            borderColor: showInactive ? '#A78BFA' : '#374151',
            color: showInactive ? '#A78BFA' : '#6B7280',
          }}
        >
          {showInactive ? 'hide inactive' : 'show all'}
        </button>
        <button
          onClick={exportSvg}
          className="text-[0.6rem] px-2 py-0.5 rounded border transition-all"
          style={{ borderColor: '#374151', color: '#6B7280' }}
        >
          ↓ SVG
        </button>
        <span className="text-[0.55rem] font-mono text-slate-600">
          {loading ? 'loading...' : `${activeProjects.length} projects · ${lastUpdated}`}
        </span>
      </SubPageHeader>

      {/* Legend */}
      <div className="flex items-center gap-4 px-4 py-2 border-b" style={{ borderColor: '#1f2937' }}>
        {(Object.entries(EVENT_COLOR) as [GanttEvent['type'], string][]).map(([type, color]) => (
          <div key={type} className="flex items-center gap-1.5">
            <span style={{ color, fontSize: '0.8rem' }}>{EVENT_LABEL[type]}</span>
            <span className="text-[0.55rem] text-slate-500 capitalize">{type}</span>
          </div>
        ))}
        <span className="text-[0.55rem] text-slate-600 ml-auto">
          Click row to expand · Hover event for details
        </span>
      </div>

      <main className="flex-1 overflow-hidden relative" style={{ minHeight: 0 }}>
        {loading && projects.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-cyan-400/40 text-sm animate-pulse">Loading Gantt...</span>
          </div>
        ) : activeProjects.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-slate-600 text-sm">
              No project activity in last {days} day{days !== 1 ? 's' : ''}
            </span>
          </div>
        ) : (
          <div className="flex h-full overflow-y-auto overflow-x-hidden" ref={scrollRef}>
            {/* Fixed label column */}
            <div
              className="shrink-0 border-r"
              style={{ width: LABEL_W, borderColor: '#1f2937' }}
            >
              {/* Spacer for header row */}
              <div
                className="border-b flex items-center px-2"
                style={{ height: HEADER_H, borderColor: '#1f2937' }}
              >
                <span className="text-[0.55rem] text-slate-600 uppercase tracking-widest">Project</span>
              </div>
              {activeProjects.map((proj) => (
                <div key={proj.slug}>
                  <div
                    className="flex items-center px-3 cursor-pointer border-b hover:bg-cyber-cyan/5 transition-colors"
                    style={{ height: ROW_H, borderColor: '#1f2937' }}
                    onClick={() =>
                      setExpanded((prev) => {
                        const next = new Set(prev)
                        if (next.has(proj.slug)) next.delete(proj.slug)
                        else next.add(proj.slug)
                        return next
                      })
                    }
                  >
                    <span
                      className="text-[0.6rem] font-mono truncate"
                      style={{ color: proj.events.length > 0 ? '#CBD5E1' : '#475569' }}
                    >
                      {expanded.has(proj.slug) ? '▾ ' : '▸ '}
                      {proj.slug}
                    </span>
                    <span className="ml-auto text-[0.5rem] text-slate-600">{proj.events.length}</span>
                  </div>
                  {expanded.has(proj.slug) && spark[proj.slug] && (
                    <div
                      className="px-3 py-1 border-b bg-cyber-bg/30"
                      style={{ height: 60, borderColor: '#1f2937' }}
                    >
                      <span className="text-[0.5rem] text-slate-600">turns/day</span>
                      <MiniBar counts={spark[proj.slug].counts} color="#22D3EE" />
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Scrollable timeline area */}
            <div className="flex-1 overflow-x-auto" style={{ minWidth: 0 }}>
              <div style={{ position: 'relative', minWidth: svgWidth }}>
                <svg
                  id="gantt-svg"
                  width={svgWidth}
                  height={totalHeight}
                  style={{ display: 'block' }}
                >
                  {/* Time axis */}
                  <rect x={0} y={0} width={svgWidth} height={HEADER_H} fill="#0d1117" />
                  {getTimeTicks(svgWidth).map((tick, i) => (
                    <g key={i}>
                      <line
                        x1={tick.x} y1={HEADER_H - 6}
                        x2={tick.x} y2={totalHeight}
                        stroke="#1f2937" strokeWidth={1}
                        strokeDasharray="2,4"
                      />
                      <text
                        x={tick.x + 3} y={HEADER_H - 8}
                        fill="#4B5563"
                        fontSize={8}
                        fontFamily="JetBrains Mono, monospace"
                      >
                        {tick.label}
                      </text>
                    </g>
                  ))}
                  <line x1={0} y1={HEADER_H} x2={svgWidth} y2={HEADER_H} stroke="#1f2937" />

                  {/* "Now" line */}
                  <line
                    x1={svgWidth - 1} y1={HEADER_H}
                    x2={svgWidth - 1} y2={totalHeight}
                    stroke="rgba(34,211,238,0.4)"
                    strokeWidth={1}
                  />

                  {/* Project rows */}
                  {activeProjects.reduce<{ els: React.ReactNode[]; y: number }>(
                    ({ els, y }, proj) => {
                      const rowY = y
                      const isExpanded = expanded.has(proj.slug)
                      const nextY = y + ROW_H + (isExpanded ? 60 : 0)

                      const rowEls = (
                        <g key={proj.slug}>
                          <rect
                            x={0} y={rowY} width={svgWidth} height={ROW_H}
                            fill={rowY % (ROW_H * 2) === 0 ? 'rgba(255,255,255,0.01)' : 'transparent'}
                            style={{ cursor: 'pointer' }}
                          />
                          {isExpanded && (
                            <rect
                              x={0} y={rowY + ROW_H} width={svgWidth} height={60}
                              fill="rgba(0,245,255,0.02)"
                            />
                          )}
                          <line
                            x1={0} y1={rowY + ROW_H - 1}
                            x2={svgWidth} y2={rowY + ROW_H - 1}
                            stroke="#1f2937" strokeWidth={0.5}
                          />
                          {/* Events */}
                          {proj.events.map((ev, i) => {
                            const tsMs = new Date(ev.ts).getTime()
                            if (isNaN(tsMs)) return null
                            const x = toPx(svgWidth, tsMs)
                            const cy = rowY + ROW_H / 2
                            const color = EVENT_COLOR[ev.type]
                            const isStall = ev.type === 'stall'
                            return (
                              <g
                                key={i}
                                onMouseEnter={(e) => {
                                  const rect = (e.currentTarget as SVGElement).getBoundingClientRect()
                                  setTooltip({
                                    x: rect.left,
                                    y: rect.top,
                                    event: ev,
                                  })
                                }}
                                onMouseLeave={() => setTooltip(null)}
                                style={{ cursor: 'default' }}
                              >
                                {isStall ? (
                                  <>
                                    <line x1={x - 3} y1={cy - 3} x2={x + 3} y2={cy + 3} stroke={color} strokeWidth={1.5} />
                                    <line x1={x + 3} y1={cy - 3} x2={x - 3} y2={cy + 3} stroke={color} strokeWidth={1.5} />
                                  </>
                                ) : (
                                  <circle
                                    cx={x} cy={cy} r={DOT_R}
                                    fill={color}
                                    fillOpacity={ev.type === 'turn' ? 0.6 : 0.9}
                                    stroke={color}
                                    strokeWidth={0.5}
                                    strokeOpacity={0.8}
                                  />
                                )}
                              </g>
                            )
                          })}
                        </g>
                      )

                      return { els: [...els, rowEls], y: nextY }
                    },
                    { els: [], y: HEADER_H }
                  ).els}
                </svg>
              </div>
            </div>
          </div>
        )}

        {/* Tooltip */}
        {tooltip && (
          <div
            className="fixed z-50 pointer-events-none rounded border p-2"
            style={{
              left: tooltip.x + 12,
              top: tooltip.y - 48,
              background: 'rgba(5,5,5,0.97)',
              borderColor: `${EVENT_COLOR[tooltip.event.type]}44`,
              boxShadow: `0 0 12px ${EVENT_COLOR[tooltip.event.type]}28`,
              fontSize: '0.65rem',
              fontFamily: 'JetBrains Mono, monospace',
              minWidth: 160,
            }}
          >
            <div style={{ color: EVENT_COLOR[tooltip.event.type] }} className="font-bold capitalize mb-0.5">
              {EVENT_LABEL[tooltip.event.type]} {tooltip.event.type}
            </div>
            <div className="text-slate-400">
              {new Date(tooltip.event.ts).toLocaleString()}
            </div>
            {tooltip.event.description && (
              <div className="text-slate-500 text-[0.58rem] mt-0.5">{tooltip.event.description}</div>
            )}
          </div>
        )}
      </main>
    </div>
  )
}
