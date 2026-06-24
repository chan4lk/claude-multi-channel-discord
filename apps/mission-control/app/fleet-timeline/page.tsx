'use client'

import { useMemo, useState, useRef, useCallback } from 'react'
import Link from 'next/link'
import type { FleetTimelineResponse, TurnSegment } from '../api/fleet-timeline/route'
import { useFreshness } from '../../lib/useFreshness'
import FreshnessBadge from '../../components/FreshnessBadge'

const IDLE_GAP_MS = 30 * 60_000  // 30 min
const ROW_H = 28
const ROW_GAP = 4
const LABEL_W = 112
const CHART_W = 820
const NOW_COLOR = '#00f5ff'

type WindowHours = 6 | 24 | 168

function fmtDuration(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`
  return `${(ms / 3_600_000).toFixed(1)}h`
}

function fmtTs(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function fmtAxisLabel(iso: string, windowHours: number): string {
  const d = new Date(iso)
  if (windowHours <= 6) return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  if (windowHours <= 24) return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function barColor(toolCount: number): string {
  if (toolCount === 0) return '#1e40af'
  if (toolCount <= 3) return '#1d4ed8'
  if (toolCount <= 8) return '#2563eb'
  if (toolCount <= 20) return '#3b82f6'
  if (toolCount <= 50) return '#60a5fa'
  return '#93c5fd'
}

interface IdleGap {
  x: number
  w: number
}

interface RenderedTurn {
  x: number
  w: number
  seg: TurnSegment
}

function buildRow(
  segs: TurnSegment[],
  windowStart: number,
  windowEnd: number,
  chartW: number,
): { bars: RenderedTurn[]; gaps: IdleGap[] } {
  const span = windowEnd - windowStart
  function xPct(ts: string) {
    return ((new Date(ts).getTime() - windowStart) / span) * chartW
  }

  const sorted = [...segs].sort((a, b) => a.start.localeCompare(b.start))
  const bars: RenderedTurn[] = []
  const gaps: IdleGap[] = []

  let prevEnd: number | null = null

  for (const seg of sorted) {
    const x0 = Math.max(0, xPct(seg.start))
    const x1 = Math.min(chartW, xPct(seg.end))
    const w = Math.max(2, x1 - x0)

    if (prevEnd !== null) {
      const gapMs = new Date(seg.start).getTime() - prevEnd
      if (gapMs > IDLE_GAP_MS) {
        const gx0 = Math.max(0, xPct(new Date(prevEnd).toISOString()))
        const gx1 = Math.min(chartW, x0)
        if (gx1 > gx0) gaps.push({ x: gx0, w: gx1 - gx0 })
      }
    }

    bars.push({ x: x0, w, seg })
    prevEnd = new Date(seg.end).getTime()
  }

  return { bars, gaps }
}

export default function FleetTimelinePage() {
  const [windowHours, setWindowHours] = useState<WindowHours>(24)
  const { data, isStale, lastError, lastSuccessAt } = useFreshness<FleetTimelineResponse>(
    `/api/fleet-timeline?hours=${windowHours}`,
    60_000,
  )
  const [hovered, setHovered] = useState<TurnSegment | null>(null)
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 })
  const svgRef = useRef<SVGSVGElement>(null)

  const loading = data === null && lastError === null

  const { slugs, rows, windowStart, windowEnd, axisMarks, totalTurns, nowX } = useMemo(() => {
    if (!data) return { slugs: [], rows: [], windowStart: 0, windowEnd: 0, axisMarks: [], totalTurns: 0, nowX: 0 }

    const ws = new Date(data.windowStart).getTime()
    const we = new Date(data.windowEnd).getTime()
    const span = we - ws

    const bySlug = new Map<string, TurnSegment[]>()
    for (const s of data.segments) {
      if (!bySlug.has(s.slug)) bySlug.set(s.slug, [])
      bySlug.get(s.slug)!.push(s)
    }

    const rows = data.slugs.map((slug) => ({
      slug,
      ...buildRow(bySlug.get(slug) ?? [], ws, we, CHART_W),
    }))

    // Axis: ~6 marks
    const numMarks = windowHours <= 6 ? 7 : windowHours <= 24 ? 7 : 8
    const markInterval = span / (numMarks - 1)
    const axisMarks = Array.from({ length: numMarks }, (_, i) => {
      const t = ws + i * markInterval
      return { x: (i / (numMarks - 1)) * CHART_W, label: fmtAxisLabel(new Date(t).toISOString(), windowHours) }
    })

    const nowX = Math.min(CHART_W, Math.max(0, ((Date.now() - ws) / span) * CHART_W))

    return { slugs: data.slugs, rows, windowStart: ws, windowEnd: we, axisMarks, totalTurns: data.segments.length, nowX }
  }, [data, windowHours])

  const svgH = Math.max(80, slugs.length * (ROW_H + ROW_GAP) + 40)

  const handleMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return
    setTooltipPos({ x: e.clientX - rect.left, y: e.clientY - rect.top })
  }, [])

  if (loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center" style={{ background: '#060d1a' }}>
        <div className="text-xs font-mono text-slate-600 animate-pulse">Loading fleet timeline…</div>
      </div>
    )
  }

  const windowLabels: Record<WindowHours, string> = { 6: '6h', 24: '24h', 168: '7d' }

  return (
    <div className="min-h-dvh flex flex-col" style={{ background: '#060d1a' }}>
      <header className="sticky top-0 z-30 border-b border-cyber-cyan/12 bg-[#060d1a]/90 backdrop-blur-md px-6 py-3">
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-cyber-cyan/40 to-transparent" />
        <div className="flex items-center gap-3 flex-wrap">
          <Link href="/" className="text-[0.6rem] font-mono text-slate-500 hover:text-cyber-cyan transition-colors uppercase tracking-wider">← Dashboard</Link>
          <h1 className="text-sm font-black tracking-[0.18em] text-cyber-cyan" style={{ fontFamily: 'Orbitron, JetBrains Mono, monospace' }}>
            Fleet Operational Timeline
          </h1>
          <span className="text-[0.6rem] font-mono text-slate-500 border border-slate-700 px-2 py-0.5 rounded">cross-project turn activity</span>
          <FreshnessBadge isStale={isStale} lastError={lastError} lastSuccessAt={lastSuccessAt} />
          <div className="flex-1" />
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5">
              <span className="text-[0.55rem] font-mono text-slate-500 uppercase tracking-wider">turns</span>
              <span className="text-lg font-black tabular-nums text-cyber-cyan" style={{ fontFamily: 'Orbitron, monospace' }}>{totalTurns}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[0.55rem] font-mono text-slate-500 uppercase tracking-wider">projects</span>
              <span className="text-lg font-black tabular-nums text-cyber-cyan" style={{ fontFamily: 'Orbitron, monospace' }}>{slugs.length}</span>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 p-6 max-w-6xl mx-auto w-full flex flex-col gap-4">
        {/* Window selector */}
        <div className="flex items-center gap-2">
          <span className="text-[0.55rem] font-mono text-slate-500 uppercase tracking-wider">window</span>
          {([6, 24, 168] as WindowHours[]).map((h) => (
            <button
              key={h}
              onClick={() => setWindowHours(h)}
              className="text-[0.55rem] font-mono px-2 py-1 rounded transition-colors"
              style={{
                background: windowHours === h ? 'rgba(0,245,255,0.12)' : 'transparent',
                color: windowHours === h ? '#00f5ff' : '#64748b',
                border: '1px solid',
                borderColor: windowHours === h ? 'rgba(0,245,255,0.3)' : '#1e293b',
              }}
            >
              {windowLabels[h]}
            </button>
          ))}
          <span className="text-[0.5rem] font-mono text-slate-700 ml-2">
            gray band = idle gap &gt;30 min · bar brightness = tool count
          </span>
        </div>

        {slugs.length === 0 ? (
          <div className="h-48 flex items-center justify-center text-slate-600 text-xs font-mono text-center">
            No turn activity found in the {windowLabels[windowHours]} window.
            Ensure projects have JSONL transcripts with recent session turns.
          </div>
        ) : (
          <div className="rounded-xl border border-cyber-cyan/12 p-4 overflow-x-auto" style={{ background: 'rgba(0,245,255,0.01)' }}>
            <svg
              ref={svgRef}
              width={LABEL_W + CHART_W + 20}
              height={svgH}
              className="font-mono"
              onMouseMove={handleMouseMove}
              onMouseLeave={() => setHovered(null)}
            >
              {/* Axis */}
              <g transform={`translate(${LABEL_W}, ${svgH - 20})`}>
                {axisMarks.map((m, i) => (
                  <g key={i} transform={`translate(${m.x}, 0)`}>
                    <line y1={-(svgH - 32)} y2={0} stroke="#1e293b" strokeWidth={1} />
                    <text y={14} textAnchor="middle" fontSize={7} fill="#334155">{m.label}</text>
                  </g>
                ))}
              </g>

              {/* Rows */}
              {rows.map((row, ri) => {
                const y = ri * (ROW_H + ROW_GAP) + 8
                return (
                  <g key={row.slug}>
                    {/* Label */}
                    <text
                      x={LABEL_W - 6}
                      y={y + ROW_H / 2 + 4}
                      textAnchor="end"
                      fontSize={9}
                      fill="#64748b"
                      className="cursor-default"
                    >
                      {row.slug.length > 14 ? row.slug.slice(0, 13) + '…' : row.slug}
                    </text>

                    {/* Row background */}
                    <rect
                      x={LABEL_W}
                      y={y}
                      width={CHART_W}
                      height={ROW_H}
                      fill="rgba(148,163,184,0.03)"
                      rx={2}
                    />

                    {/* Idle gaps */}
                    {row.gaps.map((gap, gi) => (
                      <rect
                        key={gi}
                        x={LABEL_W + gap.x}
                        y={y + 2}
                        width={gap.w}
                        height={ROW_H - 4}
                        fill="rgba(148,163,184,0.06)"
                        rx={1}
                      />
                    ))}

                    {/* Turn bars */}
                    {row.bars.map((bar, bi) => {
                      const isHov = hovered === bar.seg
                      return (
                        <rect
                          key={bi}
                          x={LABEL_W + bar.x}
                          y={y + 3}
                          width={bar.w}
                          height={ROW_H - 6}
                          fill={barColor(bar.seg.toolCount)}
                          opacity={hovered === null || isHov ? (isHov ? 1 : 0.8) : 0.3}
                          rx={2}
                          className="cursor-pointer"
                          onMouseEnter={() => setHovered(bar.seg)}
                        />
                      )
                    })}
                  </g>
                )
              })}

              {/* Now line */}
              <line
                x1={LABEL_W + nowX}
                y1={8}
                x2={LABEL_W + nowX}
                y2={svgH - 22}
                stroke={NOW_COLOR}
                strokeWidth={1}
                strokeDasharray="3 3"
                opacity={0.5}
              />
              <text x={LABEL_W + nowX + 3} y={15} fontSize={7} fill={NOW_COLOR} opacity={0.7}>now</text>
            </svg>

            {/* Tooltip */}
            {hovered && (
              <div
                className="absolute pointer-events-none z-50 rounded-lg border border-cyber-cyan/20 px-3 py-2 text-[0.55rem] font-mono"
                style={{
                  background: 'rgba(6,13,26,0.95)',
                  left: tooltipPos.x + 12,
                  top: tooltipPos.y + 12,
                  boxShadow: '0 0 12px rgba(0,245,255,0.1)',
                }}
              >
                <div className="text-cyber-cyan font-bold mb-1">{hovered.slug}</div>
                <div className="text-slate-400">Start: {fmtTs(hovered.start)}</div>
                <div className="text-slate-400">End: {fmtTs(hovered.end)}</div>
                <div className="text-slate-400">Duration: {fmtDuration(hovered.durationMs)}</div>
                <div className="text-slate-400">Tools: {hovered.toolCount}</div>
                <div className="text-slate-400">Output tokens: {hovered.tokenCount.toLocaleString()}</div>
              </div>
            )}
          </div>
        )}

        {/* Color legend */}
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-[0.5rem] font-mono text-slate-600 uppercase tracking-wider">tool count</span>
          {[
            { label: '0', color: '#1e40af' },
            { label: '1-3', color: '#1d4ed8' },
            { label: '4-8', color: '#2563eb' },
            { label: '9-20', color: '#3b82f6' },
            { label: '21-50', color: '#60a5fa' },
            { label: '50+', color: '#93c5fd' },
          ].map(({ label, color }) => (
            <div key={label} className="flex items-center gap-1">
              <div className="w-4 h-3 rounded-sm" style={{ background: color }} />
              <span className="text-[0.5rem] font-mono text-slate-500">{label}</span>
            </div>
          ))}
        </div>

        <p className="text-[0.5rem] font-mono text-slate-700">
          Reads JSONL transcripts for each project. One turn = user message → all following assistant messages until next user message.
          Bar width ∝ turn duration. Bar brightness ∝ tool call count. Gray bands = idle gaps &gt;30 min.
          Dashed cyan line = now. Hover a bar for turn details. Window selector refreshes without page reload.
        </p>
      </main>
    </div>
  )
}
