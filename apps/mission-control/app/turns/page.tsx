'use client'

import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import * as d3 from 'd3'
import SubPageHeader from '../../components/SubPageHeader'
import type { TurnProject, TurnsResponse } from '../api/fleet/turns/route'

const STATE_COLOR: Record<TurnProject['state'], string> = {
  active: '#4ADE80',
  stalled: '#EF4444',
  idle: '#22D3EE',
  autonomous: '#A78BFA',
}

const WINDOWS = ['1h', '6h', '24h', '7d'] as const
type Window = typeof WINDOWS[number]

interface TooltipState {
  x: number
  y: number
  project: TurnProject
}

interface TreemapNode {
  x0: number
  y0: number
  x1: number
  y1: number
  data: TurnProject & { value: number }
}

function formatLastActive(mins: number): string {
  if (mins >= 9999) return 'never'
  if (mins < 60) return `${mins}m ago`
  if (mins < 1440) return `${Math.floor(mins / 60)}h ago`
  return `${Math.floor(mins / 1440)}d ago`
}

function TurnsPageInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [projects, setProjects] = useState<TurnProject[]>([])
  const [loading, setLoading] = useState(true)
  const [lastUpdated, setLastUpdated] = useState('')
  const [tooltip, setTooltip] = useState<TooltipState | null>(null)
  const [nodes, setNodes] = useState<TreemapNode[]>([])
  const containerRef = useRef<HTMLDivElement>(null)
  const [dims, setDims] = useState({ w: 0, h: 0 })

  const selectedWindow: Window = (WINDOWS.includes(searchParams.get('w') as Window)
    ? searchParams.get('w')
    : '24h') as Window

  function setWindow(w: Window) {
    const params = new URLSearchParams(searchParams.toString())
    params.set('w', w)
    router.push(`?${params.toString()}`)
  }

  // Measure container
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      setDims({ w: el.clientWidth, h: el.clientHeight })
    })
    ro.observe(el)
    setDims({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  // Fetch data
  const loadData = useCallback(() => {
    setLoading(true)
    fetch(`/api/fleet/turns?window=${selectedWindow}`)
      .then((r) => r.json())
      .then((data: TurnsResponse) => {
        setProjects(data.projects)
        setLastUpdated(new Date().toLocaleTimeString())
      })
      .catch(() => {/* ignore */})
      .finally(() => setLoading(false))
  }, [selectedWindow])

  useEffect(() => {
    loadData()
    const id = setInterval(loadData, 30_000)
    return () => clearInterval(id)
  }, [loadData])

  // Build treemap when dims or projects change
  useEffect(() => {
    if (dims.w === 0 || dims.h === 0) return

    // Separate zero-turn from nonzero
    const nonZero = projects.filter((p) => p.turnCount > 0)
    const zeroTurn = projects.filter((p) => p.turnCount === 0)

    // Reserve bottom strip for zero-turn projects if any
    const ZERO_STRIP_H = zeroTurn.length > 0 ? 32 : 0
    const treemapH = dims.h - ZERO_STRIP_H

    if (nonZero.length === 0 && zeroTurn.length === 0) {
      setNodes([])
      return
    }

    // Give zero-turn projects a minimum value for strip (they won't go in the treemap)
    const hierarchyData = {
      name: 'root',
      children: nonZero.map((p) => ({
        ...p,
        value: Math.max(p.turnCount, 0.1),
      })),
    }

    const root = d3
      .hierarchy<typeof hierarchyData | (typeof hierarchyData.children)[number]>(hierarchyData)
      .sum((d) => ('value' in d ? d.value : 0))
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))

    d3.treemap<typeof hierarchyData | (typeof hierarchyData.children)[number]>()
      .size([dims.w, treemapH])
      .padding(2)(root)

    const leaves = root.leaves() as unknown as TreemapNode[]
    setNodes(leaves)
  }, [dims, projects])

  const zeroTurnProjects = projects.filter((p) => p.turnCount === 0)
  const nonZeroProjects = projects.filter((p) => p.turnCount > 0)
  const ZERO_STRIP_H = zeroTurnProjects.length > 0 ? 32 : 0

  return (
    <div className="min-h-dvh flex flex-col font-mono" style={{ background: '#0a0a0a' }}>
      <SubPageHeader title="TURN VOLUME">
        <div className="flex items-center gap-1">
          {WINDOWS.map((w) => (
            <button
              key={w}
              onClick={() => setWindow(w)}
              className="text-[0.6rem] px-2 py-0.5 rounded border transition-all"
              style={{
                borderColor: selectedWindow === w ? '#22D3EE' : '#374151',
                color: selectedWindow === w ? '#22D3EE' : '#6B7280',
                background: selectedWindow === w ? 'rgba(34,211,238,0.1)' : 'transparent',
                boxShadow: selectedWindow === w ? '0 0 8px rgba(34,211,238,0.3)' : 'none',
              }}
            >
              {w}
            </button>
          ))}
        </div>
        <span className="text-[0.55rem] font-mono text-slate-600">
          {loading ? 'loading...' : `${projects.length} projects · ${lastUpdated}`}
        </span>
      </SubPageHeader>

      <main className="flex-1 relative overflow-hidden" style={{ minHeight: 0 }}>
        {loading && projects.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-cyan-400/40 text-sm animate-pulse">Building treemap...</span>
          </div>
        ) : projects.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-slate-600 text-sm">No projects found</span>
          </div>
        ) : (
          <div
            ref={containerRef}
            className="absolute inset-0"
            style={{ cursor: 'default' }}
          >
            {/* SVG treemap for non-zero projects */}
            {dims.w > 0 && (
              <svg
                width={dims.w}
                height={dims.h - ZERO_STRIP_H}
                style={{ position: 'absolute', top: 0, left: 0 }}
              >
                {nodes.map((node) => {
                  const proj = node.data as TurnProject
                  const w = node.x1 - node.x0
                  const h = node.y1 - node.y0
                  const color = STATE_COLOR[proj.state]
                  const slug = proj.slug
                  const label = slug.length > 15 ? slug.slice(0, 14) + '…' : slug

                  return (
                    <g
                      key={slug}
                      transform={`translate(${node.x0},${node.y0})`}
                      style={{ cursor: 'pointer' }}
                      onClick={() => router.push(`/projects/${slug}`)}
                      onMouseEnter={() => {
                        setTooltip({
                          x: node.x0 + w / 2,
                          y: node.y0 - 8,
                          project: proj,
                        })
                      }}
                      onMouseLeave={() => setTooltip(null)}
                    >
                      <rect
                        width={Math.max(w, 0)}
                        height={Math.max(h, 0)}
                        fill={color}
                        fillOpacity={0.7}
                        stroke="#0a0a0a"
                        strokeWidth={1}
                      />
                      {w > 40 && h > 22 && (
                        <text
                          x={6}
                          y={16}
                          fill="#fff"
                          fontSize={10}
                          fontFamily="JetBrains Mono, monospace"
                          style={{ pointerEvents: 'none', userSelect: 'none' }}
                        >
                          {label}
                        </text>
                      )}
                      {w > 40 && h > 22 && (
                        <text
                          x={w - 5}
                          y={14}
                          fill="#fff"
                          fontSize={9}
                          fontFamily="JetBrains Mono, monospace"
                          textAnchor="end"
                          style={{ pointerEvents: 'none', userSelect: 'none' }}
                        >
                          {proj.turnCount}
                        </text>
                      )}
                    </g>
                  )
                })}
              </svg>
            )}

            {/* Zero-turn strip */}
            {zeroTurnProjects.length > 0 && dims.w > 0 && (
              <div
                className="absolute left-0 right-0 flex items-center gap-2 px-3 border-t"
                style={{
                  bottom: 0,
                  height: ZERO_STRIP_H,
                  borderColor: '#1f2937',
                  background: 'rgba(10,10,10,0.95)',
                }}
              >
                <span className="text-[0.55rem] text-slate-600 shrink-0">0 turns:</span>
                <span className="text-[0.55rem] text-slate-500 truncate">
                  {zeroTurnProjects.map((p) => p.slug).join(', ')}
                </span>
              </div>
            )}

            {/* Tooltip */}
            {tooltip && (
              <div
                className="absolute z-20 pointer-events-none rounded border p-2.5"
                style={{
                  left: Math.min(tooltip.x + 10, dims.w - 180),
                  top: Math.max(tooltip.y - 80, 8),
                  background: 'rgba(5,5,5,0.97)',
                  borderColor: STATE_COLOR[tooltip.project.state] + '55',
                  boxShadow: `0 0 20px ${STATE_COLOR[tooltip.project.state]}28`,
                  minWidth: 170,
                  fontSize: '0.7rem',
                  fontFamily: 'JetBrains Mono, monospace',
                }}
              >
                <div className="text-white font-bold mb-0.5">{tooltip.project.slug}</div>
                <div style={{ color: STATE_COLOR[tooltip.project.state] }} className="capitalize mb-1">
                  {tooltip.project.state}
                </div>
                <div className="text-slate-400">
                  {tooltip.project.turnCount} turns · {selectedWindow}
                </div>
                <div className="text-slate-400">
                  {tooltip.project.avgToolCalls} tool calls/turn
                </div>
                <div className="text-slate-500 text-[0.62rem] mt-0.5">
                  last active: {formatLastActive(tooltip.project.lastActiveMins)}
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      {/* Legend */}
      <footer className="border-t px-4 py-2 flex flex-wrap items-center gap-4" style={{ borderColor: '#1f2937' }}>
        {(Object.entries(STATE_COLOR) as [TurnProject['state'], string][]).map(([state, color]) => (
          <div key={state} className="flex items-center gap-1.5">
            <span
              className="inline-block rounded-sm"
              style={{ width: 10, height: 10, background: color, opacity: 0.8 }}
            />
            <span className="text-[0.58rem] font-mono text-slate-500 capitalize">{state}</span>
          </div>
        ))}
        <span className="ml-auto text-[0.55rem] font-mono text-slate-700">
          Size = turn count · Click cell → project · {nonZeroProjects.length} active projects
        </span>
      </footer>
    </div>
  )
}

export default function TurnsPage() {
  return (
    <Suspense fallback={<div className="min-h-dvh flex items-center justify-center" style={{ background: '#060d1a' }}><div className="text-xs font-mono text-slate-600 animate-pulse">Loading…</div></div>}>
      <TurnsPageInner />
    </Suspense>
  )
}
