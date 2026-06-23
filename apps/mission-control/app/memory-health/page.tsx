'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import * as d3 from 'd3'
import Link from 'next/link'
import SubPageHeader from '../../components/SubPageHeader'
import type { MemoryHealthResponse, ProjectMemoryHealth, MemoryHealthDimensions } from '../api/memory-health/route'

const DIMENSIONS: Array<{ key: keyof MemoryHealthDimensions; label: string }> = [
  { key: 'recency', label: 'Recency' },
  { key: 'coverage', label: 'Coverage' },
  { key: 'density', label: 'Density' },
  { key: 'stability', label: 'Stability' },
  { key: 'freshness', label: 'Freshness' },
]

const COLORS = [
  '#22D3EE', '#A855F7', '#F59E0B', '#10B981', '#EF4444',
  '#3B82F6', '#EC4899', '#14B8A6', '#F97316', '#8B5CF6',
]

function compositeColor(c: number): string {
  if (c >= 70) return '#10B981'
  if (c >= 40) return '#F59E0B'
  return '#EF4444'
}

function RadarChart({
  projects,
  fleetAvg,
  selectedSlug,
}: {
  projects: ProjectMemoryHealth[]
  fleetAvg: MemoryHealthDimensions
  selectedSlug: string | null
}) {
  const svgRef = useRef<SVGSVGElement>(null)

  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return

    const W = 420, H = 420, cx = 210, cy = 210, R = 160
    d3.select(svg).selectAll('*').remove()
    d3.select(svg).attr('viewBox', `0 0 ${W} ${H}`)

    const root = d3.select(svg)
    const defs = root.append('defs')

    // Glow filter
    const glow = defs.append('filter').attr('id', 'rhglow').attr('x', '-60%').attr('y', '-60%').attr('width', '220%').attr('height', '220%')
    glow.append('feGaussianBlur').attr('stdDeviation', '3').attr('result', 'blur')
    const merge = glow.append('feMerge')
    merge.append('feMergeNode').attr('in', 'blur')
    merge.append('feMergeNode').attr('in', 'SourceGraphic')

    const N = DIMENSIONS.length
    const angleStep = (2 * Math.PI) / N
    const startAngle = -Math.PI / 2

    function angle(i: number) {
      return startAngle + i * angleStep
    }

    function dimCoord(dimIdx: number, score: number): [number, number] {
      const a = angle(dimIdx)
      const r = (score / 100) * R
      return [cx + Math.cos(a) * r, cy + Math.sin(a) * r]
    }

    // Grid rings
    for (const level of [25, 50, 75, 100]) {
      const pts = DIMENSIONS.map((_, i) => {
        const a = angle(i)
        const r = (level / 100) * R
        return [cx + Math.cos(a) * r, cy + Math.sin(a) * r] as [number, number]
      })
      root.append('polygon')
        .attr('points', pts.map((p) => p.join(',')).join(' '))
        .attr('fill', 'none')
        .attr('stroke', 'rgba(255,255,255,0.07)')
        .attr('stroke-width', 1)
    }

    // Spokes
    for (let i = 0; i < N; i++) {
      const [x2, y2] = dimCoord(i, 100)
      root.append('line')
        .attr('x1', cx).attr('y1', cy)
        .attr('x2', x2).attr('y2', y2)
        .attr('stroke', 'rgba(255,255,255,0.08)')
        .attr('stroke-width', 1)
    }

    // Labels — link to memory-audit
    for (let i = 0; i < N; i++) {
      const a = angle(i)
      const lx = cx + Math.cos(a) * (R + 22)
      const ly = cy + Math.sin(a) * (R + 22)
      root.append('text')
        .attr('x', lx).attr('y', ly)
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'middle')
        .attr('fill', '#64748B')
        .attr('font-size', '0.6rem')
        .attr('font-family', 'monospace')
        .text(DIMENSIONS[i].label)
    }

    // Determine which projects to draw
    const toRender = selectedSlug
      ? projects.filter((p) => p.slug === selectedSlug)
      : projects

    // Project polygons
    toRender.forEach((proj, idx) => {
      const color = COLORS[idx % COLORS.length]
      const pts = DIMENSIONS.map((d, i) => dimCoord(i, proj.dimensions[d.key]))

      root.append('polygon')
        .attr('points', pts.map((p) => p.join(',')).join(' '))
        .attr('fill', color)
        .attr('fill-opacity', selectedSlug ? 0.2 : 0.12)
        .attr('stroke', color)
        .attr('stroke-width', 1.5)
        .attr('filter', 'url(#rhglow)')
    })

    // Fleet average — bold white
    const fleetPts = DIMENSIONS.map((d, i) => dimCoord(i, fleetAvg[d.key]))
    root.append('polygon')
      .attr('points', fleetPts.map((p) => p.join(',')).join(' '))
      .attr('fill', 'none')
      .attr('stroke', '#FFFFFF')
      .attr('stroke-width', selectedSlug ? 1 : 2)
      .attr('stroke-dasharray', selectedSlug ? '4,3' : 'none')
      .attr('opacity', 0.5)

  }, [projects, fleetAvg, selectedSlug])

  return <svg ref={svgRef} className="w-full max-w-[420px] mx-auto" />
}

function ScoreBreakdown({ project }: { project: ProjectMemoryHealth }) {
  return (
    <div className="space-y-1.5 mt-3">
      {DIMENSIONS.map((d) => {
        const score = project.dimensions[d.key]
        return (
          <div key={d.key} className="flex items-center gap-2">
            <span className="text-[0.6rem] font-mono text-slate-400 w-16">{d.label}</span>
            <div className="flex-1 h-1.5 rounded-full bg-slate-800 overflow-hidden">
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${score}%`,
                  background: score >= 70 ? '#10B981' : score >= 40 ? '#F59E0B' : '#EF4444',
                }}
              />
            </div>
            <span className="text-[0.6rem] font-mono text-slate-400 w-6 text-right">{score}</span>
          </div>
        )
      })}
    </div>
  )
}

export default function MemoryHealthPage() {
  const [data, setData] = useState<MemoryHealthResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null)
  const [perProject, setPerProject] = useState(false)

  const load = useCallback(() => {
    fetch('/api/memory-health')
      .then((r) => r.json())
      .then((d: MemoryHealthResponse) => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  const selectedProject = data?.projects.find((p) => p.slug === selectedSlug) ?? null

  useEffect(() => {
    if (perProject && data?.projects.length && !selectedSlug) {
      setSelectedSlug(data.projects[0].slug)
    }
  }, [perProject, data, selectedSlug])

  return (
    <div className="min-h-screen p-4 md:p-6" style={{ background: '#080f1c', color: '#E2E8F0' }}>
      <SubPageHeader title="Memory Health Radar">
        <span className="text-[0.6rem] font-mono text-slate-500">
          Recency · Coverage · Density · Stability · Freshness
        </span>
      </SubPageHeader>

      {loading && (
        <div className="text-center py-20 text-slate-600 font-mono text-sm">Loading…</div>
      )}

      {!loading && data && (
        <div className="max-w-5xl mx-auto">
          {/* Controls */}
          <div className="flex items-center gap-4 mb-6">
            <button
              onClick={() => setPerProject(false)}
              className="text-[0.65rem] font-mono px-3 py-1 rounded border transition-colors"
              style={{
                borderColor: !perProject ? '#A78BFA' : 'rgba(255,255,255,0.1)',
                color: !perProject ? '#A78BFA' : '#64748B',
                background: !perProject ? 'rgba(167,139,250,0.1)' : 'transparent',
              }}
            >
              Fleet Overview
            </button>
            <button
              onClick={() => setPerProject(true)}
              className="text-[0.65rem] font-mono px-3 py-1 rounded border transition-colors"
              style={{
                borderColor: perProject ? '#A78BFA' : 'rgba(255,255,255,0.1)',
                color: perProject ? '#A78BFA' : '#64748B',
                background: perProject ? 'rgba(167,139,250,0.1)' : 'transparent',
              }}
            >
              Per Project
            </button>
            {perProject && (
              <select
                value={selectedSlug ?? ''}
                onChange={(e) => setSelectedSlug(e.target.value)}
                className="text-[0.65rem] font-mono px-2 py-1 rounded border border-white/10"
                style={{ background: '#0d1b2e', color: '#E2E8F0' }}
              >
                {data.projects.map((p) => (
                  <option key={p.slug} value={p.slug}>{p.slug}</option>
                ))}
              </select>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Radar */}
            <div
              className="rounded-lg border border-white/5 p-4"
              style={{ background: 'rgba(255,255,255,0.02)' }}
            >
              <div className="text-[0.6rem] font-mono text-slate-500 uppercase tracking-wider mb-2">
                {perProject && selectedProject ? selectedProject.slug : 'All Projects'}
                {' '}— Memory Health Radar
              </div>
              {data.projects.length === 0 ? (
                <div className="text-[0.65rem] font-mono text-slate-600 py-12 text-center">
                  No projects with memory files found
                </div>
              ) : (
                <RadarChart
                  projects={data.projects}
                  fleetAvg={data.fleetAvg}
                  selectedSlug={perProject ? selectedSlug : null}
                />
              )}

              {/* Legend */}
              {!perProject && (
                <div className="mt-3 grid grid-cols-2 gap-1 max-h-32 overflow-y-auto">
                  {data.projects.map((p, idx) => (
                    <button
                      key={p.slug}
                      onClick={() => { setPerProject(true); setSelectedSlug(p.slug) }}
                      className="flex items-center gap-1.5 text-left hover:opacity-80 transition-opacity"
                    >
                      <div className="w-2 h-2 rounded-sm shrink-0" style={{ background: COLORS[idx % COLORS.length] }} />
                      <span className="text-[0.55rem] font-mono truncate" style={{ color: COLORS[idx % COLORS.length] }}>{p.slug}</span>
                      <span className="text-[0.5rem] font-mono text-slate-600 ml-auto">{p.composite}</span>
                    </button>
                  ))}
                  <div className="flex items-center gap-1.5">
                    <div className="w-2 h-0.5 bg-white opacity-50 shrink-0" />
                    <span className="text-[0.55rem] font-mono text-slate-500">Fleet avg</span>
                  </div>
                </div>
              )}
            </div>

            {/* Detail panel */}
            <div
              className="rounded-lg border border-white/5 p-4"
              style={{ background: 'rgba(255,255,255,0.02)' }}
            >
              {perProject && selectedProject ? (
                <>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-[0.7rem] font-mono" style={{ color: '#A78BFA' }}>{selectedProject.slug}</span>
                    <span
                      className="text-[0.6rem] font-mono px-2 py-0.5 rounded"
                      style={{
                        color: compositeColor(selectedProject.composite),
                        background: `${compositeColor(selectedProject.composite)}15`,
                      }}
                    >
                      {selectedProject.composite}/100
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-[0.6rem] font-mono text-slate-400 mb-4">
                    <div>Files: <span className="text-slate-200">{selectedProject.memoryFileCount}</span></div>
                    <div>Words: <span className="text-slate-200">{selectedProject.totalWords.toLocaleString()}</span></div>
                    <div>Last mod: <span className="text-slate-200">{selectedProject.lastModifiedDaysAgo}d ago</span></div>
                    <div>
                      <Link
                        href={`/memory-audit?slug=${selectedProject.slug}`}
                        className="underline hover:text-cyber-cyan"
                        style={{ color: '#64748B' }}
                      >
                        Audit →
                      </Link>
                    </div>
                  </div>
                  <ScoreBreakdown project={selectedProject} />
                </>
              ) : (
                <>
                  <div className="text-[0.65rem] font-mono text-slate-400 uppercase tracking-wider mb-3">
                    Fleet Summary
                  </div>
                  <div className="grid grid-cols-3 gap-2 mb-4">
                    {['green', 'amber', 'red'].map((color) => {
                      const count = data.projects.filter((p) => p.color === color).length
                      const label = color === 'green' ? 'Healthy ≥70' : color === 'amber' ? 'Fair 40–70' : 'Poor <40'
                      const hex = color === 'green' ? '#10B981' : color === 'amber' ? '#F59E0B' : '#EF4444'
                      return (
                        <div key={color} className="text-center rounded border border-white/5 p-2" style={{ background: `${hex}08` }}>
                          <div className="text-xl font-mono font-bold" style={{ color: hex }}>{count}</div>
                          <div className="text-[0.5rem] font-mono text-slate-600 mt-0.5">{label}</div>
                        </div>
                      )
                    })}
                  </div>
                  <div className="text-[0.65rem] font-mono text-slate-500 mb-2">Fleet Average Dimensions</div>
                  <div className="space-y-1.5">
                    {DIMENSIONS.map((d) => {
                      const score = data.fleetAvg[d.key]
                      return (
                        <div key={d.key} className="flex items-center gap-2">
                          <span className="text-[0.6rem] font-mono text-slate-400 w-16">{d.label}</span>
                          <div className="flex-1 h-1.5 rounded-full bg-slate-800 overflow-hidden">
                            <div
                              className="h-full rounded-full"
                              style={{
                                width: `${score}%`,
                                background: score >= 70 ? '#10B981' : score >= 40 ? '#F59E0B' : '#EF4444',
                              }}
                            />
                          </div>
                          <span className="text-[0.6rem] font-mono text-slate-400 w-6 text-right">{score}</span>
                        </div>
                      )
                    })}
                  </div>
                  <div className="mt-4 space-y-1 max-h-48 overflow-y-auto">
                    <div className="text-[0.6rem] font-mono text-slate-500 uppercase tracking-wider mb-1">Projects</div>
                    {[...data.projects]
                      .sort((a, b) => b.composite - a.composite)
                      .map((p) => (
                        <button
                          key={p.slug}
                          onClick={() => { setPerProject(true); setSelectedSlug(p.slug) }}
                          className="w-full flex items-center gap-2 px-2 py-1 rounded hover:bg-white/5 transition-colors text-left"
                        >
                          <span className="text-[0.6rem] font-mono text-slate-300 flex-1">{p.slug}</span>
                          <span className="text-[0.6rem] font-mono" style={{ color: compositeColor(p.composite) }}>{p.composite}</span>
                          <div
                            className="w-1.5 h-1.5 rounded-full shrink-0"
                            style={{ background: compositeColor(p.composite) }}
                          />
                        </button>
                      ))}
                  </div>
                </>
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
