'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import SubPageHeader from '../../components/SubPageHeader'
import type { MemoryStalenessResponse, ProjectStaleness, StalenessAxes } from '../api/memory-staleness/route'

const AXES: Array<{ key: keyof StalenessAxes; label: string; desc: string }> = [
  { key: 'freshness', label: 'Freshness', desc: 'Newest memory age (lower=better)' },
  { key: 'density', label: 'Density', desc: 'Memories added per week' },
  { key: 'diversity', label: 'Diversity', desc: 'Distinct memory types present' },
  { key: 'depth', label: 'Depth', desc: 'Avg body word count' },
  { key: 'coverage', label: 'Coverage', desc: 'Memory count vs transcript turns' },
]

const PALETTE = [
  '#22D3EE', '#A855F7', '#F59E0B', '#10B981', '#EF4444',
  '#3B82F6', '#EC4899', '#14B8A6', '#F97316', '#8B5CF6',
  '#84CC16', '#F43F5E', '#06B6D4', '#D97706', '#7C3AED',
]

function hashSlug(slug: string): number {
  let h = 0
  for (const c of slug) h = (Math.imul(31, h) + c.charCodeAt(0)) | 0
  return Math.abs(h)
}

function slugColor(slug: string): string {
  return PALETTE[hashSlug(slug) % PALETTE.length]
}

function stalenessLabel(score: number): string {
  if (score >= 70) return 'Fresh'
  if (score >= 40) return 'Aging'
  return 'Stale'
}

function stalenessHex(score: number): string {
  if (score >= 70) return '#10B981'
  if (score >= 40) return '#F59E0B'
  return '#EF4444'
}

interface TooltipData {
  slug: string
  axes: StalenessAxes
  score: number
  x: number
  y: number
}

function RadarChart({
  projects,
  hoveredSlug,
  onHover,
}: {
  projects: ProjectStaleness[]
  hoveredSlug: string | null
  onHover: (data: TooltipData | null) => void
}) {
  const svgRef = useRef<SVGSVGElement>(null)
  const N = AXES.length
  const W = 400, H = 400, cx = 200, cy = 200, R = 155
  const startAngle = -Math.PI / 2

  function angle(i: number): number {
    return startAngle + (i * 2 * Math.PI) / N
  }

  function coord(dimIdx: number, score: number): [number, number] {
    const a = angle(dimIdx)
    const r = (score / 100) * R
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r]
  }

  function polyPoints(proj: ProjectStaleness): string {
    return AXES.map((ax, i) => coord(i, proj.axes[ax.key]).join(',')).join(' ')
  }

  const rings = [25, 50, 75, 100]

  function ringPoints(level: number): string {
    return AXES.map((_, i) => {
      const a = angle(i)
      const r = (level / 100) * R
      return `${cx + Math.cos(a) * r},${cy + Math.sin(a) * r}`
    }).join(' ')
  }

  function handleSvgMouseLeave() {
    onHover(null)
  }

  function handlePolyEnter(proj: ProjectStaleness, e: React.MouseEvent<SVGPolygonElement>) {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return
    onHover({
      slug: proj.slug,
      axes: proj.axes,
      score: proj.stalenessScore,
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    })
  }

  function handlePolyMove(proj: ProjectStaleness, e: React.MouseEvent<SVGPolygonElement>) {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return
    onHover({
      slug: proj.slug,
      axes: proj.axes,
      score: proj.stalenessScore,
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    })
  }

  const activeProjects = hoveredSlug
    ? projects.filter((p) => p.slug === hoveredSlug)
    : projects

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${W} ${H}`}
      className="w-full max-w-[400px] mx-auto"
      onMouseLeave={handleSvgMouseLeave}
    >
      <defs>
        <filter id="ms-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Grid rings */}
      {rings.map((level) => (
        <polygon
          key={level}
          points={ringPoints(level)}
          fill="none"
          stroke="rgba(255,255,255,0.06)"
          strokeWidth={1}
        />
      ))}

      {/* Ring labels */}
      {rings.map((level) => (
        <text
          key={`lbl-${level}`}
          x={cx + 3}
          y={cy - (level / 100) * R - 3}
          fill="rgba(255,255,255,0.18)"
          fontSize="0.45rem"
          fontFamily="monospace"
        >
          {level}
        </text>
      ))}

      {/* Spokes */}
      {AXES.map((_, i) => {
        const [x2, y2] = coord(i, 100)
        return (
          <line
            key={i}
            x1={cx} y1={cy}
            x2={x2} y2={y2}
            stroke="rgba(255,255,255,0.07)"
            strokeWidth={1}
          />
        )
      })}

      {/* Axis labels */}
      {AXES.map((ax, i) => {
        const a = angle(i)
        const lx = cx + Math.cos(a) * (R + 20)
        const ly = cy + Math.sin(a) * (R + 20)
        return (
          <text
            key={ax.key}
            x={lx}
            y={ly}
            textAnchor="middle"
            dominantBaseline="middle"
            fill="#64748B"
            fontSize="0.55rem"
            fontFamily="monospace"
          >
            {ax.label}
          </text>
        )
      })}

      {/* Project polygons — dimmed non-hovered */}
      {projects.map((proj) => {
        const color = slugColor(proj.slug)
        const isActive = !hoveredSlug || proj.slug === hoveredSlug
        return (
          <polygon
            key={proj.slug}
            points={polyPoints(proj)}
            fill={color}
            fillOpacity={isActive ? 0.18 : 0.04}
            stroke={color}
            strokeWidth={isActive ? 1.8 : 0.5}
            strokeOpacity={isActive ? 1 : 0.25}
            filter={isActive ? 'url(#ms-glow)' : undefined}
            style={{ cursor: 'pointer', transition: 'all 0.15s' }}
            onMouseEnter={(e) => handlePolyEnter(proj, e)}
            onMouseMove={(e) => handlePolyMove(proj, e)}
          />
        )
      })}
    </svg>
  )
}

function Tooltip({ data }: { data: TooltipData }) {
  return (
    <div
      className="absolute z-50 pointer-events-none rounded border border-white/10 p-3 text-[0.6rem] font-mono"
      style={{
        left: data.x + 12,
        top: data.y - 12,
        background: 'rgba(8, 15, 28, 0.95)',
        backdropFilter: 'blur(8px)',
        minWidth: 160,
      }}
    >
      <div className="flex items-center justify-between mb-2 gap-4">
        <span style={{ color: slugColor(data.slug) }}>{data.slug}</span>
        <span style={{ color: stalenessHex(data.score) }}>
          {stalenessLabel(data.score)} {data.score}/100
        </span>
      </div>
      {AXES.map((ax) => (
        <div key={ax.key} className="flex items-center gap-2 mb-1">
          <span className="text-slate-500 w-16">{ax.label}</span>
          <div className="flex-1 h-1 rounded-full bg-slate-800 overflow-hidden">
            <div
              className="h-full rounded-full"
              style={{
                width: `${data.axes[ax.key]}%`,
                background: data.axes[ax.key] >= 70
                  ? '#10B981'
                  : data.axes[ax.key] >= 40
                    ? '#F59E0B'
                    : '#EF4444',
              }}
            />
          </div>
          <span className="text-slate-300 w-6 text-right">{data.axes[ax.key]}</span>
        </div>
      ))}
    </div>
  )
}

export default function MemoryStalenessPage() {
  const [data, setData] = useState<MemoryStalenessResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [tooltip, setTooltip] = useState<TooltipData | null>(null)
  const [hoveredSlug, setHoveredSlug] = useState<string | null>(null)

  const load = useCallback(() => {
    fetch('/api/memory-staleness')
      .then((r) => r.json())
      .then((d: MemoryStalenessResponse) => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  function handleHover(d: TooltipData | null) {
    setTooltip(d)
    setHoveredSlug(d?.slug ?? null)
  }

  return (
    <div className="min-h-screen p-4 md:p-6" style={{ background: '#080f1c', color: '#E2E8F0' }}>
      <SubPageHeader title="Memory Staleness Radar">
        <span className="text-[0.6rem] font-mono text-slate-500">
          Freshness · Density · Diversity · Depth · Coverage
        </span>
      </SubPageHeader>

      {loading && (
        <div className="text-center py-20 text-slate-600 font-mono text-sm">Loading…</div>
      )}

      {!loading && data && (
        <div className="max-w-5xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-[420px_1fr] gap-6">
            {/* Radar */}
            <div
              className="rounded-lg border border-white/5 p-4 relative"
              style={{ background: 'rgba(255,255,255,0.02)' }}
            >
              <div className="text-[0.6rem] font-mono text-slate-500 uppercase tracking-wider mb-3">
                Memory Staleness — All Projects
              </div>

              {data.projects.length === 0 ? (
                <div className="text-[0.65rem] font-mono text-slate-600 py-16 text-center">
                  No projects with memory files found
                </div>
              ) : (
                <RadarChart
                  projects={data.projects}
                  hoveredSlug={hoveredSlug}
                  onHover={handleHover}
                />
              )}

              {tooltip && <Tooltip data={tooltip} />}

              {/* Axis legend */}
              <div className="mt-3 space-y-1 border-t border-white/5 pt-3">
                {AXES.map((ax) => (
                  <div key={ax.key} className="flex items-center gap-2 text-[0.55rem] font-mono">
                    <span className="text-slate-400 w-14">{ax.label}</span>
                    <span className="text-slate-600">{ax.desc}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Legend — sorted by staleness score desc */}
            <div
              className="rounded-lg border border-white/5 p-4"
              style={{ background: 'rgba(255,255,255,0.02)' }}
            >
              <div className="text-[0.6rem] font-mono text-slate-500 uppercase tracking-wider mb-3">
                Projects — sorted by staleness score
              </div>

              {data.projects.length === 0 ? (
                <div className="text-[0.65rem] font-mono text-slate-600 py-8 text-center">
                  No data
                </div>
              ) : (
                <div className="space-y-2 max-h-[520px] overflow-y-auto pr-1">
                  {data.projects.map((proj) => {
                    const color = slugColor(proj.slug)
                    const hex = stalenessHex(proj.stalenessScore)
                    const isHovered = hoveredSlug === proj.slug
                    return (
                      <button
                        key={proj.slug}
                        className="w-full rounded border px-3 py-2 text-left transition-all"
                        style={{
                          borderColor: isHovered ? color : 'rgba(255,255,255,0.05)',
                          background: isHovered ? `${color}10` : 'transparent',
                        }}
                        onMouseEnter={() => setHoveredSlug(proj.slug)}
                        onMouseLeave={() => setHoveredSlug(null)}
                      >
                        <div className="flex items-center gap-2 mb-1.5">
                          <div className="w-2 h-2 rounded-sm shrink-0" style={{ background: color }} />
                          <span className="text-[0.65rem] font-mono flex-1 truncate" style={{ color }}>
                            {proj.slug}
                          </span>
                          <span
                            className="text-[0.6rem] font-mono px-1.5 py-0.5 rounded"
                            style={{ color: hex, background: `${hex}15` }}
                          >
                            {stalenessLabel(proj.stalenessScore)} {proj.stalenessScore}
                          </span>
                        </div>

                        {/* Mini axis bars */}
                        <div className="grid grid-cols-5 gap-1">
                          {AXES.map((ax) => {
                            const v = proj.axes[ax.key]
                            return (
                              <div key={ax.key} className="space-y-0.5">
                                <div className="text-[0.45rem] font-mono text-slate-600 truncate">
                                  {ax.label.slice(0, 3)}
                                </div>
                                <div className="h-1 rounded-full bg-slate-800 overflow-hidden">
                                  <div
                                    className="h-full rounded-full"
                                    style={{
                                      width: `${v}%`,
                                      background: v >= 70 ? '#10B981' : v >= 40 ? '#F59E0B' : '#EF4444',
                                    }}
                                  />
                                </div>
                                <div className="text-[0.45rem] font-mono text-slate-600 text-right">{v}</div>
                              </div>
                            )
                          })}
                        </div>

                        <div className="mt-1.5 flex gap-3 text-[0.5rem] font-mono text-slate-600">
                          <span>{proj.memoryFileCount} files</span>
                          <span>newest {proj.newestMemAgeDays.toFixed(0)}d ago</span>
                          <span>oldest {proj.oldestMemAgeDays.toFixed(0)}d ago</span>
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          </div>

          <div className="text-[0.55rem] font-mono text-slate-700 text-right mt-4">
            Generated {new Date(data.generatedAt).toLocaleString()} · 1h cache
          </div>
        </div>
      )}
    </div>
  )
}
