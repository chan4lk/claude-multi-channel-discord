'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import SubPageHeader from '../../components/SubPageHeader'
import type { MemoryLinkGraphResponse, MemoryNode, MemoryEdge } from '../api/memory-link-graph/route'

const TYPE_COLORS: Record<string, string> = {
  user: '#22D3EE',
  feedback: '#A78BFA',
  project: '#F59E0B',
  reference: '#34D399',
  unknown: '#64748B',
}

function typeColor(t: string): string {
  return TYPE_COLORS[t] ?? '#64748B'
}

interface LayoutNode extends MemoryNode {
  x: number
  y: number
  vx: number
  vy: number
}

function computeLayout(
  nodes: MemoryNode[],
  edges: MemoryEdge[],
  width: number,
  height: number,
  iterations: number = 120,
): LayoutNode[] {
  if (nodes.length === 0) return []
  const lnodes: LayoutNode[] = nodes.map((n, i) => {
    const angle = (i / nodes.length) * 2 * Math.PI
    return {
      ...n,
      x: width / 2 + Math.cos(angle) * (width * 0.3),
      y: height / 2 + Math.sin(angle) * (height * 0.3),
      vx: 0,
      vy: 0,
    }
  })

  const idxById = new Map(lnodes.map((n, i) => [n.id, i]))
  const REPEL = 800
  const ATTRACT = 0.03
  const DAMPING = 0.85
  const LINK_LEN = 80

  for (let iter = 0; iter < iterations; iter++) {
    for (let i = 0; i < lnodes.length; i++) {
      for (let j = i + 1; j < lnodes.length; j++) {
        const a = lnodes[i]!
        const b = lnodes[j]!
        const dx = b.x - a.x
        const dy = b.y - a.y
        const dist = Math.sqrt(dx * dx + dy * dy) || 1
        const force = REPEL / (dist * dist)
        const fx = (dx / dist) * force
        const fy = (dy / dist) * force
        a.vx -= fx
        a.vy -= fy
        b.vx += fx
        b.vy += fy
      }
    }

    for (const e of edges) {
      const si = idxById.get(e.source)
      const ti = idxById.get(e.target)
      if (si == null || ti == null) continue
      const a = lnodes[si]!
      const b = lnodes[ti]!
      const dx = b.x - a.x
      const dy = b.y - a.y
      const dist = Math.sqrt(dx * dx + dy * dy) || 1
      const force = (dist - LINK_LEN) * ATTRACT
      const fx = (dx / dist) * force
      const fy = (dy / dist) * force
      a.vx += fx
      a.vy += fy
      b.vx -= fx
      b.vy -= fy
    }

    for (const n of lnodes) {
      n.vx *= DAMPING
      n.vy *= DAMPING
      n.x = Math.max(20, Math.min(width - 20, n.x + n.vx))
      n.y = Math.max(20, Math.min(height - 20, n.y + n.vy))
    }
  }

  return lnodes
}

const SVG_W = 900
const SVG_H = 600

export default function MemoryLinkGraphPage() {
  const [data, setData] = useState<MemoryLinkGraphResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filterProject, setFilterProject] = useState<string>('all')
  const [hovered, setHovered] = useState<LayoutNode | null>(null)
  const [layout, setLayout] = useState<LayoutNode[]>([])

  const load = useCallback(() => {
    fetch('/api/memory-link-graph')
      .then((r) => r.json())
      .then((d) => setData(d as MemoryLinkGraphResponse))
      .catch((e) => setError(String(e)))
  }, [])

  useEffect(() => {
    load()
    const t = setInterval(load, 120_000)
    return () => clearInterval(t)
  }, [load])

  useEffect(() => {
    if (!data) return
    const filteredNodes = filterProject === 'all'
      ? data.nodes
      : data.nodes.filter((n) => n.project === filterProject)
    const nodeIds = new Set(filteredNodes.map((n) => n.id))
    const filteredEdges = data.edges.filter(
      (e) => nodeIds.has(e.source) && nodeIds.has(e.target),
    )
    // Re-compute degree for filtered subgraph
    const degMap = new Map<string, { in: number; out: number }>()
    for (const n of filteredNodes) degMap.set(n.id, { in: 0, out: 0 })
    for (const e of filteredEdges) {
      degMap.get(e.source)!.out++
      degMap.get(e.target)!.in++
    }
    const nodesWithDeg = filteredNodes.map((n) => ({
      ...n,
      inDegree: degMap.get(n.id)?.in ?? 0,
      outDegree: degMap.get(n.id)?.out ?? 0,
    }))
    const lnodes = computeLayout(nodesWithDeg, filteredEdges, SVG_W, SVG_H)
    setLayout(lnodes)
  }, [data, filterProject])

  const nodeById = new Map(layout.map((n) => [n.id, n]))

  const filteredEdges = data
    ? filterProject === 'all'
      ? data.edges
      : data.edges.filter((e) => e.project === filterProject)
    : []

  const maxWC = Math.max(...layout.map((n) => n.wordCount), 1)

  function nodeRadius(n: LayoutNode) {
    const base = 4
    const extra = (n.wordCount / maxWC) * 10
    return base + extra
  }

  const colorMode = filterProject === 'all' ? 'project' : 'type'
  const projectColors: Record<string, string> = {}
  const PALETTE = ['#22D3EE', '#A78BFA', '#F59E0B', '#34D399', '#F472B6', '#60A5FA', '#FB923C']
  ;(data?.projects ?? []).forEach((p, i) => {
    projectColors[p] = PALETTE[i % PALETTE.length]!
  })

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <div className="sticky top-0 z-40 bg-slate-950/90 backdrop-blur border-b border-white/5">
        <SubPageHeader title="Memory Link Graph">
          {data && (
            <div className="flex gap-4 font-mono text-[0.6rem] text-slate-400 items-center">
              <span>{data.nodes.length} nodes · {data.edges.length} edges</span>
              <select
                className="bg-slate-800 border border-white/10 rounded px-2 py-0.5 font-mono text-[0.6rem] text-white"
                value={filterProject}
                onChange={(e) => setFilterProject(e.target.value)}
              >
                <option value="all">All projects</option>
                {data.projects.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>
          )}
        </SubPageHeader>
      </div>

      <div className="p-6">
        {error && <p className="font-mono text-red-400 text-xs">{error}</p>}
        {!data && !error && <p className="font-mono text-slate-500 text-xs">Loading…</p>}

        {data && (
          <>
            <div className="flex gap-4 mb-4 font-mono text-[0.6rem] text-slate-400">
              {colorMode === 'type'
                ? Object.entries(TYPE_COLORS).map(([t, c]) => (
                    <span key={t}><span style={{ color: c }}>■</span> {t}</span>
                  ))
                : data.projects.map((p, i) => (
                    <span key={p}><span style={{ color: PALETTE[i % PALETTE.length] }}>■</span> {p}</span>
                  ))}
            </div>

            <div className="relative rounded-xl border border-white/8 bg-black/20 overflow-hidden" style={{ height: SVG_H }}>
              <svg
                width={SVG_W}
                height={SVG_H}
                className="w-full h-full"
                viewBox={`0 0 ${SVG_W} ${SVG_H}`}
                preserveAspectRatio="xMidYMid meet"
              >
                <defs>
                  <marker id="arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                    <path d="M0,0 L0,6 L6,3 z" fill="rgba(255,255,255,0.2)" />
                  </marker>
                </defs>
                {/* Edges */}
                {filteredEdges.map((e, i) => {
                  const s = nodeById.get(e.source)
                  const t = nodeById.get(e.target)
                  if (!s || !t) return null
                  return (
                    <line
                      key={i}
                      x1={s.x}
                      y1={s.y}
                      x2={t.x}
                      y2={t.y}
                      stroke="rgba(255,255,255,0.12)"
                      strokeWidth="1"
                      markerEnd="url(#arrow)"
                    />
                  )
                })}
                {/* Nodes */}
                {layout.map((n) => {
                  const color = colorMode === 'project'
                    ? (projectColors[n.project] ?? '#64748B')
                    : typeColor(n.type)
                  const r = nodeRadius(n)
                  const isIsolated = n.inDegree === 0 && n.outDegree === 0
                  return (
                    <g key={n.id}>
                      <circle
                        cx={n.x}
                        cy={n.y}
                        r={r}
                        fill={color}
                        opacity={isIsolated ? 0.3 : 0.8}
                        style={{ filter: `drop-shadow(0 0 3px ${color}88)`, cursor: 'pointer' }}
                        onMouseEnter={() => setHovered(n)}
                        onMouseLeave={() => setHovered(null)}
                      />
                    </g>
                  )
                })}
              </svg>

              {hovered && (
                <div
                  className="absolute bg-slate-800/95 border border-white/10 rounded-lg p-3 font-mono text-[0.6rem] text-slate-300 pointer-events-none shadow-xl"
                  style={{
                    left: Math.min(hovered.x + 12, SVG_W - 200),
                    top: Math.max(hovered.y - 60, 4),
                    maxWidth: 220,
                  }}
                >
                  <div className="text-white font-bold mb-1">{hovered.slug}</div>
                  <div>project: {hovered.project}</div>
                  <div>type: <span style={{ color: typeColor(hovered.type) }}>{hovered.type}</span></div>
                  <div>words: {hovered.wordCount}</div>
                  <div>in: {hovered.inDegree} · out: {hovered.outDegree}</div>
                </div>
              )}
            </div>

            {layout.length === 0 && (
              <p className="font-mono text-slate-500 text-xs mt-4">
                No memory files with [[links]] found.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  )
}
