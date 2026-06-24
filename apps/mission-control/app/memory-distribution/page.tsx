'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import type { MemoryDistributionResponse, MemoryType } from '../api/memory-distribution/route'
import { MEMORY_TYPES } from '../api/memory-distribution/route'
import { useFreshness } from '../../lib/useFreshness'
import FreshnessBadge from '../../components/FreshnessBadge'

const TYPE_COLORS: Record<MemoryType, string> = {
  user: '#22d3ee',
  feedback: '#a78bfa',
  project: '#4ade80',
  reference: '#f59e0b',
  other: '#475569',
}

const TYPE_LABELS: Record<MemoryType, string> = {
  user: 'User',
  feedback: 'Feedback',
  project: 'Project',
  reference: 'Reference',
  other: 'Other',
}

const CX = 180
const CY = 180
const R_INNER_0 = 50   // fleet donut inner radius
const R_INNER_1 = 90   // fleet donut outer / project ring inner
const R_OUTER = 160    // project ring outer

const GAP_RAD = 0.015  // gap between project slices

function polar(r: number, a: number) {
  return { x: CX + r * Math.cos(a - Math.PI / 2), y: CY + r * Math.sin(a - Math.PI / 2) }
}

function sectorPath(ri: number, ro: number, a0: number, a1: number): string {
  const large = a1 - a0 > Math.PI ? 1 : 0
  const p0i = polar(ri, a0), p0o = polar(ro, a0)
  const p1i = polar(ri, a1), p1o = polar(ro, a1)
  return [
    `M ${p0o.x} ${p0o.y}`,
    `A ${ro} ${ro} 0 ${large} 1 ${p1o.x} ${p1o.y}`,
    `L ${p1i.x} ${p1i.y}`,
    `A ${ri} ${ri} 0 ${large} 0 ${p0i.x} ${p0i.y}`,
    'Z',
  ].join(' ')
}

interface FleetSlice {
  type: MemoryType
  a0: number
  a1: number
  count: number
}

interface ProjectSlice {
  slug: string
  dominant: MemoryType | null
  a0: number
  a1: number
  total: number
  counts: Record<MemoryType, number>
}

export default function MemoryDistributionPage() {
  const { data, isStale, lastError, lastSuccessAt } = useFreshness<MemoryDistributionResponse>(
    '/api/memory-distribution',
    120_000,
  )
  const [hoveredProject, setHoveredProject] = useState<string | null>(null)
  const [hoveredType, setHoveredType] = useState<MemoryType | null>(null)

  const loading = data === null && lastError === null

  const { fleetSlices, projectSlices } = useMemo(() => {
    if (!data) return { fleetSlices: [], projectSlices: [] }

    const total = data.fleetTotal
    const projects = data.projects

    // Fleet inner ring: type arcs
    const fleetSlices: FleetSlice[] = []
    let a = 0
    for (const t of MEMORY_TYPES) {
      const count = data.fleetCounts[t]
      if (count === 0) continue
      const span = (count / Math.max(total, 1)) * (2 * Math.PI)
      fleetSlices.push({ type: t, a0: a, a1: a + span, count })
      a += span
    }

    // Project outer ring
    const totalMemories = projects.reduce((s, p) => s + p.total, 0)
    const projectSlices: ProjectSlice[] = []
    let pa = 0
    for (const p of projects) {
      const span = (p.total / Math.max(totalMemories, 1)) * (2 * Math.PI) - GAP_RAD
      if (span <= 0) continue
      projectSlices.push({
        slug: p.slug,
        dominant: p.dominant,
        a0: pa + GAP_RAD / 2,
        a1: pa + span + GAP_RAD / 2,
        total: p.total,
        counts: p.counts,
      })
      pa += span + GAP_RAD
    }

    return { fleetSlices, projectSlices }
  }, [data])

  const hoveredProjectData = data?.projects.find((p) => p.slug === hoveredProject)

  if (loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center" style={{ background: '#060d1a' }}>
        <div className="text-xs font-mono text-slate-600 animate-pulse">Loading memory distribution…</div>
      </div>
    )
  }

  return (
    <div className="min-h-dvh flex flex-col" style={{ background: '#060d1a' }}>
      <header className="sticky top-0 z-30 border-b border-cyber-cyan/12 bg-[#060d1a]/90 backdrop-blur-md px-6 py-3">
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-cyber-cyan/40 to-transparent" />
        <div className="flex items-center gap-3 flex-wrap">
          <Link href="/" className="text-[0.6rem] font-mono text-slate-500 hover:text-cyber-cyan transition-colors uppercase tracking-wider">← Dashboard</Link>
          <h1 className="text-sm font-black tracking-[0.18em] text-cyber-cyan" style={{ fontFamily: 'Orbitron, JetBrains Mono, monospace' }}>
            Memory Type Distribution
          </h1>
          <span className="text-[0.6rem] font-mono text-slate-500 border border-slate-700 px-2 py-0.5 rounded">user / feedback / project / reference balance</span>
          <FreshnessBadge isStale={isStale} lastError={lastError} lastSuccessAt={lastSuccessAt} />
          <div className="flex-1" />
          <div className="flex items-center gap-1.5">
            <span className="text-[0.55rem] font-mono text-slate-500 uppercase tracking-wider">memories</span>
            <span className="text-lg font-black tabular-nums text-cyber-cyan" style={{ fontFamily: 'Orbitron, monospace' }}>{data?.fleetTotal ?? 0}</span>
          </div>
        </div>
      </header>

      <main className="flex-1 p-6 max-w-5xl mx-auto w-full flex flex-col gap-6">
        {(data?.fleetTotal ?? 0) === 0 ? (
          <div className="h-64 flex items-center justify-center text-slate-600 text-xs font-mono text-center px-6">
            No memory files found. Memory files with <code className="mx-1">type:</code> frontmatter in the{' '}
            <code>projects/&lt;slug&gt;/memory/</code> directory will appear here.
          </div>
        ) : (
          <div className="flex flex-col lg:flex-row gap-8 items-start">
            {/* Sunburst */}
            <div className="shrink-0">
              <svg width="360" height="360" viewBox="0 0 360 360">
                {/* Fleet inner ring */}
                {fleetSlices.map((s) => (
                  <path
                    key={s.type}
                    d={sectorPath(R_INNER_0, R_INNER_1, s.a0, s.a1)}
                    fill={TYPE_COLORS[s.type]}
                    opacity={hoveredType === null || hoveredType === s.type ? 0.85 : 0.2}
                    onMouseEnter={() => setHoveredType(s.type)}
                    onMouseLeave={() => setHoveredType(null)}
                    className="cursor-pointer transition-opacity"
                  />
                ))}

                {/* Project outer ring */}
                {projectSlices.map((s) => {
                  const color = s.dominant ? TYPE_COLORS[s.dominant] : '#475569'
                  const isHovered = hoveredProject === s.slug
                  return (
                    <Link key={s.slug} href={`/memory-health`}>
                      <path
                        d={sectorPath(R_INNER_1 + 2, R_OUTER, s.a0, s.a1)}
                        fill={color}
                        opacity={hoveredProject === null || isHovered ? (isHovered ? 1 : 0.6) : 0.15}
                        onMouseEnter={() => setHoveredProject(s.slug)}
                        onMouseLeave={() => setHoveredProject(null)}
                        className="cursor-pointer transition-opacity"
                      />
                    </Link>
                  )
                })}

                {/* Center label */}
                <text x={CX} y={CY - 8} textAnchor="middle" className="fill-cyber-cyan text-xs" style={{ fontSize: 18, fontFamily: 'Orbitron, monospace', fontWeight: 900, fill: '#00f5ff' }}>
                  {data?.fleetTotal}
                </text>
                <text x={CX} y={CY + 10} textAnchor="middle" style={{ fontSize: 7, fontFamily: 'JetBrains Mono, monospace', fill: '#475569' }}>
                  memories
                </text>
                <text x={CX} y={CY + 22} textAnchor="middle" style={{ fontSize: 6, fontFamily: 'JetBrains Mono, monospace', fill: '#334155' }}>
                  {data?.projects.length ?? 0} projects
                </text>
              </svg>

              {/* Legend */}
              <div className="flex flex-wrap gap-x-4 gap-y-1 justify-center mt-1">
                {MEMORY_TYPES.filter((t) => (data?.fleetCounts[t] ?? 0) > 0).map((t) => (
                  <button
                    key={t}
                    onMouseEnter={() => setHoveredType(t)}
                    onMouseLeave={() => setHoveredType(null)}
                    className="flex items-center gap-1 text-[0.5rem] font-mono transition-opacity"
                    style={{ opacity: hoveredType === null || hoveredType === t ? 1 : 0.4 }}
                  >
                    <span className="w-2 h-2 rounded-sm" style={{ background: TYPE_COLORS[t] }} />
                    <span style={{ color: TYPE_COLORS[t] }}>{TYPE_LABELS[t]}</span>
                    <span className="text-slate-600">{data?.fleetCounts[t]}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Per-project table */}
            <div className="flex-1 min-w-0">
              {/* Hover detail */}
              {hoveredProjectData ? (
                <div className="rounded-xl border border-cyber-cyan/20 p-4 mb-4" style={{ background: 'rgba(0,245,255,0.04)' }}>
                  <div className="text-xs font-bold font-mono text-cyber-cyan mb-2">{hoveredProjectData.slug}</div>
                  <div className="flex flex-wrap gap-3">
                    {MEMORY_TYPES.map((t) => {
                      const c = hoveredProjectData.counts[t]
                      if (c === 0) return null
                      const pct = Math.round((c / hoveredProjectData.total) * 100)
                      return (
                        <div key={t} className="flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-sm" style={{ background: TYPE_COLORS[t] }} />
                          <span className="text-[0.55rem] font-mono" style={{ color: TYPE_COLORS[t] }}>{TYPE_LABELS[t]}</span>
                          <span className="text-[0.55rem] font-mono text-slate-400">{c} ({pct}%)</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ) : (
                <div className="rounded-xl border border-slate-800 p-4 mb-4 text-[0.55rem] font-mono text-slate-600">
                  Hover a project slice to see type breakdown. Inner ring = fleet type totals. Outer ring = projects colored by dominant type.
                </div>
              )}

              {/* Project rows */}
              <div className="flex flex-col gap-1 max-h-72 overflow-y-auto">
                {(data?.projects ?? []).map((p) => {
                  const pct = (t: MemoryType) => Math.round((p.counts[t] / Math.max(p.total, 1)) * 100)
                  return (
                    <div
                      key={p.slug}
                      className="flex items-center gap-2"
                      onMouseEnter={() => setHoveredProject(p.slug)}
                      onMouseLeave={() => setHoveredProject(null)}
                    >
                      <span className="text-[0.55rem] font-mono text-slate-400 w-28 truncate shrink-0">{p.slug}</span>
                      <div className="flex-1 h-3 rounded-sm overflow-hidden flex">
                        {MEMORY_TYPES.map((t) => {
                          const w = pct(t)
                          if (w === 0) return null
                          return (
                            <div
                              key={t}
                              style={{ width: `${w}%`, background: TYPE_COLORS[t], opacity: hoveredProject === p.slug ? 1 : 0.6 }}
                              title={`${TYPE_LABELS[t]}: ${p.counts[t]}`}
                            />
                          )
                        })}
                      </div>
                      <span className="text-[0.5rem] font-mono text-slate-600 w-6 text-right">{p.total}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        )}

        <p className="text-[0.5rem] font-mono text-slate-700">
          Reads <code>type:</code> from YAML frontmatter in each project&apos;s <code>memory/*.md</code> files.
          Inner ring = fleet-wide type totals. Outer ring = one slice per project (sized by memory count, colored by dominant type).
          Click any project slice to open Memory Health. Hover for breakdown. Refreshes every 2 min.
        </p>
      </main>
    </div>
  )
}
