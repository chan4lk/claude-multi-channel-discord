'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import { Suspense } from 'react'
import Link from 'next/link'
import type { MapData, MapNode, NodeType } from '@/app/api/projects/[slug]/map/route'

const NODE_COLOR: Record<NodeType, string> = {
  memory: '#A855F7',
  schedule: '#22C55E',
  inject: '#22D3EE',
  branch: '#3B82F6',
  proposal: '#F97316',
}

const NODE_LABEL: Record<NodeType, string> = {
  memory: 'Memory',
  schedule: 'Schedule',
  inject: 'Recent Inject',
  branch: 'Branch',
  proposal: 'Proposal',
}

const TYPE_ORDER: NodeType[] = ['memory', 'schedule', 'inject', 'branch', 'proposal']

function groupByType(nodes: MapNode[]): Map<NodeType, MapNode[]> {
  const map = new Map<NodeType, MapNode[]>()
  for (const t of TYPE_ORDER) map.set(t, [])
  for (const n of nodes) {
    const arr = map.get(n.type)
    if (arr) arr.push(n)
  }
  return map
}

interface PositionedNode {
  node: MapNode
  x: number
  y: number
  r: number
  color: string
}

function layoutNodes(nodes: MapNode[], cx: number, cy: number): PositionedNode[] {
  if (nodes.length === 0) return []
  const groups = groupByType(nodes)
  const activeTypes = TYPE_ORDER.filter((t) => (groups.get(t)?.length ?? 0) > 0)

  const result: PositionedNode[] = []
  const outerR = Math.min(cx, cy) * 0.72

  activeTypes.forEach((type, typeIdx) => {
    const typeNodes = groups.get(type) ?? []
    const typeAngle = (typeIdx / activeTypes.length) * 2 * Math.PI - Math.PI / 2
    // Place a "type cluster" center
    const clusterR = outerR
    const clusterCx = cx + clusterR * Math.cos(typeAngle)
    const clusterCy = cy + clusterR * Math.sin(typeAngle)

    typeNodes.forEach((node, ni) => {
      const total = typeNodes.length
      const spread = Math.min(0.4, 0.15 * total) * Math.PI
      const angle = typeAngle + ((ni - (total - 1) / 2) / Math.max(1, total - 1)) * spread
      const dist = outerR * (total > 1 ? 0.88 + 0.12 * (ni % 2) : 1)
      const x = cx + dist * Math.cos(angle)
      const y = cy + dist * Math.sin(angle)
      const r = 6 + node.size * 3
      result.push({ node, x, y, r, color: NODE_COLOR[node.type] })
    })
    void clusterCx; void clusterCy
  })

  return result
}

function DrawerPanel({ node, onClose }: { node: MapNode; onClose: () => void }) {
  return (
    <div
      className="absolute top-0 right-0 bottom-0 w-72 border-l overflow-y-auto z-20 flex flex-col"
      style={{ background: 'rgba(6,13,26,0.97)', borderColor: NODE_COLOR[node.type] + '30' }}
    >
      <div className="sticky top-0 flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: 'rgba(255,255,255,0.06)', background: 'inherit' }}>
        <div>
          <span className="text-[0.5rem] font-mono uppercase tracking-wider" style={{ color: NODE_COLOR[node.type] }}>{NODE_LABEL[node.type]}</span>
          <p className="text-[0.7rem] font-mono text-slate-200 mt-0.5 font-bold">{node.label}</p>
        </div>
        <button onClick={onClose} className="text-slate-500 hover:text-slate-300 text-sm">✕</button>
      </div>
      <div className="p-4 flex-1">
        {node.ts && (
          <p className="text-[0.5rem] font-mono text-slate-600 mb-3">{new Date(node.ts).toLocaleString()}</p>
        )}
        <pre className="text-[0.6rem] font-mono text-slate-400 whitespace-pre-wrap break-words leading-relaxed">
          {node.detail || '(no detail)'}
        </pre>
      </div>
    </div>
  )
}

function RadialMap({ slug, focus }: { slug: string; focus: string | null }) {
  const svgRef = useRef<SVGSVGElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [data, setData] = useState<MapData | null>(null)
  const [loading, setLoading] = useState(true)
  const [dims, setDims] = useState({ w: 600, h: 500 })
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 })
  const [dragging, setDragging] = useState(false)
  const dragStart = useRef<{ mx: number; my: number; tx: number; ty: number } | null>(null)
  const [selectedNode, setSelectedNode] = useState<MapNode | null>(null)
  const [hoveredId, setHoveredId] = useState<string | null>(null)

  const load = useCallback(() => {
    fetch(`/api/projects/${encodeURIComponent(slug)}/map`)
      .then((r) => r.json())
      .then((d: MapData) => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [slug])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setDims({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    setDims({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  // Auto-focus type on URL param
  useEffect(() => {
    if (focus && data) {
      const first = data.nodes.find((n) => n.type === focus)
      if (first) setSelectedNode(first)
    }
  }, [focus, data])

  const cx = dims.w / 2
  const cy = dims.h / 2
  const positioned = data ? layoutNodes(data.nodes, cx, cy) : []

  function onWheel(e: React.WheelEvent) {
    e.preventDefault()
    const factor = e.deltaY < 0 ? 1.1 : 0.9
    setTransform((t) => ({ ...t, scale: Math.max(0.3, Math.min(3, t.scale * factor)) }))
  }

  function onMouseDown(e: React.MouseEvent) {
    dragStart.current = { mx: e.clientX, my: e.clientY, tx: transform.x, ty: transform.y }
    setDragging(true)
  }

  function onMouseMove(e: React.MouseEvent) {
    if (!dragging || !dragStart.current) return
    const dx = e.clientX - dragStart.current.mx
    const dy = e.clientY - dragStart.current.my
    setTransform((t) => ({ ...t, x: dragStart.current!.tx + dx, y: dragStart.current!.ty + dy }))
  }

  function onMouseUp() { setDragging(false); dragStart.current = null }

  const groupedTypes = TYPE_ORDER.filter((t) => (data?.nodes ?? []).some((n) => n.type === t))

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b flex-wrap" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
        <span className="text-[0.55rem] font-mono text-slate-600">{data?.nodes.length ?? 0} nodes</span>
        <div className="flex gap-1 flex-wrap">
          {groupedTypes.map((t) => (
            <span key={t} className="text-[0.5rem] font-mono px-1.5 py-0.5 rounded-full" style={{ background: NODE_COLOR[t] + '20', color: NODE_COLOR[t] }}>
              {NODE_LABEL[t]}
            </span>
          ))}
        </div>
        <div className="flex-1" />
        <button onClick={() => setTransform({ x: 0, y: 0, scale: 1 })} className="text-[0.55rem] font-mono text-slate-500 hover:text-slate-300 border border-slate-700 hover:border-slate-500 px-2 py-0.5 rounded">
          ⊕ Reset
        </button>
        <button onClick={() => setTransform((t) => ({ ...t, scale: Math.min(3, t.scale * 1.2) }))} className="text-[0.55rem] font-mono text-slate-500 hover:text-slate-300 border border-slate-700 px-1.5 py-0.5 rounded">+</button>
        <button onClick={() => setTransform((t) => ({ ...t, scale: Math.max(0.3, t.scale * 0.8) }))} className="text-[0.55rem] font-mono text-slate-500 hover:text-slate-300 border border-slate-700 px-1.5 py-0.5 rounded">−</button>
        <button onClick={load} className="text-[0.55rem] font-mono text-slate-500 hover:text-cyber-cyan border border-slate-700 hover:border-cyber-cyan/30 px-2 py-0.5 rounded">↻</button>
      </div>

      <div className="flex flex-1 relative overflow-hidden">
        {/* SVG canvas */}
        <div
          ref={containerRef}
          className="flex-1 relative overflow-hidden"
          style={{ cursor: dragging ? 'grabbing' : 'grab' }}
          onWheel={onWheel}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
        >
          {loading ? (
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-cyan-400/40 text-sm animate-pulse">Loading map…</span>
            </div>
          ) : (
            <svg ref={svgRef} width={dims.w} height={dims.h} style={{ display: 'block' }}>
              <g transform={`translate(${transform.x},${transform.y}) scale(${transform.scale})`}>
                {/* Edges from center to satellites */}
                {positioned.map((p) => (
                  <line
                    key={`edge-${p.node.id}`}
                    x1={cx} y1={cy} x2={p.x} y2={p.y}
                    stroke={p.color}
                    strokeWidth={hoveredId === p.node.id ? 1.5 : 0.6}
                    strokeOpacity={hoveredId === p.node.id ? 0.6 : 0.2}
                    strokeDasharray={p.node.type === 'proposal' ? '3,3' : undefined}
                  />
                ))}

                {/* Center node */}
                <circle cx={cx} cy={cy} r={28} fill="rgba(0,245,255,0.12)" stroke="#00F5FF" strokeWidth={1.5} />
                <text x={cx} y={cy - 4} textAnchor="middle" fill="#00F5FF" fontSize={9} fontFamily="JetBrains Mono, monospace" fontWeight="bold">{slug}</text>
                <text x={cx} y={cy + 9} textAnchor="middle" fill="#22D3EE80" fontSize={7} fontFamily="JetBrains Mono, monospace">{data?.state ?? ''}</text>

                {/* Satellite nodes */}
                {positioned.map((p) => {
                  const isHovered = hoveredId === p.node.id
                  const isSelected = selectedNode?.id === p.node.id
                  return (
                    <g
                      key={p.node.id}
                      style={{ cursor: 'pointer' }}
                      onClick={() => setSelectedNode(isSelected ? null : p.node)}
                      onMouseEnter={() => setHoveredId(p.node.id)}
                      onMouseLeave={() => setHoveredId(null)}
                    >
                      <circle
                        cx={p.x} cy={p.y} r={p.r + (isHovered || isSelected ? 3 : 0)}
                        fill={p.color}
                        fillOpacity={isSelected ? 0.8 : isHovered ? 0.5 : 0.25}
                        stroke={p.color}
                        strokeWidth={isSelected ? 2 : 1}
                        strokeOpacity={isSelected ? 1 : 0.6}
                      />
                      {(isHovered || p.r > 12) && (
                        <text
                          x={p.x} y={p.y + p.r + 10}
                          textAnchor="middle"
                          fill={p.color}
                          fontSize={7}
                          fontFamily="JetBrains Mono, monospace"
                          style={{ pointerEvents: 'none' }}
                        >
                          {p.node.label.slice(0, 20)}
                        </text>
                      )}
                    </g>
                  )
                })}
              </g>
            </svg>
          )}
        </div>

        {/* Detail drawer */}
        {selectedNode && <DrawerPanel node={selectedNode} onClose={() => setSelectedNode(null)} />}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 px-4 py-1.5 border-t flex-wrap" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
        {TYPE_ORDER.map((t) => (
          <div key={t} className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full inline-block" style={{ background: NODE_COLOR[t] }} />
            <span className="text-[0.5rem] font-mono" style={{ color: NODE_COLOR[t] }}>{NODE_LABEL[t]}</span>
          </div>
        ))}
        <span className="ml-auto text-[0.45rem] font-mono text-slate-700">Scroll = zoom · Drag = pan · Click node = detail</span>
      </div>
    </div>
  )
}

function MapPageInner() {
  const params = useParams()
  const searchParams = useSearchParams()
  const slug = typeof params.slug === 'string' ? params.slug : Array.isArray(params.slug) ? params.slug[0] : ''
  const focus = searchParams.get('focus')

  return (
    <div className="min-h-dvh flex flex-col font-mono" style={{ background: '#060d1a' }}>
      <header className="sticky top-0 z-30 border-b border-cyber-cyan/12 bg-[#060d1a]/90 backdrop-blur-md px-4 py-2.5 flex items-center gap-3">
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-cyber-cyan/40 to-transparent" />
        <Link href={`/projects/${encodeURIComponent(slug)}`} className="text-[0.6rem] font-mono text-slate-500 hover:text-cyber-cyan transition-colors uppercase tracking-wider">
          ← {slug}
        </Link>
        <span className="text-[0.65rem] font-mono font-bold text-cyber-cyan uppercase tracking-widest">Relationship Map</span>
        <span className="text-[0.55rem] font-mono text-slate-600 border border-slate-700 px-1.5 py-0.5 rounded">radial</span>
      </header>

      <div className="flex-1" style={{ minHeight: 0 }}>
        <RadialMap slug={slug} focus={focus} />
      </div>
    </div>
  )
}

export default function MapPage() {
  return (
    <Suspense fallback={
      <div className="min-h-dvh flex items-center justify-center" style={{ background: '#060d1a' }}>
        <div className="text-xs font-mono text-slate-600 animate-pulse">Loading…</div>
      </div>
    }>
      <MapPageInner />
    </Suspense>
  )
}
