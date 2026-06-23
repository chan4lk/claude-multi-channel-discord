'use client'

import { useEffect, useRef, useState } from 'react'
import * as d3 from 'd3'
import SubPageHeader from '../../components/SubPageHeader'
import type { TurnQualityResponse } from '../api/turn-quality/route'

type TimeRange = '7d' | '14d' | '30d'

interface Point {
  slug: string
  day: string
  totalTurns: number
  avgQuality: number
}

interface TooltipState {
  x: number
  y: number
  slug: string
  day: string
  totalTurns: number
  avgQuality: number
}

const PALETTE = [
  '#22D3EE', '#4ADE80', '#A78BFA', '#F59E0B', '#EF4444',
  '#F472B6', '#34D399', '#FB923C', '#60A5FA', '#E879F9',
]

function slugColor(slug: string, slugs: string[]): string {
  return PALETTE[slugs.indexOf(slug) % PALETTE.length]
}

function buildPoints(data: TurnQualityResponse, range: TimeRange, today: string): Point[] {
  const days = range === '7d' ? 7 : range === '14d' ? 14 : 30
  const cutoff = new Date(today)
  cutoff.setDate(cutoff.getDate() - days)
  const cutoffStr = cutoff.toISOString().slice(0, 10)

  const grouped = new Map<string, { sumScoreTurns: number; totalTurns: number }>()
  for (const row of data.rows) {
    const day = row.hour.split('T')[0]
    if (day < cutoffStr || day > today) continue
    const key = `${row.slug}::${day}`
    const prev = grouped.get(key) ?? { sumScoreTurns: 0, totalTurns: 0 }
    prev.sumScoreTurns += row.score * row.turnCount
    prev.totalTurns += row.turnCount
    grouped.set(key, prev)
  }

  const points: Point[] = []
  for (const [key, agg] of grouped) {
    if (agg.totalTurns === 0) continue
    const [slug, day] = key.split('::')
    points.push({
      slug,
      day,
      totalTurns: agg.totalTurns,
      avgQuality: agg.sumScoreTurns / agg.totalTurns,
    })
  }
  return points
}

function computeRegression(points: Point[]): { slope: number; intercept: number } | null {
  if (points.length < 3) return null
  const n = points.length
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0
  for (const p of points) {
    sumX += p.totalTurns
    sumY += p.avgQuality
    sumXY += p.totalTurns * p.avgQuality
    sumX2 += p.totalTurns * p.totalTurns
  }
  const denom = n * sumX2 - sumX * sumX
  if (denom === 0) return null
  const slope = (n * sumXY - sumX * sumY) / denom
  const intercept = (sumY - slope * sumX) / n
  return { slope, intercept }
}

const MARGIN = { top: 30, right: 20, bottom: 50, left: 55 }
const HEIGHT = 500

export default function TurnCorrelationPage() {
  const [data, setData] = useState<TurnQualityResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [range, setRange] = useState<TimeRange>('7d')
  const [tooltip, setTooltip] = useState<TooltipState | null>(null)
  const [containerWidth, setContainerWidth] = useState(800)
  const svgRef = useRef<SVGSVGElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    async function load() {
      try {
        const r = await fetch('/api/turn-quality')
        if (r.ok) setData(await r.json() as TurnQualityResponse)
      } catch { /* ignore */ } finally {
        setLoading(false)
      }
    }
    load()
    const id = setInterval(load, 30 * 60_000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    if (!containerRef.current) return
    const obs = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width
      if (w) setContainerWidth(w)
    })
    obs.observe(containerRef.current)
    return () => obs.disconnect()
  }, [])

  const today = new Date().toISOString().slice(0, 10)
  const points = data ? buildPoints(data, range, today) : []
  const visibleSlugs = [...new Set(points.map((p) => p.slug))].sort()

  const innerW = containerWidth - MARGIN.left - MARGIN.right
  const innerH = HEIGHT - MARGIN.top - MARGIN.bottom

  const xMax = points.length > 0 ? Math.max(...points.map((p) => p.totalTurns)) : 10
  const xScale = d3.scaleLinear().domain([0, xMax]).range([0, innerW]).nice()
  const yScale = d3.scaleLinear().domain([0, 100]).range([innerH, 0])

  const xTicks = xScale.ticks(5)
  const yTicks = yScale.ticks(5)

  const regression = computeRegression(points)

  useEffect(() => {
    if (!svgRef.current) return
    const svg = d3.select(svgRef.current)
    svg.selectAll('.axis-group').remove()
  }, [containerWidth, range])

  function trendLabel(slope: number): string {
    if (slope > 0.1) return 'quality ↑ with volume'
    if (slope < -0.1) return 'quality ↓ with volume'
    return 'no trend'
  }

  const regLineY0 = regression ? regression.intercept : 0
  const regLineY1 = regression ? regression.slope * xMax + regression.intercept : 0

  return (
    <div className="min-h-screen bg-[#030712] text-slate-300 font-mono">
      <SubPageHeader title="TURN CORRELATION">
        {(['7d', '14d', '30d'] as TimeRange[]).map((r) => (
          <button
            key={r}
            onClick={() => setRange(r)}
            className={[
              'text-[0.6rem] px-2 py-0.5 rounded border transition-colors',
              range === r
                ? 'border-cyan-400 text-cyan-400 bg-cyan-400/10'
                : 'border-slate-700 text-slate-500 hover:border-slate-500 hover:text-slate-400',
            ].join(' ')}
          >
            {r}
          </button>
        ))}
      </SubPageHeader>

      <div className="p-4" ref={containerRef}>
        {loading && (
          <div className="flex items-center justify-center h-64 text-slate-500 text-sm">
            Loading correlation data…
          </div>
        )}

        {!loading && points.length === 0 && (
          <div className="flex items-center justify-center h-64 text-slate-500 text-sm">
            No data in selected range
          </div>
        )}

        {!loading && points.length > 0 && (
          <>
            <svg
              ref={svgRef}
              width={containerWidth}
              height={HEIGHT}
              style={{ overflow: 'visible' }}
            >
              <g transform={`translate(${MARGIN.left},${MARGIN.top})`}>
                {/* Grid lines */}
                {xTicks.map((t) => (
                  <line
                    key={`xg-${t}`}
                    x1={xScale(t)}
                    x2={xScale(t)}
                    y1={0}
                    y2={innerH}
                    stroke="#1E293B"
                    strokeWidth={1}
                  />
                ))}
                {yTicks.map((t) => (
                  <line
                    key={`yg-${t}`}
                    x1={0}
                    x2={innerW}
                    y1={yScale(t)}
                    y2={yScale(t)}
                    stroke="#1E293B"
                    strokeWidth={1}
                  />
                ))}

                {/* X axis */}
                <line x1={0} x2={innerW} y1={innerH} y2={innerH} stroke="#334155" strokeWidth={1} />
                {xTicks.map((t) => (
                  <g key={`xt-${t}`} transform={`translate(${xScale(t)},${innerH})`}>
                    <line y1={0} y2={5} stroke="#334155" strokeWidth={1} />
                    <text y={18} textAnchor="middle" fill="#64748B" fontSize={10}>
                      {t}
                    </text>
                  </g>
                ))}
                <text
                  x={innerW / 2}
                  y={innerH + 42}
                  textAnchor="middle"
                  fill="#64748B"
                  fontSize={11}
                >
                  Daily Turns
                </text>

                {/* Y axis */}
                <line x1={0} x2={0} y1={0} y2={innerH} stroke="#334155" strokeWidth={1} />
                {yTicks.map((t) => (
                  <g key={`yt-${t}`} transform={`translate(0,${yScale(t)})`}>
                    <line x1={-5} x2={0} stroke="#334155" strokeWidth={1} />
                    <text x={-10} dy="0.32em" textAnchor="end" fill="#64748B" fontSize={10}>
                      {t}
                    </text>
                  </g>
                ))}
                <text
                  transform={`translate(${-40},${innerH / 2}) rotate(-90)`}
                  textAnchor="middle"
                  fill="#64748B"
                  fontSize={11}
                >
                  Avg Quality Score
                </text>

                {/* Regression trend line */}
                {regression && (
                  <>
                    <line
                      x1={xScale(0)}
                      y1={yScale(Math.max(0, Math.min(100, regLineY0)))}
                      x2={xScale(xMax)}
                      y2={yScale(Math.max(0, Math.min(100, regLineY1)))}
                      stroke="#64748B"
                      strokeWidth={1.5}
                      strokeDasharray="4 3"
                    />
                    <text
                      x={xScale(xMax) + 4}
                      y={yScale(Math.max(0, Math.min(100, regLineY1)))}
                      dy="0.32em"
                      fill="#64748B"
                      fontSize={9}
                    >
                      {trendLabel(regression.slope)}
                    </text>
                  </>
                )}

                {/* Points */}
                {points.map((p) => {
                  const cx = xScale(p.totalTurns)
                  const cy = yScale(p.avgQuality)
                  const color = slugColor(p.slug, visibleSlugs)
                  return (
                    <circle
                      key={`${p.slug}-${p.day}`}
                      cx={cx}
                      cy={cy}
                      r={5}
                      fill={color}
                      opacity={0.8}
                      style={{ cursor: 'pointer', transition: 'r 0.1s, opacity 0.1s' }}
                      onMouseEnter={(e) => {
                        const el = e.currentTarget
                        el.setAttribute('r', '8')
                        el.setAttribute('opacity', '1')
                        setTooltip({
                          x: e.clientX,
                          y: e.clientY,
                          slug: p.slug,
                          day: p.day,
                          totalTurns: p.totalTurns,
                          avgQuality: p.avgQuality,
                        })
                      }}
                      onMouseLeave={(e) => {
                        const el = e.currentTarget
                        el.setAttribute('r', '5')
                        el.setAttribute('opacity', '0.8')
                        setTooltip(null)
                      }}
                      onClick={() => {
                        window.location.href = `/turn-quality?slug=${encodeURIComponent(p.slug)}&day=${p.day}`
                      }}
                    />
                  )
                })}
              </g>
            </svg>

            {/* Legend */}
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-[0.6rem] font-mono">
              {visibleSlugs.map((slug) => (
                <span key={slug} className="flex items-center gap-1">
                  <span
                    className="inline-block w-2.5 h-2.5 rounded-sm shrink-0"
                    style={{ background: slugColor(slug, visibleSlugs) }}
                  />
                  <span className="text-slate-400">{slug}</span>
                </span>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Tooltip */}
      {tooltip && (
        <div
          className="fixed z-50 pointer-events-none rounded-lg border border-white/10 px-3 py-2 text-[0.6rem]"
          style={{
            left: tooltip.x + 14,
            top: tooltip.y - 8,
            background: '#0d1b2e',
            transform: 'translateY(-50%)',
          }}
        >
          <div
            className="font-bold mb-0.5"
            style={{ color: slugColor(tooltip.slug, visibleSlugs) }}
          >
            {tooltip.slug}
          </div>
          <div className="text-slate-500">{tooltip.day}</div>
          <div className="mt-1 text-slate-300">Turns: {tooltip.totalTurns}</div>
          <div className="text-slate-300">Quality: {tooltip.avgQuality.toFixed(1)}</div>
          <div className="text-slate-600 mt-1">Click to view →</div>
        </div>
      )}
    </div>
  )
}
