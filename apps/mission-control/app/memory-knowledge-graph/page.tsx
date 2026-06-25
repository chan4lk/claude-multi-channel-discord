'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import SubPageHeader from '../../components/SubPageHeader'
import type { KnowledgeGraphResponse, KGNode, KGEdge } from '../api/memory-knowledge-graph/route'

interface NodeWithPos extends KGNode {
  x: number
  y: number
  vx: number
  vy: number
}

const STATE_COLOR: Record<string, string> = {
  active: '#4ADE80',
  idle: '#22D3EE',
  stalled: '#EF4444',
}

function projectColor(state?: string): string {
  return STATE_COLOR[state ?? 'idle'] ?? '#22D3EE'
}

function keywordRadius(count: number): number {
  return Math.max(4, Math.min(12, 3 + count * 1.5))
}

function runForce(
  nodes: NodeWithPos[],
  edges: KGEdge[],
  W: number,
  H: number,
  ticks = 300
): void {
  const alpha = { val: 1.0 }
  const alphaDecay = 1 - Math.pow(0.001, 1 / ticks)

  for (let t = 0; t < ticks; t++) {
    alpha.val *= 1 - alphaDecay

    // Repulsion
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i]!, b = nodes[j]!
        let dx = b.x - a.x
        let dy = b.y - a.y
        const d2 = dx * dx + dy * dy + 1
        const d = Math.sqrt(d2)
        const strength = -800 / d2
        dx /= d; dy /= d
        a.vx += dx * strength * alpha.val
        a.vy += dy * strength * alpha.val
        b.vx -= dx * strength * alpha.val
        b.vy -= dy * strength * alpha.val
      }
    }

    // Attraction along edges
    const nodeIdx = new Map(nodes.map((n, i) => [n.id, i]))
    for (const e of edges) {
      const si = nodeIdx.get(e.source)
      const ti = nodeIdx.get(e.target)
      if (si == null || ti == null) continue
      const a = nodes[si]!, b = nodes[ti]!
      const dx = b.x - a.x
      const dy = b.y - a.y
      const d = Math.sqrt(dx * dx + dy * dy) + 0.01
      const linkDist = 80
      const f = (d - linkDist) / d * 0.3 * alpha.val
      a.vx += dx * f
      a.vy += dy * f
      b.vx -= dx * f
      b.vy -= dy * f
    }

    // Center gravity
    for (const n of nodes) {
      n.vx += (W / 2 - n.x) * 0.02 * alpha.val
      n.vy += (H / 2 - n.y) * 0.02 * alpha.val
    }

    // Apply velocity + dampen
    for (const n of nodes) {
      n.vx *= 0.6
      n.vy *= 0.6
      n.x += n.vx
      n.y += n.vy
      n.x = Math.max(20, Math.min(W - 20, n.x))
      n.y = Math.max(20, Math.min(H - 20, n.y))
    }
  }
}

export default function MemoryKnowledgeGraphPage() {
  const [data, setData] = useState<KnowledgeGraphResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [nodes, setNodes] = useState<NodeWithPos[]>([])
  const [minWeight, setMinWeight] = useState(1)
  const [selectedKeyword, setSelectedKeyword] = useState<string | null>(null)
  const [tooltip, setTooltip] = useState<{ x: number; y: number; node: NodeWithPos } | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const W = 900
  const H = 620

  const load = useCallback(() => {
    setLoading(true)
    fetch('/api/memory-knowledge-graph')
      .then(r => r.json())
      .then((d: KnowledgeGraphResponse) => {
        setData(d)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!data) return
    const positioned: NodeWithPos[] = data.nodes.map(n => ({
      ...n,
      x: Math.random() * (W - 40) + 20,
      y: Math.random() * (H - 40) + 20,
      vx: 0,
      vy: 0,
    }))
    runForce(positioned, data.edges, W, H, 400)
    setNodes(positioned)
  }, [data])

  const filteredEdges = (data?.edges ?? []).filter(e => e.weight >= minWeight)
  const highlightedProjects = selectedKeyword
    ? new Set(filteredEdges.filter(e => e.target === selectedKeyword).map(e => e.source))
    : null

  const nodeMap = new Map(nodes.map(n => [n.id, n]))

  const maxWeight = Math.max(1, ...filteredEdges.map(e => e.weight))

  return (
    <div className="min-h-screen p-4 md:p-6" style={{ background: '#080f1c', color: '#E2E8F0' }}>
      <SubPageHeader title="Cross-Project Memory Knowledge Graph">
        <span className="text-[0.6rem] font-mono text-slate-500">
          Shared knowledge entities across project memories · click keyword to highlight projects
        </span>
      </SubPageHeader>

      {/* Controls */}
      <div className="max-w-5xl mx-auto mb-4 flex flex-wrap gap-4 items-center">
        <div className="flex items-center gap-2">
          <span className="text-[0.6rem] font-mono text-slate-500">Min edge weight:</span>
          <input
            type="range"
            min={1}
            max={20}
            value={minWeight}
            onChange={e => setMinWeight(Number(e.target.value))}
            className="w-28 accent-cyan-400"
          />
          <span className="text-[0.6rem] font-mono text-cyan-400">{minWeight}</span>
        </div>
        <button
          onClick={() => setSelectedKeyword(null)}
          className="text-[0.6rem] font-mono px-2 py-1 rounded border border-white/10 text-slate-400 hover:text-cyan-400"
          style={{ background: '#0d1b2e' }}
        >
          Clear selection
        </button>
        <div className="ml-auto flex gap-4 flex-wrap">
          {/* Legend */}
          <div className="flex items-center gap-1">
            <span className="inline-block w-3 h-3 rounded-full" style={{ background: '#22D3EE' }} />
            <span className="text-[0.55rem] font-mono text-slate-500 ml-1">project (idle)</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="inline-block w-3 h-3 rounded-full" style={{ background: '#4ADE80' }} />
            <span className="text-[0.55rem] font-mono text-slate-500 ml-1">project (active)</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="inline-block w-3 h-3 rounded-full" style={{ background: '#FB923C' }} />
            <span className="text-[0.55rem] font-mono text-slate-500 ml-1">keyword (shared)</span>
          </div>
        </div>
      </div>

      {loading && <div className="text-center py-20 text-slate-600 font-mono text-sm">Computing knowledge graph…</div>}

      {!loading && nodes.length === 0 && (
        <div className="text-center py-20 text-slate-600 font-mono text-sm">
          No shared keywords found across projects
        </div>
      )}

      {!loading && nodes.length > 0 && (
        <div className="max-w-5xl mx-auto overflow-x-auto">
          <div className="relative" style={{ width: W, height: H }}>
            <svg
              ref={svgRef}
              width={W}
              height={H}
              style={{ borderRadius: 8, border: '1px solid rgba(255,255,255,0.06)', background: '#060d19' }}
              onMouseLeave={() => setTooltip(null)}
            >
              {/* Edges */}
              {filteredEdges.map((e, i) => {
                const src = nodeMap.get(e.source)
                const tgt = nodeMap.get(e.target)
                if (!src || !tgt) return null
                const isHighlighted = selectedKeyword === e.target || highlightedProjects?.has(e.source)
                const opacity = selectedKeyword
                  ? isHighlighted ? 0.7 : 0.05
                  : 0.15 + (e.weight / maxWeight) * 0.3
                return (
                  <line
                    key={i}
                    x1={src.x} y1={src.y}
                    x2={tgt.x} y2={tgt.y}
                    stroke={isHighlighted && selectedKeyword ? '#F59E0B' : '#64748B'}
                    strokeWidth={selectedKeyword ? (isHighlighted ? 1.5 : 0.5) : 0.8}
                    opacity={opacity}
                  />
                )
              })}

              {/* Nodes */}
              {nodes.map(n => {
                if (n.type === 'keyword') {
                  const isSelected = selectedKeyword === n.id
                  const isRelated = highlightedProjects !== null
                  const r = keywordRadius(n.projectCount ?? 1)
                  return (
                    <g
                      key={n.id}
                      transform={`translate(${n.x},${n.y})`}
                      style={{ cursor: 'pointer' }}
                      onClick={() => setSelectedKeyword(isSelected ? null : n.id)}
                      onMouseEnter={ev => {
                        const rect = svgRef.current?.getBoundingClientRect()
                        if (!rect) return
                        setTooltip({ x: ev.clientX - rect.left, y: ev.clientY - rect.top, node: n })
                      }}
                    >
                      <circle
                        r={r}
                        fill={isSelected ? '#FCD34D' : '#FB923C'}
                        opacity={!isRelated || isSelected ? 1 : 0.4}
                        stroke={isSelected ? '#FCD34D' : 'transparent'}
                        strokeWidth={2}
                      />
                      {r >= 6 && (
                        <text
                          dy={-r - 2}
                          textAnchor="middle"
                          fontSize={7}
                          fontFamily="monospace"
                          fill={isSelected ? '#FCD34D' : '#94A3B8'}
                          opacity={isSelected ? 1 : 0.8}
                        >
                          {n.label.slice(0, 14)}
                        </text>
                      )}
                    </g>
                  )
                } else {
                  // project node
                  const color = projectColor(n.state)
                  const isHighlighted = highlightedProjects?.has(n.id)
                  const dim = highlightedProjects !== null && !isHighlighted
                  return (
                    <g
                      key={n.id}
                      transform={`translate(${n.x},${n.y})`}
                      onMouseEnter={ev => {
                        const rect = svgRef.current?.getBoundingClientRect()
                        if (!rect) return
                        setTooltip({ x: ev.clientX - rect.left, y: ev.clientY - rect.top, node: n })
                      }}
                    >
                      <circle
                        r={isHighlighted ? 16 : 13}
                        fill={color}
                        opacity={dim ? 0.2 : 0.9}
                        stroke={isHighlighted ? '#FCD34D' : 'rgba(255,255,255,0.1)'}
                        strokeWidth={isHighlighted ? 2 : 1}
                      />
                      <text
                        textAnchor="middle"
                        dy={4}
                        fontSize={8}
                        fontFamily="monospace"
                        fill="#020811"
                        fontWeight="bold"
                        opacity={dim ? 0.3 : 1}
                      >
                        {n.label.slice(0, 5)}
                      </text>
                      <text
                        dy={-16}
                        textAnchor="middle"
                        fontSize={7}
                        fontFamily="monospace"
                        fill={color}
                        opacity={dim ? 0.2 : 0.8}
                      >
                        {n.label.slice(0, 12)}
                      </text>
                    </g>
                  )
                }
              })}
            </svg>

            {/* Tooltip */}
            {tooltip && (
              <div
                className="absolute pointer-events-none rounded border border-white/10 px-3 py-2 text-[0.6rem] font-mono"
                style={{
                  background: '#0d1b2e',
                  left: Math.min(tooltip.x + 12, W - 200),
                  top: Math.max(0, tooltip.y - 60),
                  zIndex: 10,
                  maxWidth: 200,
                }}
              >
                {tooltip.node.type === 'project' ? (
                  <>
                    <div className="text-cyan-300 font-bold">{tooltip.node.label}</div>
                    <div className="text-slate-500">state: {tooltip.node.state ?? 'unknown'}</div>
                  </>
                ) : (
                  <>
                    <div className="text-orange-300 font-bold">{tooltip.node.label}</div>
                    <div className="text-slate-500">{tooltip.node.projectCount} project{(tooltip.node.projectCount ?? 0) > 1 ? 's' : ''} share this</div>
                    <div className="text-slate-600 text-[0.5rem] mt-1">click to highlight</div>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Selected keyword project list */}
          {selectedKeyword && highlightedProjects && (
            <div className="mt-4 p-3 rounded border border-white/10" style={{ background: '#0d1b2e' }}>
              <div className="text-[0.6rem] font-mono text-orange-300 mb-2">
                keyword: <span className="font-bold">{selectedKeyword.replace('kw:', '')}</span>
                {' '}· {highlightedProjects.size} project{highlightedProjects.size !== 1 ? 's' : ''}
              </div>
              <div className="flex flex-wrap gap-2">
                {[...highlightedProjects].map(pid => {
                  const slug = pid.replace('proj:', '')
                  const n = nodeMap.get(pid)
                  return (
                    <span
                      key={pid}
                      className="text-[0.55rem] font-mono px-2 py-0.5 rounded"
                      style={{ background: projectColor(n?.state), color: '#020811' }}
                    >
                      {slug}
                    </span>
                  )
                })}
              </div>
            </div>
          )}

          <div className="text-[0.5rem] font-mono text-slate-700 text-right mt-3">
            {nodes.filter(n => n.type === 'project').length} projects ·{' '}
            {nodes.filter(n => n.type === 'keyword').length} shared keywords ·{' '}
            {filteredEdges.length} edges · generated {data?.generatedAt?.slice(0, 16).replace('T', ' ')}
          </div>
        </div>
      )}
    </div>
  )
}
