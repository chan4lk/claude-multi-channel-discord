'use client'

import { useEffect, useRef, useState } from 'react'
import * as d3 from 'd3'
import Link from 'next/link'
import type { GoalRadarResponse, GoalRadarProject } from '../api/goal-radar/route'

const CYBER_COLORS = [
  '#22D3EE', '#A855F7', '#F59E0B', '#10B981', '#EF4444',
  '#3B82F6', '#EC4899', '#14B8A6', '#F97316', '#8B5CF6',
]

function scoreColor(score: number): string {
  if (score >= 60) return '#10B981'
  if (score >= 30) return '#F59E0B'
  return '#EF4444'
}

function SparkLine({ history }: { history: Array<{ date: string; score: number }> }) {
  const sorted = [...history].sort((a, b) => a.date.localeCompare(b.date))
  if (sorted.length < 2) return <span className="text-slate-700 text-[0.5rem]">no history</span>
  const W = 64, H = 20
  const max = Math.max(...sorted.map((h) => h.score), 1)
  const points = sorted.map((h, i) => {
    const x = (i / (sorted.length - 1)) * W
    const y = H - (h.score / max) * H
    return `${x},${y}`
  }).join(' ')
  return (
    <svg width={W} height={H} className="overflow-visible">
      <polyline points={points} fill="none" stroke="#22D3EE" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function RadarChart({ projects }: { projects: GoalRadarProject[] }) {
  const svgRef = useRef<SVGSVGElement>(null)

  useEffect(() => {
    const svg = svgRef.current
    if (!svg || projects.length === 0) return

    const W = 400, H = 400, cx = 200, cy = 200, R = 150
    d3.select(svg).selectAll('*').remove()
    const root = d3.select(svg).attr('width', W).attr('height', H)

    const defs = root.append('defs')
    const glow = defs.append('filter').attr('id', 'radar-glow').attr('x', '-60%').attr('y', '-60%').attr('width', '220%').attr('height', '220%')
    glow.append('feGaussianBlur').attr('stdDeviation', '3').attr('result', 'blur')
    const merge = glow.append('feMerge')
    merge.append('feMergeNode').attr('in', 'blur')
    merge.append('feMergeNode').attr('in', 'SourceGraphic')

    const n = projects.length
    if (n === 0) return

    const angleStep = (2 * Math.PI) / n

    // Grid rings
    for (const level of [0.25, 0.5, 0.75, 1]) {
      const pts = projects.map((_, i) => {
        const angle = i * angleStep - Math.PI / 2
        return [cx + Math.cos(angle) * R * level, cy + Math.sin(angle) * R * level]
      })
      root.append('polygon')
        .attr('points', pts.map((p) => p.join(',')).join(' '))
        .attr('fill', 'none')
        .attr('stroke', '#22D3EE15')
        .attr('stroke-width', 1)
    }

    // Axes
    for (let i = 0; i < n; i++) {
      const angle = i * angleStep - Math.PI / 2
      const x = cx + Math.cos(angle) * R
      const y = cy + Math.sin(angle) * R
      root.append('line')
        .attr('x1', cx).attr('y1', cy)
        .attr('x2', x).attr('y2', y)
        .attr('stroke', '#22D3EE20').attr('stroke-width', 1)

      // Label
      const labelR = R + 20
      const lx = cx + Math.cos(angle) * labelR
      const ly = cy + Math.sin(angle) * labelR
      root.append('text')
        .attr('x', lx).attr('y', ly)
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'middle')
        .attr('font-size', 8)
        .attr('font-family', 'JetBrains Mono, monospace')
        .attr('fill', CYBER_COLORS[i % CYBER_COLORS.length])
        .text(projects[i].slug.slice(0, 10))
    }

    // Data polygon
    const dataPoints = projects.map((p, i) => {
      const angle = i * angleStep - Math.PI / 2
      const r = R * (p.score / 100)
      return [cx + Math.cos(angle) * r, cy + Math.sin(angle) * r]
    })

    root.append('polygon')
      .attr('points', dataPoints.map((p) => p.join(',')).join(' '))
      .attr('fill', '#22D3EE18')
      .attr('stroke', '#22D3EE')
      .attr('stroke-width', 1.5)
      .attr('filter', 'url(#radar-glow)')

    // Score dots
    for (let i = 0; i < n; i++) {
      const [x, y] = dataPoints[i]
      const color = scoreColor(projects[i].score)
      root.append('circle')
        .attr('cx', x).attr('cy', y).attr('r', 4)
        .attr('fill', color)
        .attr('stroke', '#060d1a').attr('stroke-width', 1.5)
        .append('title')
        .text(`${projects[i].slug}: ${projects[i].score}%`)
    }
  }, [projects])

  if (projects.length === 0) {
    return <div className="flex items-center justify-center h-full text-slate-700 font-mono text-xs">No project goals found</div>
  }

  return <svg ref={svgRef} className="w-full h-full" />
}

export default function GoalRadarPage() {
  const [data, setData] = useState<GoalRadarResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<GoalRadarProject | null>(null)

  useEffect(() => {
    function fetchData() {
      fetch('/api/goal-radar')
        .then((r) => r.json())
        .then((d: GoalRadarResponse) => {
          setData(d)
          setLoading(false)
          if (!selected && d.projects.length > 0) setSelected(d.projects[0])
        })
        .catch(() => setLoading(false))
    }
    fetchData()
    const iv = setInterval(fetchData, 60_000)
    return () => clearInterval(iv)
  }, [selected])

  const projects = data?.projects ?? []

  return (
    <div className="min-h-dvh flex flex-col" style={{ background: '#060d1a' }}>
      <header className="relative border-b border-cyber-cyan/12 bg-cyber-surface/70 backdrop-blur-md px-6 py-3">
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-cyber-cyan/40 to-transparent" />
        <div className="flex items-center gap-4">
          <Link
            href="/"
            className="text-[0.6rem] font-mono text-slate-500 hover:text-cyber-cyan transition-colors uppercase tracking-wider"
          >
            ← Dashboard
          </Link>
          <h1
            className="text-lg font-black tracking-[0.18em] text-cyber-cyan"
            style={{ fontFamily: 'Orbitron, JetBrains Mono, monospace' }}
          >
            GOAL ACHIEVEMENT RADAR
          </h1>
          <div className="flex-1" />
          {data && (
            <div className="flex items-center gap-2 text-[0.6rem] font-mono">
              <span className="text-slate-500">Fleet avg advancement</span>
              <span
                className="px-2 py-0.5 rounded font-bold"
                style={{
                  color: scoreColor(data.avgScore),
                  background: scoreColor(data.avgScore) + '20',
                  border: `1px solid ${scoreColor(data.avgScore)}40`,
                }}
              >
                {data.avgScore}%
              </span>
            </div>
          )}
          <Link
            href="/goals"
            className="text-[0.6rem] px-2.5 py-1 rounded font-mono font-bold uppercase tracking-wider border border-cyber-cyan/20 text-slate-400 hover:text-cyber-cyan hover:border-cyber-cyan/40 transition-colors"
          >
            ● Goals
          </Link>
        </div>
      </header>

      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <span className="font-mono text-xs text-cyber-cyan animate-pulse">Computing goal advancement…</span>
        </div>
      ) : (
        <div className="flex-1 flex overflow-hidden">
          {/* Radar chart */}
          <div className="flex-1 flex items-center justify-center p-6">
            <div className="w-full max-w-lg aspect-square">
              <RadarChart projects={projects.filter((p) => p.goalText)} />
            </div>
          </div>

          {/* Right panel: project list + detail */}
          <div
            className="w-80 flex-shrink-0 border-l border-cyber-cyan/10 flex flex-col overflow-hidden"
            style={{ background: '#040a14' }}
          >
            {/* Project list */}
            <div className="flex-shrink-0 overflow-y-auto" style={{ maxHeight: '50%' }}>
              <div
                className="px-3 py-2 text-[0.55rem] font-mono uppercase tracking-widest font-bold border-b border-cyber-cyan/10 sticky top-0"
                style={{ color: '#22D3EE', background: '#040a14' }}
              >
                Projects ({projects.length})
              </div>
              {projects.map((p, i) => (
                <button
                  key={p.slug}
                  onClick={() => setSelected(p)}
                  className="w-full px-3 py-2 border-b border-white/5 flex items-center gap-2 text-left hover:bg-white/5 transition-colors"
                  style={{ background: selected?.slug === p.slug ? '#22D3EE08' : 'transparent' }}
                >
                  <span
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ background: scoreColor(p.score) }}
                  />
                  <span className="flex-1 text-[0.6rem] font-mono text-slate-300 truncate">{p.slug}</span>
                  <span
                    className="text-[0.6rem] font-mono font-bold flex-shrink-0"
                    style={{ color: scoreColor(p.score) }}
                  >
                    {p.score}%
                  </span>
                  <span
                    className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                    style={{ background: CYBER_COLORS[i % CYBER_COLORS.length] }}
                  />
                </button>
              ))}
            </div>

            {/* Detail card */}
            {selected && (
              <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
                <div>
                  <div
                    className="text-[0.55rem] font-mono uppercase tracking-widest font-bold mb-1"
                    style={{ color: '#22D3EE' }}
                  >
                    Goal
                  </div>
                  {selected.goalText ? (
                    <p className="text-[0.65rem] font-mono text-slate-400 leading-relaxed">
                      {selected.goalText.slice(0, 200)}{selected.goalText.length > 200 ? '…' : ''}
                    </p>
                  ) : (
                    <p className="text-[0.6rem] font-mono text-slate-700 italic">No GOAL.md</p>
                  )}
                </div>

                <div>
                  <div
                    className="text-[0.55rem] font-mono uppercase tracking-widest font-bold mb-1.5"
                    style={{ color: '#22D3EE' }}
                  >
                    Advancement Score
                  </div>
                  <div className="flex items-center gap-3">
                    <div
                      className="text-xl font-black font-mono"
                      style={{ color: scoreColor(selected.score) }}
                    >
                      {selected.score}%
                    </div>
                    <div className="flex-1 h-1.5 rounded-full bg-slate-800 overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${selected.score}%`,
                          background: scoreColor(selected.score),
                        }}
                      />
                    </div>
                  </div>
                </div>

                {selected.topKeywords.length > 0 && (
                  <div>
                    <div
                      className="text-[0.55rem] font-mono uppercase tracking-widest font-bold mb-1.5"
                      style={{ color: '#22D3EE' }}
                    >
                      Top Matched Keywords
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {selected.topKeywords.map((kw) => (
                        <span
                          key={kw}
                          className="text-[0.55rem] font-mono px-1.5 py-0.5 rounded"
                          style={{ background: '#22D3EE15', color: '#22D3EE', border: '1px solid #22D3EE30' }}
                        >
                          {kw}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {selected.history.length > 0 && (
                  <div>
                    <div
                      className="text-[0.55rem] font-mono uppercase tracking-widest font-bold mb-1.5"
                      style={{ color: '#22D3EE' }}
                    >
                      7-Day Trend
                    </div>
                    <SparkLine history={selected.history} />
                  </div>
                )}

                <div className="mt-auto">
                  <Link
                    href={`/knowledge?slug=${selected.slug}`}
                    className="text-[0.55rem] font-mono text-slate-600 hover:text-cyber-cyan transition-colors"
                  >
                    View memory →
                  </Link>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <footer className="border-t border-cyber-cyan/8 px-6 py-2">
        <div className="flex items-center gap-4 text-[0.5rem] font-mono text-slate-700">
          <span className="flex items-center gap-1"><span className="w-2 h-px inline-block" style={{ background: '#10B981' }} /> ≥60% advancing</span>
          <span className="flex items-center gap-1"><span className="w-2 h-px inline-block" style={{ background: '#F59E0B' }} /> 30–59% moderate</span>
          <span className="flex items-center gap-1"><span className="w-2 h-px inline-block" style={{ background: '#EF4444' }} /> &lt;30% low</span>
          <span className="ml-auto">Score = keyword overlap between last 20 replies and GOAL.md · Refreshes every 60s</span>
        </div>
      </footer>
    </div>
  )
}
