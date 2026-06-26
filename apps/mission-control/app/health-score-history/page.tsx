'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import SubPageHeader from '../../components/SubPageHeader'
import type { HealthScoreHistoryResponse, ProjectHistory, HealthSnapshot, ScoreBreakdown } from '../api/health-score-history/route'

// ── Color helpers ─────────────────────────────────────────────────────────────

const PALETTE = [
  '#22D3EE', '#F59E0B', '#A78BFA', '#34D399', '#FB923C',
  '#60A5FA', '#F472B6', '#4ADE80', '#FACC15', '#38BDF8',
]

function trendColor(trend: ProjectHistory['trend']): string {
  if (trend === 'improving') return '#22D3EE'
  if (trend === 'declining') return '#F59E0B'
  return '#94A3B8'
}

function trendLabel(trend: ProjectHistory['trend']): string {
  if (trend === 'improving') return '↑ Improving'
  if (trend === 'declining') return '↓ Declining'
  return '→ Flat'
}

function scoreColor(score: number): string {
  if (score >= 70) return '#22D3EE'
  if (score >= 40) return '#F59E0B'
  return '#EF4444'
}

// ── Multi-line area chart ─────────────────────────────────────────────────────

const PAD_L = 36
const PAD_R = 12
const PAD_T = 12
const PAD_B = 28

interface ChartPoint { x: number; y: number; snap: HealthSnapshot; slug: string; lineColor: string }

interface AreaChartProps {
  projects: ProjectHistory[]
  visibleSlugs: Set<string>
  width: number
  height: number
  onSelect: (slug: string, snap: HealthSnapshot) => void
}

function AreaChart({ projects, visibleSlugs, width, height, onSelect }: AreaChartProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [hover, setHover] = useState<ChartPoint | null>(null)

  const chartW = width - PAD_L - PAD_R
  const chartH = height - PAD_T - PAD_B

  const visible = projects.filter((p) => visibleSlugs.has(p.slug))
  if (visible.length === 0) {
    return (
      <svg width={width} height={height} style={{ display: 'block' }}>
        <text x={width / 2} y={height / 2} textAnchor="middle" fill="#374151" fontSize={12} fontFamily="monospace">No projects selected</text>
      </svg>
    )
  }

  const dateCount = visible[0]?.history.length ?? 30
  const step = chartW / Math.max(dateCount - 1, 1)

  function toX(i: number) { return PAD_L + i * step }
  function toY(score: number) { return PAD_T + chartH - (Math.max(0, Math.min(100, score)) / 100) * chartH }

  // Y gridlines
  const gridLines = [0, 25, 50, 75, 100]

  // X-axis labels: show every 7th date
  const dates = visible[0]?.history.map((h) => h.date) ?? []
  const labelIdxs = dates.reduce<number[]>((acc, _d, i) => {
    if (i === 0 || i === dates.length - 1 || i % 7 === 0) acc.push(i)
    return acc
  }, [])

  // Build hit-test points
  const hitPoints: ChartPoint[] = []
  visible.forEach((p, pi) => {
    const col = PALETTE[pi % PALETTE.length]
    p.history.forEach((snap, i) => {
      hitPoints.push({ x: toX(i), y: toY(snap.score), snap, slug: p.slug, lineColor: col })
    })
  })

  function handleMouseMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    // Find nearest hit point
    let best: ChartPoint | null = null
    let bestDist = Infinity
    for (const pt of hitPoints) {
      const d = Math.abs(pt.x - mx) + Math.abs(pt.y - my)
      if (d < bestDist) { bestDist = d; best = pt }
    }
    if (best && bestDist < 30) {
      setHover(best)
    } else {
      setHover(null)
    }
  }

  return (
    <div style={{ position: 'relative' }}>
      <svg
        ref={svgRef}
        width={width}
        height={height}
        style={{ display: 'block', cursor: 'crosshair' }}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHover(null)}
        onClick={() => { if (hover) onSelect(hover.slug, hover.snap) }}
      >
        {/* Gridlines */}
        {gridLines.map((v) => (
          <g key={v}>
            <line
              x1={PAD_L} y1={toY(v)} x2={PAD_L + chartW} y2={toY(v)}
              stroke="#1E293B" strokeWidth={1}
            />
            <text x={PAD_L - 4} y={toY(v) + 4} textAnchor="end" fill="#374151" fontSize={8} fontFamily="monospace">{v}</text>
          </g>
        ))}

        {/* X-axis labels */}
        {labelIdxs.map((i) => (
          <text key={i} x={toX(i)} y={PAD_T + chartH + 16} textAnchor="middle" fill="#374151" fontSize={7} fontFamily="monospace">
            {dates[i]?.slice(5) ?? ''}
          </text>
        ))}

        {/* Lines + areas */}
        {visible.map((p, pi) => {
          const col = PALETTE[pi % PALETTE.length]
          const pts = p.history.map((h, i) => `${toX(i).toFixed(1)},${toY(h.score).toFixed(1)}`).join(' ')
          const areaPath = `M${toX(0).toFixed(1)},${(PAD_T + chartH).toFixed(1)} ` +
            p.history.map((h, i) => `L${toX(i).toFixed(1)},${toY(h.score).toFixed(1)}`).join(' ') +
            ` L${toX(p.history.length - 1).toFixed(1)},${(PAD_T + chartH).toFixed(1)} Z`

          return (
            <g key={p.slug}>
              <path d={areaPath} fill={col} opacity={0.06} />
              <polyline
                points={pts}
                fill="none"
                stroke={col}
                strokeWidth={1.5}
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity={hover && hover.slug !== p.slug ? 0.25 : 0.9}
                style={{ filter: hover?.slug === p.slug ? `drop-shadow(0 0 3px ${col}88)` : undefined }}
              />
            </g>
          )
        })}

        {/* Hover indicator */}
        {hover && (
          <>
            <line
              x1={hover.x} y1={PAD_T} x2={hover.x} y2={PAD_T + chartH}
              stroke="#FFFFFF18" strokeWidth={1} strokeDasharray="3 3"
            />
            <circle cx={hover.x} cy={hover.y} r={4} fill={hover.lineColor} opacity={0.9}
              style={{ filter: `drop-shadow(0 0 4px ${hover.lineColor})` }}
            />
          </>
        )}
      </svg>

      {/* Tooltip */}
      {hover && (
        <div style={{
          position: 'absolute',
          bottom: height - hover.y + 8,
          left: Math.min(hover.x + 8, width - 180),
          background: '#0f172a',
          border: `1px solid ${hover.lineColor}50`,
          borderRadius: 6,
          padding: '7px 10px',
          pointerEvents: 'none',
          zIndex: 50,
          minWidth: 160,
        }}>
          <div style={{ fontSize: 9, color: '#64748B', fontFamily: 'monospace', marginBottom: 2 }}>{hover.snap.date}</div>
          <div style={{ fontSize: 11, color: hover.lineColor, fontFamily: 'monospace', fontWeight: 'bold', marginBottom: 3 }}>
            {hover.slug} — {hover.snap.score}
          </div>
          <div style={{ fontSize: 9, color: '#94A3B8', fontFamily: 'monospace' }}>
            Mem:{hover.snap.breakdown.memoryScore} Act:{hover.snap.breakdown.activityScore}{' '}
            Rec:{hover.snap.breakdown.recencyScore} Stb:{hover.snap.breakdown.stabilityScore}{' '}
            Prop:{hover.snap.breakdown.proposalScore}
          </div>
          <div style={{ fontSize: 8, color: '#475569', fontFamily: 'monospace', marginTop: 3 }}>click to expand</div>
        </div>
      )}
    </div>
  )
}

// ── Side panel ────────────────────────────────────────────────────────────────

interface SidePanelProps { slug: string; snap: HealthSnapshot; onClose: () => void }

function BreakdownBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
        <span style={{ color: '#94A3B8', fontSize: 11, fontFamily: 'monospace' }}>{label}</span>
        <span style={{ color, fontSize: 11, fontFamily: 'monospace', fontWeight: 'bold' }}>{value}/{max}</span>
      </div>
      <div style={{ background: '#1E293B', borderRadius: 3, height: 6, overflow: 'hidden' }}>
        <div style={{ background: color, height: '100%', width: `${(value / max) * 100}%`, borderRadius: 3,
          boxShadow: `0 0 6px ${color}88` }} />
      </div>
    </div>
  )
}

function SidePanel({ slug, snap, onClose }: SidePanelProps) {
  const sc = scoreColor(snap.score)
  return (
    <div style={{
      position: 'fixed', top: 0, right: 0, height: '100vh', width: 320,
      background: '#080F1E', borderLeft: '1px solid #1E3A5F',
      overflowY: 'auto', zIndex: 200, padding: '20px 20px',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div>
          <div style={{ color: '#64748B', fontSize: 10, fontFamily: 'monospace', marginBottom: 4 }}>{snap.date}</div>
          <div style={{ color: '#E2E8F0', fontSize: 14, fontFamily: 'monospace', fontWeight: 'bold' }}>{slug}</div>
        </div>
        <button onClick={onClose} style={{
          background: 'transparent', border: '1px solid #1E3A5F', color: '#94A3B8',
          borderRadius: 4, padding: '4px 8px', cursor: 'pointer', fontSize: 12, fontFamily: 'monospace',
        }}>✕</button>
      </div>

      {/* Overall score */}
      <div style={{
        background: `${sc}12`, border: `1px solid ${sc}40`, borderRadius: 8,
        padding: '12px 16px', marginBottom: 20, textAlign: 'center',
      }}>
        <div style={{ color: sc, fontSize: 36, fontFamily: 'monospace', fontWeight: 'bold',
          textShadow: `0 0 12px ${sc}88` }}>{snap.score}</div>
        <div style={{ color: sc, fontSize: 11, fontFamily: 'monospace', opacity: 0.7 }}>
          {snap.score >= 70 ? 'Healthy' : snap.score >= 40 ? 'At Risk' : 'Critical'}
        </div>
      </div>

      {/* Breakdown */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ color: '#475569', fontSize: 10, fontFamily: 'monospace', marginBottom: 12,
          textTransform: 'uppercase', letterSpacing: '0.05em' }}>Score Breakdown</div>
        <BreakdownBar label="Memory" value={snap.breakdown.memoryScore} max={25} color="#22D3EE" />
        <BreakdownBar label="Activity" value={snap.breakdown.activityScore} max={25} color="#A78BFA" />
        <BreakdownBar label="Recency" value={snap.breakdown.recencyScore} max={20} color="#34D399" />
        <BreakdownBar label="Stability" value={snap.breakdown.stabilityScore} max={20} color="#F59E0B" />
        <BreakdownBar label="Proposals" value={snap.breakdown.proposalScore} max={10} color="#FB923C" />
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function HealthScoreHistoryPage() {
  const [data, setData] = useState<HealthScoreHistoryResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [visibleSlugs, setVisibleSlugs] = useState<Set<string>>(new Set())
  const [selected, setSelected] = useState<{ slug: string; snap: HealthSnapshot } | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [chartWidth, setChartWidth] = useState(860)

  useEffect(() => {
    void fetch('/api/health-score-history')
      .then((r) => { if (!r.ok) throw new Error(r.statusText); return r.json() })
      .then((d: HealthScoreHistoryResponse) => {
        setData(d)
        // Default: top 10 by variance
        const top10 = d.projects.slice(0, 10).map((p) => p.slug)
        setVisibleSlugs(new Set(top10))
        setLoading(false)
      })
      .catch((e: Error) => { setError(e.message); setLoading(false) })
  }, [])

  useEffect(() => {
    if (!containerRef.current) return
    const obs = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width
      if (w) setChartWidth(Math.max(400, w - 32))
    })
    obs.observe(containerRef.current)
    return () => obs.disconnect()
  }, [])

  function toggleSlug(slug: string) {
    setVisibleSlugs((prev) => {
      const next = new Set(prev)
      if (next.has(slug)) next.delete(slug)
      else next.add(slug)
      return next
    })
  }

  if (loading) return (
    <div style={{ background: '#080F1E', minHeight: '100vh', fontFamily: 'monospace' }}>
      <SubPageHeader title="Health Score History" />
      <div style={{ padding: '40px 24px', color: '#475569', fontSize: 13 }}>Loading snapshots…</div>
    </div>
  )

  if (error) return (
    <div style={{ background: '#080F1E', minHeight: '100vh', fontFamily: 'monospace' }}>
      <SubPageHeader title="Health Score History" />
      <div style={{ padding: '40px 24px', color: '#EF4444', fontSize: 13 }}>Error: {error}</div>
    </div>
  )

  if (!data || data.projects.length === 0) return (
    <div style={{ background: '#080F1E', minHeight: '100vh', fontFamily: 'monospace' }}>
      <SubPageHeader title="Health Score History" />
      <div style={{ padding: '60px 24px', textAlign: 'center', color: '#475569', fontSize: 13 }}>
        No snapshot data yet — check back after the first daily capture.
      </div>
    </div>
  )

  const allProjects = data.projects
  const maxHistory = allProjects[0]?.history.length ?? 0
  const hasEnough = maxHistory >= 2

  return (
    <div style={{ background: '#080F1E', minHeight: '100vh', fontFamily: 'monospace' }} ref={containerRef}>
      <SubPageHeader title="Health Score History" />

      <div style={{ padding: '16px 24px' }}>
        {/* Header stats */}
        <div style={{ display: 'flex', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
          <div style={{ background: '#0D1829', border: '1px solid #1E3A5F', borderRadius: 8, padding: '10px 16px' }}>
            <div style={{ color: '#475569', fontSize: 10 }}>Projects</div>
            <div style={{ color: '#E2E8F0', fontSize: 18, fontWeight: 'bold' }}>{allProjects.length}</div>
          </div>
          <div style={{ background: '#0D1829', border: '1px solid #1E3A5F', borderRadius: 8, padding: '10px 16px' }}>
            <div style={{ color: '#475569', fontSize: 10 }}>Improving</div>
            <div style={{ color: '#22D3EE', fontSize: 18, fontWeight: 'bold' }}>
              {allProjects.filter((p) => p.trend === 'improving').length}
            </div>
          </div>
          <div style={{ background: '#0D1829', border: '1px solid #1E3A5F', borderRadius: 8, padding: '10px 16px' }}>
            <div style={{ color: '#475569', fontSize: 10 }}>Declining</div>
            <div style={{ color: '#F59E0B', fontSize: 18, fontWeight: 'bold' }}>
              {allProjects.filter((p) => p.trend === 'declining').length}
            </div>
          </div>
          <div style={{ background: '#0D1829', border: '1px solid #1E3A5F', borderRadius: 8, padding: '10px 16px' }}>
            <div style={{ color: '#475569', fontSize: 10 }}>Days of data</div>
            <div style={{ color: '#E2E8F0', fontSize: 18, fontWeight: 'bold' }}>{maxHistory}</div>
          </div>
        </div>

        {!hasEnough && (
          <div style={{
            background: '#F59E0B10', border: '1px solid #F59E0B30', borderRadius: 8,
            padding: '10px 16px', marginBottom: 20, color: '#F59E0B', fontSize: 12,
          }}>
            Less than 2 days of data — trends will appear once multiple snapshots are captured.
          </div>
        )}

        {/* Chart + filter */}
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
          {/* Chart */}
          <div style={{ flex: 1, background: '#0D1829', border: '1px solid #1E3A5F', borderRadius: 10, padding: '16px 8px 8px' }}>
            <AreaChart
              projects={allProjects}
              visibleSlugs={visibleSlugs}
              width={chartWidth}
              height={280}
              onSelect={(slug, snap) => setSelected({ slug, snap })}
            />
          </div>

          {/* Legend + filters */}
          <div style={{
            width: 200, background: '#0D1829', border: '1px solid #1E3A5F', borderRadius: 10,
            padding: '14px 12px', flexShrink: 0, maxHeight: 312, overflowY: 'auto',
          }}>
            <div style={{ color: '#475569', fontSize: 10, marginBottom: 10,
              textTransform: 'uppercase', letterSpacing: '0.05em' }}>Projects</div>
            <div style={{ marginBottom: 8 }}>
              <button
                onClick={() => setVisibleSlugs(new Set(allProjects.map((p) => p.slug)))}
                style={{ fontSize: 9, color: '#22D3EE', background: 'transparent', border: 'none', cursor: 'pointer',
                  fontFamily: 'monospace', padding: 0, marginRight: 10 }}>all</button>
              <button
                onClick={() => setVisibleSlugs(new Set())}
                style={{ fontSize: 9, color: '#94A3B8', background: 'transparent', border: 'none', cursor: 'pointer',
                  fontFamily: 'monospace', padding: 0 }}>none</button>
            </div>
            {allProjects.map((p, pi) => {
              const col = visibleSlugs.has(p.slug) ? PALETTE[pi % PALETTE.length] : '#374151'
              const tc = trendColor(p.trend)
              return (
                <div
                  key={p.slug}
                  onClick={() => toggleSlug(p.slug)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6, marginBottom: 7,
                    cursor: 'pointer', padding: '3px 4px', borderRadius: 4,
                    background: visibleSlugs.has(p.slug) ? '#FFFFFF06' : 'transparent',
                    opacity: visibleSlugs.has(p.slug) ? 1 : 0.45,
                  }}
                >
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: col, flexShrink: 0,
                    boxShadow: visibleSlugs.has(p.slug) ? `0 0 6px ${col}88` : 'none' }} />
                  <span style={{ color: '#CBD5E1', fontSize: 10, fontFamily: 'monospace', flex: 1, overflow: 'hidden',
                    textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.slug}</span>
                  <span style={{ color: tc, fontSize: 8, fontFamily: 'monospace', flexShrink: 0 }}>
                    {p.trend === 'improving' ? '↑' : p.trend === 'declining' ? '↓' : '→'}
                  </span>
                </div>
              )
            })}
          </div>
        </div>

        {/* Trend summary table */}
        <div style={{ marginTop: 20, background: '#0D1829', border: '1px solid #1E3A5F', borderRadius: 10, overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid #1E293B',
            color: '#475569', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Project Trends (30 days)
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #1E293B' }}>
                {['Project', 'Latest Score', 'Trend', 'Variance'].map((h) => (
                  <th key={h} style={{ padding: '8px 16px', textAlign: 'left', color: '#475569', fontSize: 10,
                    fontFamily: 'monospace', fontWeight: 'normal' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {allProjects.map((p) => {
                const latest = p.history[p.history.length - 1]
                const sc = scoreColor(latest?.score ?? 0)
                const tc = trendColor(p.trend)
                return (
                  <tr key={p.slug} style={{ borderBottom: '1px solid #0D1829' }}>
                    <td style={{ padding: '7px 16px', color: '#CBD5E1', fontSize: 11, fontFamily: 'monospace' }}>{p.slug}</td>
                    <td style={{ padding: '7px 16px', color: sc, fontSize: 11, fontFamily: 'monospace', fontWeight: 'bold' }}>
                      {latest?.score ?? '—'}
                    </td>
                    <td style={{ padding: '7px 16px', color: tc, fontSize: 11, fontFamily: 'monospace' }}>
                      {trendLabel(p.trend)}
                    </td>
                    <td style={{ padding: '7px 16px', color: '#64748B', fontSize: 11, fontFamily: 'monospace' }}>
                      {p.variance.toFixed(1)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {selected && (
        <SidePanel
          slug={selected.slug}
          snap={selected.snap}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  )
}
