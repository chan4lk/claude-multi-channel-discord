'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import type { ToolFrequencyResponse } from '../api/tool-frequency/route'

const CELL_W = 14
const CELL_H = 14
const CELL_GAP = 2
const ROW_LABEL_W = 200
const HEADER_H = 24

function cellColor(count: number): string {
  if (count === 0) return '#0f172a'
  if (count === 1) return '#164e63'
  if (count <= 3) return '#0e7490'
  if (count <= 8) return '#06b6d4'
  return '#22d3ee'
}

export default function ToolFrequencyPage() {
  const [windowDays, setWindowDays] = useState(30)
  const [selectedSlug, setSelectedSlug] = useState<string>('')
  const [includeMcd, setIncludeMcd] = useState(false)
  const [data, setData] = useState<ToolFrequencyResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tooltip, setTooltip] = useState<{ tool: string; day: string; count: number; x: number; y: number } | null>(null)

  useEffect(() => {
    let cancelled = false

    async function fetchData() {
      setLoading(true)
      setError(null)
      try {
        const params = new URLSearchParams({
          days: String(windowDays),
          include_mcd: includeMcd ? '1' : '0',
        })
        if (selectedSlug) params.set('slug', selectedSlug)
        const res = await fetch(`/api/tool-frequency?${params}`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const json = (await res.json()) as ToolFrequencyResponse
        if (!cancelled) {
          setData(json)
          setLoading(false)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Unknown error')
          setLoading(false)
        }
      }
    }

    void fetchData()

    const interval = setInterval(() => { void fetchData() }, 300_000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [windowDays, selectedSlug, includeMcd])

  const tools = data?.tools ?? []
  const days = data?.days ?? []
  const counts = data?.counts ?? {}
  const top5 = data?.top5 ?? []
  const slugOptions = data?.slugs ?? []

  // SVG dimensions
  const svgW = ROW_LABEL_W + days.length * (CELL_W + CELL_GAP)
  const svgH = HEADER_H + tools.length * (CELL_H + CELL_GAP)

  // Day labels every 7 days
  const dayLabels: Array<{ idx: number; label: string }> = []
  days.forEach((d, i) => {
    if (i % 7 === 0) {
      const parts = d.split('-')
      dayLabels.push({ idx: i, label: `${parts[1]}/${parts[2]}` })
    }
  })

  return (
    <div style={{ background: '#030712', minHeight: '100vh', fontFamily: 'monospace', color: '#cbd5e1', padding: '24px 32px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 8, flexWrap: 'wrap' }}>
        <Link href="/" style={{ color: '#22d3ee', textDecoration: 'none', fontSize: 13, opacity: 0.8 }}>
          ← Dashboard
        </Link>
        <h1 style={{ margin: 0, fontSize: 18, fontFamily: 'Orbitron, monospace', color: '#22d3ee', letterSpacing: '0.05em' }}>
          Tool Call Frequency Heatmap
        </h1>
        <span style={{ color: '#475569', fontSize: 12 }}>auto-refreshes every 5m</span>
      </div>
      <p style={{ margin: '0 0 20px 0', fontSize: 12, color: '#475569' }}>
        MCP tool usage per day — rows = tools sorted by total calls, columns = days
      </p>

      {/* Controls */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap', alignItems: 'center' }}>
        {/* Window selector */}
        <div style={{ display: 'flex', gap: 4 }}>
          {[7, 14, 30].map((w) => (
            <button
              key={w}
              onClick={() => setWindowDays(w)}
              style={{
                padding: '4px 12px',
                fontSize: 12,
                fontFamily: 'monospace',
                background: windowDays === w ? '#22d3ee20' : 'transparent',
                color: windowDays === w ? '#22d3ee' : '#64748b',
                border: `1px solid ${windowDays === w ? '#22d3ee60' : '#1e293b'}`,
                borderRadius: 4,
                cursor: 'pointer',
              }}
            >
              {w}d
            </button>
          ))}
        </div>

        {/* Project selector */}
        <select
          value={selectedSlug}
          onChange={(e) => setSelectedSlug(e.target.value)}
          style={{
            background: '#0a1628',
            border: '1px solid #1e3a5f',
            color: '#94a3b8',
            padding: '4px 8px',
            borderRadius: 4,
            fontSize: 12,
            fontFamily: 'monospace',
            cursor: 'pointer',
          }}
        >
          <option value="">All projects</option>
          {slugOptions.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>

        {/* MCD toggle */}
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#64748b', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={includeMcd}
            onChange={(e) => setIncludeMcd(e.target.checked)}
            style={{ accentColor: '#22d3ee' }}
          />
          include mcp__mcd__*
        </label>
      </div>

      {loading && <div style={{ color: '#475569', fontSize: 13, padding: '40px 0' }}>Loading…</div>}
      {!loading && error && <div style={{ color: '#f87171', fontSize: 13, padding: '40px 0' }}>Error: {error}</div>}
      {!loading && !error && tools.length === 0 && (
        <div style={{ color: '#475569', fontSize: 13, padding: '40px 0' }}>
          No tool calls found in the last {windowDays} days{selectedSlug ? ` for "${selectedSlug}"` : ''}.
          {!includeMcd && ' (mcp__mcd__* excluded)'}
        </div>
      )}

      {!loading && !error && tools.length > 0 && (
        <>
          {/* Top-5 bar chart */}
          <div style={{ background: '#0a1628', border: '1px solid #1e3a5f', borderRadius: 8, padding: '16px 20px', marginBottom: 20 }}>
            <div style={{ fontSize: 11, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>
              Top 5 Tools
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {top5.map(({ tool, total }, i) => {
                const maxTotal = top5[0]?.total ?? 1
                const pct = Math.round((total / maxTotal) * 100)
                return (
                  <div key={tool} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 11, color: '#64748b', width: 16, textAlign: 'right', flexShrink: 0 }}>
                      {i + 1}
                    </span>
                    <span style={{ fontSize: 12, color: '#94a3b8', width: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 0 }}>
                      {tool}
                    </span>
                    <div style={{ flex: 1, background: '#1e293b', borderRadius: 2, height: 8 }}>
                      <div style={{ width: `${pct}%`, height: 8, background: '#22d3ee', borderRadius: 2 }} />
                    </div>
                    <span style={{ fontSize: 12, color: '#22d3ee', width: 48, textAlign: 'right', flexShrink: 0 }}>
                      {total}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Heatmap */}
          <div style={{ background: '#0a1628', border: '1px solid #1e3a5f', borderRadius: 8, padding: 16, overflowX: 'auto', position: 'relative' }}>
            <svg
              width={svgW}
              height={svgH}
              style={{ display: 'block', overflow: 'visible' }}
            >
              {/* Day labels */}
              {dayLabels.map(({ idx, label }) => (
                <text
                  key={label}
                  x={ROW_LABEL_W + idx * (CELL_W + CELL_GAP) + CELL_W / 2}
                  y={HEADER_H - 6}
                  fontSize={8}
                  textAnchor="middle"
                  fill="#475569"
                  fontFamily="monospace"
                >
                  {label}
                </text>
              ))}

              {/* Rows */}
              {tools.map((tool, rowIdx) => {
                const y = HEADER_H + rowIdx * (CELL_H + CELL_GAP)
                return (
                  <g key={tool}>
                    {/* Tool label */}
                    <text
                      x={ROW_LABEL_W - 6}
                      y={y + CELL_H - 3}
                      fontSize={9}
                      textAnchor="end"
                      fill="#64748b"
                      fontFamily="monospace"
                    >
                      {tool.length > 28 ? `…${tool.slice(-27)}` : tool}
                    </text>

                    {/* Day cells */}
                    {days.map((day, colIdx) => {
                      const count = counts[tool]?.[day] ?? 0
                      const cx = ROW_LABEL_W + colIdx * (CELL_W + CELL_GAP)
                      return (
                        <rect
                          key={day}
                          x={cx}
                          y={y}
                          width={CELL_W}
                          height={CELL_H}
                          rx={2}
                          fill={cellColor(count)}
                          style={{ cursor: count > 0 ? 'pointer' : 'default' }}
                          onMouseEnter={(e) => {
                            const rect = (e.target as SVGRectElement).getBoundingClientRect()
                            setTooltip({ tool, day, count, x: rect.left + window.scrollX, y: rect.top + window.scrollY })
                          }}
                          onMouseLeave={() => setTooltip(null)}
                        />
                      )
                    })}
                  </g>
                )
              })}
            </svg>

            {/* Legend */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 12, fontSize: 11, color: '#475569' }}>
              <span>Less</span>
              {[0, 1, 3, 8, 12].map((n) => (
                <div
                  key={n}
                  style={{ width: CELL_W, height: CELL_H, borderRadius: 2, background: cellColor(n) }}
                />
              ))}
              <span>More</span>
            </div>
          </div>

          {/* Floating tooltip */}
          {tooltip && tooltip.count > 0 && (
            <div
              style={{
                position: 'fixed',
                left: tooltip.x + 16,
                top: tooltip.y - 8,
                background: '#0f172a',
                border: '1px solid #1e3a5f',
                borderRadius: 6,
                padding: '6px 10px',
                fontSize: 12,
                color: '#cbd5e1',
                pointerEvents: 'none',
                zIndex: 1000,
                whiteSpace: 'nowrap',
              }}
            >
              <div style={{ color: '#22d3ee', marginBottom: 2 }}>{tooltip.tool}</div>
              <div>{tooltip.day}</div>
              <div>{tooltip.count} call{tooltip.count !== 1 ? 's' : ''}</div>
            </div>
          )}
        </>
      )}

      {/* Footer */}
      <div style={{ color: '#334155', fontSize: 11, marginTop: 16 }}>
        {data && `${tools.length} tools · ${days.length}d window`}
        {data?.selectedSlug && ` · project: ${data.selectedSlug}`}
        {data?.generatedAt && ` · updated ${new Date(data.generatedAt).toLocaleTimeString()}`}
      </div>
    </div>
  )
}
