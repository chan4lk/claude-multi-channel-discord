'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import type { DependencyGraphResponse, DependencyNode, InjectEdge } from '../api/dependency-graph/route'

const STATE_COLOR: Record<DependencyNode['state'], string> = {
  active: '#4ADE80',
  idle: '#22D3EE',
  stalled: '#EF4444',
  autonomous: '#A78BFA',
}

const NODE_R = 14

interface SimNode extends DependencyNode {
  x: number
  y: number
  vx: number
  vy: number
}

function hashSlug(slug: string): number {
  let h = 0
  for (let i = 0; i < slug.length; i++) h = (h * 31 + slug.charCodeAt(i)) >>> 0
  return h
}

function buildSim(nodes: DependencyNode[], edges: InjectEdge[], W: number, H: number): SimNode[] {
  return nodes.map((n, i) => {
    const angle = (i / nodes.length) * Math.PI * 2
    const r = Math.min(W, H) * 0.35
    const seed = hashSlug(n.slug)
    const jitter = ((seed % 100) / 100) * 0.2
    return {
      ...n,
      x: W / 2 + r * (1 + jitter) * Math.cos(angle),
      y: H / 2 + r * (1 + jitter) * Math.sin(angle),
      vx: 0,
      vy: 0,
    }
  })
}

function runSimStep(nodes: SimNode[], edges: InjectEdge[], W: number, H: number, alpha: number) {
  const cx = W / 2
  const cy = H / 2

  // Repulsion
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const dx = nodes[j].x - nodes[i].x
      const dy = nodes[j].y - nodes[i].y
      const dist2 = dx * dx + dy * dy
      if (dist2 < 1) continue
      const dist = Math.sqrt(dist2)
      const force = (NODE_R * 8) ** 2 / dist2
      const fx = (dx / dist) * force * alpha
      const fy = (dy / dist) * force * alpha
      nodes[i].vx -= fx
      nodes[i].vy -= fy
      nodes[j].vx += fx
      nodes[j].vy += fy
    }
  }

  // Attraction along edges
  const edgeLength = Math.min(W, H) * 0.3
  for (const e of edges) {
    const s = nodes.find((n) => n.slug === e.source)
    const t = nodes.find((n) => n.slug === e.target)
    if (!s || !t) continue
    const dx = t.x - s.x
    const dy = t.y - s.y
    const dist = Math.sqrt(dx * dx + dy * dy) || 1
    const force = ((dist - edgeLength) / dist) * alpha * 0.1
    s.vx += dx * force
    s.vy += dy * force
    t.vx -= dx * force
    t.vy -= dy * force
  }

  // Gravity toward center
  for (const n of nodes) {
    n.vx += (cx - n.x) * 0.002 * alpha
    n.vy += (cy - n.y) * 0.002 * alpha
  }

  // Apply velocity with damping
  for (const n of nodes) {
    n.vx *= 0.8
    n.vy *= 0.8
    n.x += n.vx
    n.y += n.vy
    n.x = Math.max(NODE_R + 4, Math.min(W - NODE_R - 4, n.x))
    n.y = Math.max(NODE_R + 4, Math.min(H - NODE_R - 4, n.y))
  }
}

function arrowPath(s: SimNode, t: SimNode): string {
  const dx = t.x - s.x
  const dy = t.y - s.y
  const dist = Math.sqrt(dx * dx + dy * dy) || 1
  const nx = dx / dist
  const ny = dy / dist
  const x1 = s.x + nx * (NODE_R + 2)
  const y1 = s.y + ny * (NODE_R + 2)
  const x2 = t.x - nx * (NODE_R + 6)
  const y2 = t.y - ny * (NODE_R + 6)
  return `M ${x1} ${y1} L ${x2} ${y2}`
}

interface SidePanel {
  slug: string
  inEdges: InjectEdge[]
  outEdges: InjectEdge[]
}

export default function DependencyGraphPage() {
  const [data, setData] = useState<DependencyGraphResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [simNodes, setSimNodes] = useState<SimNode[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [panel, setPanel] = useState<SidePanel | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const animRef = useRef<number | null>(null)
  const nodesRef = useRef<SimNode[]>([])
  const alphaRef = useRef(1)
  const [dims, setDims] = useState({ W: 900, H: 580 })

  const load = useCallback(() => {
    setLoading(true)
    fetch('/api/dependency-graph')
      .then((r) => r.json())
      .then((d: DependencyGraphResponse) => {
        setData(d)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    function onResize() {
      const el = svgRef.current?.parentElement
      if (el) setDims({ W: el.clientWidth, H: Math.max(400, el.clientHeight) })
    }
    onResize()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    if (!data || data.nodes.length === 0) return
    const initial = buildSim(data.nodes, data.edges, dims.W, dims.H)
    nodesRef.current = initial
    alphaRef.current = 1

    function tick() {
      if (alphaRef.current > 0.01) {
        runSimStep(nodesRef.current, data?.edges ?? [], dims.W, dims.H, alphaRef.current)
        alphaRef.current *= 0.98
        setSimNodes([...nodesRef.current])
        animRef.current = requestAnimationFrame(tick)
      }
    }
    if (animRef.current) cancelAnimationFrame(animRef.current)
    animRef.current = requestAnimationFrame(tick)
    return () => { if (animRef.current) cancelAnimationFrame(animRef.current) }
  }, [data, dims])

  function selectNode(slug: string) {
    if (!data) return
    if (selected === slug) {
      setSelected(null)
      setPanel(null)
      return
    }
    setSelected(slug)
    const inEdges = data.edges.filter((e) => e.target === slug)
    const outEdges = data.edges.filter((e) => e.source === slug)
    setPanel({ slug, inEdges, outEdges })
  }

  const edgeOpacity = (e: InjectEdge) => {
    if (!selected) return 0.5
    return e.source === selected || e.target === selected ? 1 : 0.1
  }

  const nodeOpacity = (slug: string) => {
    if (!selected) return 1
    if (slug === selected) return 1
    if (!data) return 0.3
    const linked = data.edges.some((e) => e.source === selected && e.target === slug) ||
      data.edges.some((e) => e.target === selected && e.source === slug)
    return linked ? 0.9 : 0.2
  }

  const edgeThickness = (e: InjectEdge) => Math.max(1, Math.log2(e.count + 1) * 0.8)

  return (
    <div className="min-h-dvh flex flex-col font-mono" style={{ background: '#060d1a' }}>
      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-cyber-cyan/12 bg-[#060d1a]/90 backdrop-blur-md px-4 py-2.5">
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-cyber-cyan/40 to-transparent" />
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-[0.65rem] font-mono font-bold text-cyber-cyan uppercase tracking-widest">Cross-Project Dependency Graph</span>
          {data && (
            <span className="text-[0.55rem] font-mono text-slate-600">
              {data.nodes.length} nodes · {data.edges.length} inject edges
            </span>
          )}
          <div className="flex-1" />
          {selected && (
            <button
              onClick={() => { setSelected(null); setPanel(null) }}
              className="text-[0.55rem] text-slate-500 hover:text-cyber-cyan transition-colors border border-slate-700 hover:border-cyber-cyan/30 px-2 py-0.5 rounded"
            >
              ✕ Reset
            </button>
          )}
          <button
            onClick={load}
            className="text-[0.55rem] text-slate-500 hover:text-cyber-cyan transition-colors border border-slate-700 hover:border-cyber-cyan/30 px-2 py-0.5 rounded"
          >
            ↻ Refresh
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* SVG graph */}
        <div className="flex-1 relative overflow-hidden">
          {loading && !data ? (
            <div className="flex items-center justify-center py-20">
              <span className="text-cyan-400/40 text-sm animate-pulse">Building dependency graph…</span>
            </div>
          ) : !data || data.nodes.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 gap-3">
              <div className="text-5xl opacity-10">⬡</div>
              <p className="text-sm font-mono text-slate-500">No projects or inject edges found</p>
            </div>
          ) : (
            <svg
              ref={svgRef}
              width={dims.W}
              height={dims.H}
              style={{ width: '100%', height: '100%' }}
              onClick={(e) => { if (e.target === svgRef.current) { setSelected(null); setPanel(null) } }}
            >
              <defs>
                <marker id="arrow-default" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto">
                  <path d="M 0 0 L 6 3 L 0 6 Z" fill="#22D3EE" fillOpacity="0.5" />
                </marker>
                <marker id="arrow-selected" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto">
                  <path d="M 0 0 L 6 3 L 0 6 Z" fill="#22D3EE" />
                </marker>
              </defs>

              {/* Edges */}
              {simNodes.length > 0 && data.edges.map((e, i) => {
                const s = simNodes.find((n) => n.slug === e.source)
                const t = simNodes.find((n) => n.slug === e.target)
                if (!s || !t) return null
                const isHighlighted = selected === e.source || selected === e.target
                return (
                  <g key={i} opacity={edgeOpacity(e)}>
                    <path
                      d={arrowPath(s, t)}
                      stroke="#22D3EE"
                      strokeWidth={edgeThickness(e)}
                      fill="none"
                      strokeOpacity={isHighlighted ? 0.8 : 0.3}
                      markerEnd={isHighlighted ? 'url(#arrow-selected)' : 'url(#arrow-default)'}
                    />
                  </g>
                )
              })}

              {/* Nodes */}
              {simNodes.map((n) => {
                const color = STATE_COLOR[n.state]
                const isSelected = selected === n.slug
                return (
                  <g
                    key={n.slug}
                    transform={`translate(${n.x},${n.y})`}
                    style={{ cursor: 'pointer', opacity: nodeOpacity(n.slug) }}
                    onClick={(e) => { e.stopPropagation(); selectNode(n.slug) }}
                  >
                    {isSelected && (
                      <circle r={NODE_R + 6} fill="none" stroke={color} strokeWidth={1.5} strokeOpacity={0.4} />
                    )}
                    <circle
                      r={NODE_R}
                      fill={`${color}22`}
                      stroke={color}
                      strokeWidth={isSelected ? 2 : 1}
                    />
                    <text
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fontSize="6"
                      fill={color}
                      fontFamily="monospace"
                    >
                      {n.slug.length > 10 ? n.slug.slice(0, 9) + '…' : n.slug}
                    </text>
                    <text
                      y={NODE_R + 8}
                      textAnchor="middle"
                      fontSize="5"
                      fill="#64748B"
                      fontFamily="monospace"
                    >
                      {n.state}
                    </text>
                  </g>
                )
              })}
            </svg>
          )}

          {/* Legend */}
          {data && data.nodes.length > 0 && (
            <div className="absolute bottom-3 left-3 flex flex-col gap-1 pointer-events-none">
              {(Object.entries(STATE_COLOR) as [DependencyNode['state'], string][]).map(([state, color]) => (
                <div key={state} className="flex items-center gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-full border" style={{ background: `${color}22`, borderColor: color }} />
                  <span className="text-[0.5rem] font-mono" style={{ color }}>{state}</span>
                </div>
              ))}
              <div className="mt-1 flex items-center gap-1.5">
                <div className="w-5 h-0 border-t border-cyber-cyan/60" style={{ borderWidth: '2px' }} />
                <span className="text-[0.5rem] font-mono text-slate-600">inject flow (thickness=freq)</span>
              </div>
            </div>
          )}
        </div>

        {/* Side panel */}
        {panel && (
          <div
            className="w-64 border-l border-white/8 flex flex-col overflow-y-auto"
            style={{ background: 'rgba(0,245,255,0.015)' }}
          >
            <div className="p-3 border-b border-white/8">
              <div className="text-[0.65rem] font-mono font-bold text-cyber-cyan">{panel.slug}</div>
              <div className="text-[0.5rem] font-mono text-slate-600 mt-0.5">
                {panel.inEdges.length} incoming · {panel.outEdges.length} outgoing
              </div>
            </div>

            {panel.outEdges.length > 0 && (
              <div className="p-3 border-b border-white/8">
                <div className="text-[0.5rem] font-mono text-amber-400 uppercase tracking-wider mb-2">→ Injects to</div>
                {panel.outEdges.map((e) => (
                  <div key={e.target} className="mb-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[0.6rem] font-mono text-slate-300">{e.target}</span>
                      <span className="text-[0.5rem] font-mono text-slate-600">×{e.count}</span>
                    </div>
                    <div className="text-[0.5rem] font-mono text-slate-600 truncate mt-0.5">{e.lastMessage || '—'}</div>
                    <div className="text-[0.45rem] font-mono text-slate-700 mt-0.5">
                      {new Date(e.lastDate).toLocaleDateString()}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {panel.inEdges.length > 0 && (
              <div className="p-3">
                <div className="text-[0.5rem] font-mono text-purple-400 uppercase tracking-wider mb-2">← Receives from</div>
                {panel.inEdges.map((e) => (
                  <div key={e.source} className="mb-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[0.6rem] font-mono text-slate-300">{e.source}</span>
                      <span className="text-[0.5rem] font-mono text-slate-600">×{e.count}</span>
                    </div>
                    <div className="text-[0.5rem] font-mono text-slate-600 truncate mt-0.5">{e.lastMessage || '—'}</div>
                    <div className="text-[0.45rem] font-mono text-slate-700 mt-0.5">
                      {new Date(e.lastDate).toLocaleDateString()}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {panel.inEdges.length === 0 && panel.outEdges.length === 0 && (
              <div className="p-3 text-[0.55rem] font-mono text-slate-600">No inject history recorded for this project.</div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
