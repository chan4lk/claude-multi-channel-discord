'use client'

import { useCallback, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useFreshness } from '../../lib/useFreshness'
import FreshnessBadge from '../../components/FreshnessBadge'
import type { TokenRaceResponse, TokenRaceSeries } from '../api/token-race/route'

// ─── SVG chart constants ───────────────────────────────────────────────────
const VIEW_W = 720
const VIEW_H = 280
const PAD_L = 48
const PAD_R = 16
const PAD_B = 36
const PAD_T = 16
const CHART_W = VIEW_W - PAD_L - PAD_R
const CHART_H = VIEW_H - PAD_T - PAD_B

// ─── Helpers ──────────────────────────────────────────────────────────────
function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`
  return String(n)
}

function fmtTotalTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

// Collect all unique ISO date strings across all series
function allDates(series: TokenRaceSeries[]): string[] {
  const set = new Set<string>()
  for (const s of series) {
    for (const p of s.points) set.add(p.date)
  }
  return [...set].sort()
}

// For each series, expand points to cover every date in the union (fill with last cumulative)
function expandSeries(
  series: TokenRaceSeries[],
  dates: string[],
): Array<{ slug: string; color: string; totalTokens: number; values: number[] }> {
  return series.map((s) => {
    const pointMap = new Map(s.points.map((p) => [p.date, p.cumulative]))
    let last = 0
    const values = dates.map((d) => {
      const v = pointMap.get(d)
      if (v !== undefined) last = v
      return last
    })
    return { slug: s.slug, color: s.color, totalTokens: s.totalTokens, values }
  })
}

// Y-axis tick labels
function yTicks(maxVal: number, count = 5): number[] {
  if (maxVal === 0) return [0]
  const step = maxVal / (count - 1)
  return Array.from({ length: count }, (_, i) => Math.round(step * i))
}

// Convert (dateIndex, value) to SVG coords within chart area
function toSvgX(i: number, total: number): number {
  if (total <= 1) return PAD_L
  return PAD_L + (i / (total - 1)) * CHART_W
}

function toSvgY(v: number, maxVal: number, normalized: boolean): number {
  const pct = maxVal > 0 ? v / maxVal : 0
  return PAD_T + CHART_H - pct * CHART_H
}

interface TooltipEntry {
  slug: string
  color: string
  value: number
}

export default function TokenRacePage() {
  const [window, setWindow] = useState(30)
  const [normalized, setNormalized] = useState(false)
  const [highlightSlug, setHighlightSlug] = useState<string | null>(null)
  const [crosshairX, setCrosshairX] = useState<number | null>(null)
  const [tooltipEntries, setTooltipEntries] = useState<TooltipEntry[]>([])
  const [tooltipDate, setTooltipDate] = useState<string | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)

  const url = `/api/token-race?window=${window}`
  const { data, isStale, lastError, lastSuccessAt } = useFreshness<TokenRaceResponse>(url, 60_000)

  const dates = useMemo(() => (data ? allDates(data.series) : []), [data])
  const expanded = useMemo(
    () => (data ? expandSeries(data.series, dates) : []),
    [data, dates],
  )

  const maxVal = useMemo(() => {
    if (!expanded.length) return 0
    if (normalized) return 1
    return Math.max(...expanded.map((s) => Math.max(...s.values, 0)), 1)
  }, [expanded, normalized])

  const ticks = useMemo(() => yTicks(maxVal, 5), [maxVal])

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (!svgRef.current || !dates.length || !expanded.length) return
      const rect = svgRef.current.getBoundingClientRect()
      const scaleX = VIEW_W / rect.width
      const mx = (e.clientX - rect.left) * scaleX
      // Map to date index
      const chartMx = mx - PAD_L
      const ratio = Math.max(0, Math.min(1, chartMx / CHART_W))
      const idx = Math.round(ratio * (dates.length - 1))
      const svgCx = toSvgX(idx, dates.length)
      setCrosshairX(svgCx)
      setTooltipDate(dates[idx] ?? null)

      const entries: TooltipEntry[] = expanded
        .map((s) => {
          const raw = s.values[idx] ?? 0
          const value = normalized
            ? s.totalTokens > 0 ? (raw / (s.values[s.values.length - 1] || 1)) : 0
            : raw
          return { slug: s.slug, color: s.color, value }
        })
        .sort((a, b) => b.value - a.value)
      setTooltipEntries(entries)
    },
    [dates, expanded, normalized],
  )

  const handleMouseLeave = useCallback(() => {
    setCrosshairX(null)
    setTooltipDate(null)
    setTooltipEntries([])
  }, [])

  const polylinePoints = useCallback(
    (values: number[], totalTokens: number) => {
      return values
        .map((v, i) => {
          const normV = normalized ? (totalTokens > 0 ? v / (values[values.length - 1] || 1) : 0) : v
          return `${toSvgX(i, dates.length)},${toSvgY(normV, maxVal, normalized)}`
        })
        .join(' ')
    },
    [dates.length, maxVal, normalized],
  )

  const isEmpty = !data || data.series.length === 0

  return (
    <div style={{ background: '#060d1a', minHeight: '100vh', fontFamily: 'monospace', color: '#e2e8f0', padding: '24px 32px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24, flexWrap: 'wrap' }}>
        <Link
          href="/"
          style={{ color: '#22d3ee', textDecoration: 'none', fontSize: 13, opacity: 0.8 }}
        >
          ← Dashboard
        </Link>
        <h1 style={{ margin: 0, fontSize: 18, fontFamily: 'Orbitron, monospace', color: '#22d3ee', letterSpacing: '0.05em' }}>
          Token Budget Burn Comparison
        </h1>
        <FreshnessBadge isStale={isStale} lastError={lastError} lastSuccessAt={lastSuccessAt} />
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 20, alignItems: 'center', flexWrap: 'wrap' }}>
        {/* Window selector */}
        <div style={{ display: 'flex', gap: 4 }}>
          {[30, 60, 90].map((w) => (
            <button
              key={w}
              onClick={() => setWindow(w)}
              style={{
                padding: '4px 12px',
                fontSize: 12,
                fontFamily: 'monospace',
                background: window === w ? '#22d3ee20' : 'transparent',
                color: window === w ? '#22d3ee' : '#64748b',
                border: `1px solid ${window === w ? '#22d3ee60' : '#1e293b'}`,
                borderRadius: 4,
                cursor: 'pointer',
              }}
            >
              {w}d
            </button>
          ))}
        </div>

        {/* Absolute / Normalized toggle */}
        <button
          onClick={() => setNormalized((n) => !n)}
          style={{
            padding: '4px 12px',
            fontSize: 12,
            fontFamily: 'monospace',
            background: normalized ? '#a78bfa20' : 'transparent',
            color: normalized ? '#a78bfa' : '#64748b',
            border: `1px solid ${normalized ? '#a78bfa60' : '#1e293b'}`,
            borderRadius: 4,
            cursor: 'pointer',
          }}
        >
          {normalized ? 'Normalized' : 'Absolute'}
        </button>
      </div>

      {/* Chart */}
      {isEmpty ? (
        <div style={{ color: '#64748b', fontSize: 14, padding: '40px 0' }}>
          No token data available.
        </div>
      ) : (
        <>
          <div style={{ position: 'relative', background: '#0a1628', border: '1px solid #1e3a5f', borderRadius: 8, padding: 8, marginBottom: 16 }}>
            <svg
              ref={svgRef}
              viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
              style={{ width: '100%', display: 'block', cursor: 'crosshair' }}
              onMouseMove={handleMouseMove}
              onMouseLeave={handleMouseLeave}
            >
              {/* Y-axis grid lines + labels */}
              {ticks.map((tick) => {
                const y = toSvgY(tick, maxVal, normalized)
                const label = normalized ? `${Math.round(tick * 100)}%` : fmtTokens(tick)
                return (
                  <g key={tick}>
                    <line
                      x1={PAD_L} y1={y} x2={PAD_L + CHART_W} y2={y}
                      stroke="#1e3a5f" strokeWidth={0.5} strokeDasharray="3 3"
                    />
                    <text
                      x={PAD_L - 4} y={y + 4}
                      fontSize={9} textAnchor="end" fill="#475569" fontFamily="monospace"
                    >
                      {label}
                    </text>
                  </g>
                )
              })}

              {/* X axis labels: first and last date */}
              {dates.length > 0 && (
                <>
                  <text
                    x={PAD_L} y={VIEW_H - 6}
                    fontSize={9} textAnchor="start" fill="#475569" fontFamily="monospace"
                  >
                    {dates[0]}
                  </text>
                  {dates.length > 1 && (
                    <text
                      x={PAD_L + CHART_W} y={VIEW_H - 6}
                      fontSize={9} textAnchor="end" fill="#475569" fontFamily="monospace"
                    >
                      {dates[dates.length - 1]}
                    </text>
                  )}
                </>
              )}

              {/* "Today" vertical line at last data point */}
              {dates.length > 0 && (
                <line
                  x1={PAD_L + CHART_W} y1={PAD_T}
                  x2={PAD_L + CHART_W} y2={PAD_T + CHART_H}
                  stroke="#22d3ee" strokeWidth={0.5} strokeOpacity={0.3} strokeDasharray="4 4"
                />
              )}

              {/* Polylines — dimmed lines first, then highlight on top */}
              {expanded.map((s) => {
                const isHighlighted = highlightSlug === null || highlightSlug === s.slug
                const pts = polylinePoints(s.values, s.totalTokens)
                return (
                  <polyline
                    key={s.slug}
                    points={pts}
                    fill="none"
                    stroke={s.color}
                    strokeWidth={isHighlighted ? (highlightSlug === s.slug ? 2.5 : 1.5) : 1.5}
                    strokeOpacity={isHighlighted ? 1 : 0.18}
                  />
                )
              })}

              {/* Vertical crosshair */}
              {crosshairX !== null && (
                <line
                  x1={crosshairX} y1={PAD_T}
                  x2={crosshairX} y2={PAD_T + CHART_H}
                  stroke="#e2e8f0" strokeWidth={0.6} strokeOpacity={0.4}
                  pointerEvents="none"
                />
              )}
            </svg>

            {/* Hover tooltip */}
            {crosshairX !== null && tooltipEntries.length > 0 && tooltipDate && (
              <div style={{
                position: 'absolute',
                top: PAD_T + 4,
                left: Math.min(crosshairX / VIEW_W * 100, 65) + '%',
                background: '#0b1628',
                border: '1px solid #1e3a5f',
                borderRadius: 6,
                padding: '8px 12px',
                pointerEvents: 'none',
                minWidth: 160,
                zIndex: 10,
              }}>
                <div style={{ color: '#94a3b8', fontSize: 10, marginBottom: 6 }}>{tooltipDate}</div>
                {tooltipEntries.map((e) => (
                  <div key={e.slug} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                    <span style={{ width: 8, height: 8, borderRadius: 9999, background: e.color, display: 'inline-block', flexShrink: 0 }} />
                    <span style={{ color: '#cbd5e1', fontSize: 11, flex: 1 }}>{e.slug}</span>
                    <span style={{ color: e.color, fontSize: 11, fontFamily: 'monospace' }}>
                      {normalized
                        ? `${(e.value * 100).toFixed(1)}%`
                        : fmtTokens(e.value)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Legend */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {(data?.series ?? []).map((s) => (
              <button
                key={s.slug}
                onClick={() => setHighlightSlug((h) => h === s.slug ? null : s.slug)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  background: highlightSlug === s.slug ? `${s.color}15` : 'transparent',
                  border: `1px solid ${highlightSlug === s.slug ? `${s.color}60` : '#1e293b'}`,
                  borderRadius: 4,
                  padding: '4px 10px',
                  cursor: 'pointer',
                  opacity: highlightSlug !== null && highlightSlug !== s.slug ? 0.4 : 1,
                  transition: 'opacity 0.15s, border-color 0.15s',
                }}
              >
                <span style={{
                  width: 10, height: 10, borderRadius: 9999,
                  background: s.color,
                  display: 'inline-block',
                  flexShrink: 0,
                  boxShadow: `0 0 4px ${s.color}80`,
                }} />
                <span style={{ color: '#cbd5e1', fontSize: 12 }}>{s.slug}</span>
                <span style={{ color: s.color, fontSize: 11, fontFamily: 'monospace', marginLeft: 4 }}>
                  {fmtTotalTokens(s.totalTokens)}
                </span>
              </button>
            ))}
          </div>
        </>
      )}

      <div style={{ color: '#334155', fontSize: 11, marginTop: 20 }}>
        {data && `${data.series.length} projects · ${data.windowDays}d window`}
        {data?.generatedAt && ` · updated ${new Date(data.generatedAt).toLocaleTimeString()}`}
      </div>
    </div>
  )
}
