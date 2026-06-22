'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import Link from 'next/link'
import type { HealthTrendsResponse, ProjectTrend, DailyHealthPoint } from '../api/health/trends/route'

// ── Helpers ──────────────────────────────────────────────────────────────────

function scoreColor(score: number): string {
  if (score < 0) return '#4B5563'
  if (score >= 70) return '#4ADE80'
  if (score >= 40) return '#F59E0B'
  return '#EF4444'
}

function trendArrowChar(arrow: ProjectTrend['trendArrow']): string {
  return arrow === 'up' ? '↑' : arrow === 'down' ? '↓' : '→'
}

function trendArrowColor(color: ProjectTrend['trendColor']): string {
  return color === 'green' ? '#4ADE80' : color === 'red' ? '#EF4444' : '#6B7280'
}

type SortKey = 'score' | 'trend' | 'slug'

// ── MiniSparkline ─────────────────────────────────────────────────────────────

interface SparklineInteractiveProps {
  daily: DailyHealthPoint[]
  color: string
  width: number
  height: number
}

function SparklineInteractive({ daily, color, width, height }: SparklineInteractiveProps) {
  const [tooltip, setTooltip] = useState<{ x: number; y: number; pt: DailyHealthPoint } | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)

  const validPts = daily.filter((d) => d.score >= 0)
  if (validPts.length === 0) {
    return (
      <svg width={width} height={height} style={{ flexShrink: 0 }}>
        <text x={width / 2} y={height / 2 + 4} textAnchor="middle" fill="#374151" fontSize={9} fontFamily="monospace">no data</text>
      </svg>
    )
  }

  const scores = daily.map((d) => d.score)
  const max = Math.max(...scores.filter((s) => s >= 0), 1)
  const step = width / (daily.length - 1)

  const points = daily
    .map((d, i) => {
      const y = d.score < 0
        ? height - 1
        : height - (d.score / max) * (height - 4) - 2
      return `${i * step},${y}`
    })
    .join(' ')

  function handleMouseMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return
    const mx = e.clientX - rect.left
    const idx = Math.round(mx / step)
    const clamped = Math.max(0, Math.min(daily.length - 1, idx))
    const pt = daily[clamped]
    const px = clamped * step
    const py = pt.score < 0 ? height - 1 : height - (pt.score / max) * (height - 4) - 2
    setTooltip({ x: px, y: py, pt })
  }

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <svg
        ref={svgRef}
        width={width}
        height={height}
        style={{ flexShrink: 0, cursor: 'crosshair' }}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setTooltip(null)}
      >
        <polyline
          points={points}
          fill="none"
          stroke={color}
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={0.85}
        />
        {tooltip && (
          <circle cx={tooltip.x} cy={tooltip.y} r={3} fill={color} />
        )}
      </svg>
      {tooltip && (
        <div style={{
          position: 'absolute',
          bottom: height + 4,
          left: Math.min(tooltip.x - 10, width - 130),
          background: '#0f172a',
          border: '1px solid #334155',
          borderRadius: 6,
          padding: '5px 8px',
          pointerEvents: 'none',
          zIndex: 50,
          minWidth: 130,
        }}>
          <div style={{ fontSize: 9, color: '#64748B', fontFamily: 'monospace', marginBottom: 3 }}>{tooltip.pt.date}</div>
          <div style={{ fontSize: 10, color: scoreColor(tooltip.pt.score), fontFamily: 'monospace', fontWeight: 'bold' }}>
            Score: {tooltip.pt.score < 0 ? '—' : tooltip.pt.score}
          </div>
          <div style={{ fontSize: 9, color: '#94A3B8', fontFamily: 'monospace' }}>
            <span style={{ color: '#22D3EE' }}>R</span>{tooltip.pt.recency}{' '}
            <span style={{ color: '#F59E0B' }}>S</span>{tooltip.pt.stallRate}{' '}
            <span style={{ color: '#A78BFA' }}>E</span>{tooltip.pt.efficiency}{' '}
            <span style={{ color: '#34D399' }}>F</span>{tooltip.pt.freshness}
          </div>
        </div>
      )}
    </div>
  )
}

// ── MultiLineChart ────────────────────────────────────────────────────────────

interface MultiLineChartProps {
  daily: DailyHealthPoint[]
  width: number
  height: number
}

const SUB_LINES = [
  { key: 'recency' as keyof DailyHealthPoint, label: 'Recency', color: '#22D3EE' },
  { key: 'stallRate' as keyof DailyHealthPoint, label: 'Stall Rate', color: '#F59E0B' },
  { key: 'efficiency' as keyof DailyHealthPoint, label: 'Efficiency', color: '#A78BFA' },
  { key: 'freshness' as keyof DailyHealthPoint, label: 'Freshness', color: '#34D399' },
  { key: 'score' as keyof DailyHealthPoint, label: 'Overall', color: '#FFFFFF' },
]

function MultiLineChart({ daily, width, height }: MultiLineChartProps) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const PAD_L = 28
  const PAD_R = 8
  const PAD_T = 8
  const PAD_B = 16
  const chartW = width - PAD_L - PAD_R
  const chartH = height - PAD_T - PAD_B

  const validDaily = daily.filter((d) => d.score >= 0)
  const step = chartW / (daily.length - 1)

  function handleMouseMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return
    const mx = e.clientX - rect.left - PAD_L
    const idx = Math.round(mx / step)
    setHoverIdx(Math.max(0, Math.min(daily.length - 1, idx)))
  }

  const hoverPt = hoverIdx !== null ? daily[hoverIdx] : null

  return (
    <div style={{ position: 'relative' }}>
      <svg
        ref={svgRef}
        width={width}
        height={height}
        style={{ cursor: 'crosshair' }}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoverIdx(null)}
      >
        {/* Y axis labels */}
        {[0, 25, 50, 75, 100].map((v) => {
          const y = PAD_T + chartH - (v / 100) * chartH
          return (
            <g key={v}>
              <line x1={PAD_L} y1={y} x2={PAD_L + chartW} y2={y} stroke="#1E293B" strokeWidth={1} />
              <text x={PAD_L - 3} y={y + 3} textAnchor="end" fill="#374151" fontSize={8} fontFamily="monospace">{v}</text>
            </g>
          )
        })}

        {/* Data lines */}
        {SUB_LINES.map(({ key, color }) => {
          const pts = daily
            .map((d, i) => {
              const val = d[key] as number
              if (val < 0) return null
              const x = PAD_L + i * step
              const y = PAD_T + chartH - (val / 100) * chartH
              return `${x},${y}`
            })
            .filter(Boolean)
            .join(' ')
          if (!pts) return null
          return (
            <polyline
              key={key}
              points={pts}
              fill="none"
              stroke={color}
              strokeWidth={key === 'score' ? 2 : 1.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={key === 'score' ? 0.9 : 0.6}
            />
          )
        })}

        {/* Hover line */}
        {hoverIdx !== null && (
          <line
            x1={PAD_L + hoverIdx * step}
            y1={PAD_T}
            x2={PAD_L + hoverIdx * step}
            y2={PAD_T + chartH}
            stroke="#334155"
            strokeWidth={1}
          />
        )}
        {hoverIdx !== null && hoverPt && SUB_LINES.map(({ key, color }) => {
          const val = hoverPt[key] as number
          if (val < 0) return null
          const x = PAD_L + hoverIdx * step
          const y = PAD_T + chartH - (val / 100) * chartH
          return <circle key={key} cx={x} cy={y} r={3} fill={color} />
        })}

        {/* X axis date ticks */}
        {daily.filter((_, i) => i % 5 === 0 || i === daily.length - 1).map((d, _, arr) => {
          const i = daily.indexOf(d)
          const x = PAD_L + i * step
          return (
            <text key={d.date} x={x} y={PAD_T + chartH + 11} textAnchor="middle" fill="#374151" fontSize={7} fontFamily="monospace">
              {d.date.slice(5)}
            </text>
          )
        })}
      </svg>

      {/* Hover tooltip */}
      {hoverPt && (
        <div style={{
          position: 'absolute',
          top: PAD_T,
          left: Math.min(PAD_L + hoverIdx! * step + 8, width - 140),
          background: '#0f172a',
          border: '1px solid #334155',
          borderRadius: 6,
          padding: '5px 8px',
          pointerEvents: 'none',
          zIndex: 50,
          minWidth: 130,
        }}>
          <div style={{ fontSize: 9, color: '#64748B', fontFamily: 'monospace', marginBottom: 3 }}>{hoverPt.date}</div>
          {SUB_LINES.map(({ key, label, color }) => (
            <div key={key} style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <span style={{ fontSize: 9, color, fontFamily: 'monospace' }}>{label}</span>
              <span style={{ fontSize: 9, color: '#CBD5E1', fontFamily: 'monospace' }}>
                {(hoverPt[key] as number) < 0 ? '—' : hoverPt[key] as number}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function HealthTrendsPage() {
  const [data, setData] = useState<HealthTrendsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<SortKey>('score')
  const [deepDive, setDeepDive] = useState<string | null>(null)

  const fetchData = useCallback(() => {
    setLoading(true)
    fetch('/api/health/trends')
      .then((r) => r.json() as Promise<HealthTrendsResponse>)
      .then((d) => { setData(d); setLoading(false) })
      .catch((e) => { setError(String(e)); setLoading(false) })
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  function exportCsv() {
    if (!data) return
    const allDates = data.projects[0]?.daily.map((d) => d.date) ?? []
    const header = ['slug', ...allDates].join(',')
    const rows = data.projects.map((p) =>
      [p.slug, ...p.daily.map((d) => d.score < 0 ? '' : String(d.score))].join(',')
    )
    const csv = [header, ...rows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `health-trends-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const sorted = data
    ? [...data.projects].sort((a, b) => {
        if (sortKey === 'score') return b.currentScore - a.currentScore
        if (sortKey === 'trend') return Math.abs(b.trendDelta) - Math.abs(a.trendDelta)
        return a.slug.localeCompare(b.slug)
      })
    : []

  const deepProject = data?.projects.find((p) => p.slug === deepDive)

  return (
    <div style={{ minHeight: '100vh', background: '#050d1a', color: '#E2E8F0', fontFamily: "'JetBrains Mono', monospace" }}>
      {/* Header */}
      <div style={{
        position: 'sticky',
        top: 0,
        zIndex: 40,
        background: 'rgba(5,13,26,0.96)',
        borderBottom: '1px solid rgba(0,245,255,0.08)',
        padding: '10px 20px',
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        flexWrap: 'wrap',
      }}>
        <Link href="/" style={{ color: '#4ADE80', fontSize: 11, textDecoration: 'none', opacity: 0.7 }}>← Home</Link>
        <span style={{ color: '#00F5FF', fontSize: 13, fontWeight: 'bold', letterSpacing: '0.05em' }}>
          Agent Health Trends
        </span>
        {data && (
          <span style={{ fontSize: 10, color: '#475569' }}>
            {data.projects.length} projects · 30d · {new Date(data.checkedAt).toLocaleTimeString()}
          </span>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {/* Sort */}
          <div style={{ display: 'flex', gap: 4 }}>
            {(['score', 'trend', 'slug'] as SortKey[]).map((k) => (
              <button
                key={k}
                onClick={() => setSortKey(k)}
                style={{
                  fontSize: 9,
                  fontFamily: 'monospace',
                  padding: '3px 8px',
                  borderRadius: 4,
                  border: `1px solid ${sortKey === k ? '#00F5FF' : '#1E293B'}`,
                  background: sortKey === k ? 'rgba(0,245,255,0.08)' : 'transparent',
                  color: sortKey === k ? '#00F5FF' : '#64748B',
                  cursor: 'pointer',
                }}
              >
                {k === 'score' ? '↓ Score' : k === 'trend' ? '↓ Trend' : 'A–Z'}
              </button>
            ))}
          </div>
          <button
            onClick={exportCsv}
            style={{
              fontSize: 9,
              fontFamily: 'monospace',
              padding: '3px 8px',
              borderRadius: 4,
              border: '1px solid #1E293B',
              background: 'transparent',
              color: '#64748B',
              cursor: 'pointer',
            }}
          >
            ⬇ CSV
          </button>
          <button
            onClick={fetchData}
            style={{
              fontSize: 9,
              fontFamily: 'monospace',
              padding: '3px 8px',
              borderRadius: 4,
              border: '1px solid #1E293B',
              background: 'transparent',
              color: '#64748B',
              cursor: 'pointer',
            }}
          >
            ↺ Refresh
          </button>
        </div>
      </div>

      <div style={{ padding: '16px 20px', maxWidth: 1200, margin: '0 auto' }}>

        {/* Legend */}
        <div style={{ display: 'flex', gap: 16, marginBottom: 12, flexWrap: 'wrap' }}>
          {[
            { label: 'Recency', color: '#22D3EE' },
            { label: 'Stall Rate', color: '#F59E0B' },
            { label: 'Efficiency', color: '#A78BFA' },
            { label: 'Freshness', color: '#34D399' },
            { label: 'Overall', color: '#FFFFFF' },
          ].map(({ label, color }) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <div style={{ width: 12, height: 2, background: color, opacity: 0.8 }} />
              <span style={{ fontSize: 9, color: '#64748B' }}>{label}</span>
            </div>
          ))}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 12 }}>
            <span style={{ fontSize: 9, color: '#4ADE80' }}>↑ improving ≥5pts/7d</span>
            <span style={{ fontSize: 9, color: '#EF4444' }}>↓ declining</span>
            <span style={{ fontSize: 9, color: '#6B7280' }}>→ flat</span>
          </div>
        </div>

        {/* States */}
        {loading && <div style={{ color: '#475569', fontSize: 12, padding: '40px 0', textAlign: 'center' }}>Loading trends…</div>}
        {error && <div style={{ color: '#EF4444', fontSize: 12, padding: '40px 0', textAlign: 'center' }}>Error: {error}</div>}

        {/* Deep-dive panel */}
        {deepProject && (
          <div style={{
            background: '#0a1628',
            border: '1px solid rgba(0,245,255,0.15)',
            borderRadius: 10,
            padding: 16,
            marginBottom: 20,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
              <span style={{ fontSize: 13, color: '#00F5FF', fontWeight: 'bold' }}>{deepProject.slug}</span>
              <span style={{ fontSize: 10, color: '#64748B' }}>30-day sub-score breakdown</span>
              <button
                onClick={() => setDeepDive(null)}
                style={{ marginLeft: 'auto', fontSize: 10, color: '#64748B', background: 'none', border: 'none', cursor: 'pointer' }}
              >
                ✕ Close
              </button>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <MultiLineChart daily={deepProject.daily} width={900} height={200} />
            </div>
          </div>
        )}

        {/* Sparkline table */}
        {!loading && data && (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(0,245,255,0.08)' }}>
                  <th style={{ padding: '6px 12px', textAlign: 'left', fontSize: 9, color: '#475569', fontWeight: 'normal' }}>PROJECT</th>
                  <th style={{ padding: '6px 12px', textAlign: 'left', fontSize: 9, color: '#475569', fontWeight: 'normal' }}>30-DAY HEALTH</th>
                  <th style={{ padding: '6px 12px', textAlign: 'right', fontSize: 9, color: '#475569', fontWeight: 'normal' }}>CURRENT</th>
                  <th style={{ padding: '6px 12px', textAlign: 'center', fontSize: 9, color: '#475569', fontWeight: 'normal' }}>TREND</th>
                  <th style={{ padding: '6px 12px', textAlign: 'center', fontSize: 9, color: '#475569', fontWeight: 'normal' }}>DEEP DIVE</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((p) => {
                  const isDeep = deepDive === p.slug
                  const sparkColor = p.currentScore >= 70 ? '#4ADE80' : p.currentScore >= 40 ? '#F59E0B' : p.currentScore < 0 ? '#374151' : '#EF4444'
                  return (
                    <tr
                      key={p.slug}
                      style={{
                        borderBottom: '1px solid rgba(0,245,255,0.04)',
                        background: isDeep ? 'rgba(0,245,255,0.04)' : 'transparent',
                        transition: 'background 0.15s',
                      }}
                      onMouseEnter={(e) => {
                        if (!isDeep) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.02)'
                      }}
                      onMouseLeave={(e) => {
                        if (!isDeep) (e.currentTarget as HTMLElement).style.background = 'transparent'
                      }}
                    >
                      {/* Slug */}
                      <td style={{ padding: '8px 12px' }}>
                        <Link
                          href={`/projects/${p.slug}`}
                          style={{ color: '#00F5FF', textDecoration: 'none', fontSize: 11 }}
                        >
                          {p.slug}
                        </Link>
                        {p.insufficientData && (
                          <span style={{ fontSize: 8, color: '#4B5563', marginLeft: 4 }}>insufficient data</span>
                        )}
                      </td>

                      {/* Sparkline */}
                      <td style={{ padding: '8px 12px' }}>
                        <SparklineInteractive
                          daily={p.daily}
                          color={sparkColor}
                          width={180}
                          height={28}
                        />
                      </td>

                      {/* Current score */}
                      <td style={{ padding: '8px 12px', textAlign: 'right' }}>
                        <span style={{
                          color: scoreColor(p.currentScore),
                          fontWeight: 'bold',
                          fontSize: 12,
                        }}>
                          {p.currentScore < 0 ? '—' : p.currentScore}
                        </span>
                      </td>

                      {/* Trend arrow */}
                      <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                        <span style={{ color: trendArrowColor(p.trendColor), fontSize: 14 }}>
                          {trendArrowChar(p.trendArrow)}
                        </span>
                        <span style={{ fontSize: 9, color: '#4B5563', marginLeft: 4 }}>
                          {p.trendDelta > 0 ? '+' : ''}{p.trendDelta}
                        </span>
                      </td>

                      {/* Deep dive toggle */}
                      <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                        <button
                          onClick={() => setDeepDive(isDeep ? null : p.slug)}
                          style={{
                            fontSize: 9,
                            padding: '2px 8px',
                            borderRadius: 4,
                            border: `1px solid ${isDeep ? '#00F5FF' : '#1E293B'}`,
                            background: isDeep ? 'rgba(0,245,255,0.08)' : 'transparent',
                            color: isDeep ? '#00F5FF' : '#64748B',
                            cursor: 'pointer',
                          }}
                        >
                          {isDeep ? '▲ hide' : '▼ dive'}
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>

            {sorted.length === 0 && (
              <div style={{ color: '#374151', fontSize: 12, padding: '40px', textAlign: 'center' }}>
                No projects found.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
