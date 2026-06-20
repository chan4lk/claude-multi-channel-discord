'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import * as d3 from 'd3'

interface MemoryRecord {
  id: string
  channel_slug: string | null
  type: string
  content: string
  created_at: string
  last_accessed_at: string
  access_count: number
}

const TYPE_COLORS: Record<string, string> = {
  decision: '#a78bfa',
  pattern: '#34d399',
  coordination: '#f59e0b',
  channel_summary: '#00F5FF',
  general: '#94a3b8',
}

const ALL_TYPES = ['decision', 'pattern', 'coordination', 'channel_summary', 'general']

function nodeRadius(access_count: number, maxAccess: number): number {
  if (maxAccess === 0) return 8
  return 6 + Math.round((access_count / maxAccess) * 14)
}

interface GraphNode extends MemoryRecord {
  x: number
  y: number
  vx?: number
  vy?: number
  fx?: number | null
  fy?: number | null
  r: number
}

interface GraphLink {
  source: string | GraphNode
  target: string | GraphNode
  sharedAccess: number
}

function buildLinks(nodes: GraphNode[]): GraphLink[] {
  const bySlug = new Map<string, GraphNode[]>()
  for (const n of nodes) {
    if (!n.channel_slug) continue
    const arr = bySlug.get(n.channel_slug) ?? []
    arr.push(n)
    bySlug.set(n.channel_slug, arr)
  }
  const links: GraphLink[] = []
  for (const group of bySlug.values()) {
    const sorted = [...group].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
    for (let i = 0; i < sorted.length - 1; i++) {
      links.push({
        source: sorted[i]!.id,
        target: sorted[i + 1]!.id,
        sharedAccess: (sorted[i]!.access_count + sorted[i + 1]!.access_count) / 2,
      })
    }
  }
  return links
}

interface DetailCard {
  mem: MemoryRecord
}

function formatRelative(ts: string): string {
  const diff = Math.floor((Date.now() - new Date(ts).getTime()) / 1000)
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

export default function MemoryGraph() {
  const svgRef = useRef<SVGSVGElement>(null)
  const [records, setRecords] = useState<MemoryRecord[]>([])
  const [activeTypes, setActiveTypes] = useState<Set<string>>(new Set(ALL_TYPES))
  const [detail, setDetail] = useState<DetailCard | null>(null)
  const [dims, setDims] = useState({ w: 800, h: 500 })
  const simRef = useRef<d3.Simulation<GraphNode, undefined> | null>(null)
  const nodesRef = useRef<GraphNode[]>([])

  useEffect(() => {
    const el = svgRef.current?.parentElement
    if (!el) return
    const obs = new ResizeObserver((entries) => {
      const { width, height } = entries[0]!.contentRect
      setDims({ w: Math.floor(width), h: Math.max(400, Math.floor(height)) })
    })
    obs.observe(el)
    setDims({ w: Math.floor(el.clientWidth), h: Math.max(400, Math.floor(el.clientHeight || 500)) })
    return () => obs.disconnect()
  }, [])

  const fetchMemories = useCallback(async () => {
    try {
      const res = await fetch('/api/memories?limit=200')
      if (res.ok) setRecords(await res.json())
    } catch {}
  }, [])

  useEffect(() => {
    fetchMemories()
    const t = setInterval(fetchMemories, 60_000)
    return () => clearInterval(t)
  }, [fetchMemories])

  useEffect(() => {
    const svg = svgRef.current
    if (!svg || records.length === 0) return

    const maxAccess = Math.max(...records.map((r) => r.access_count), 1)
    const posCache: Record<string, { x: number; y: number }> = {}
    for (const n of nodesRef.current) {
      if (n.x && n.y) posCache[n.id] = { x: n.x, y: n.y }
    }

    const nodes: GraphNode[] = records.map((r) => ({
      ...r,
      r: nodeRadius(r.access_count, maxAccess),
      x: posCache[r.id]?.x ?? dims.w / 2 + (Math.random() - 0.5) * 200,
      y: posCache[r.id]?.y ?? dims.h / 2 + (Math.random() - 0.5) * 200,
    }))
    nodesRef.current = nodes

    const links = buildLinks(nodes)

    // Teardown old sim
    if (simRef.current) simRef.current.stop()

    const sim = d3.forceSimulation(nodes)
      .force('link', d3.forceLink<GraphNode, GraphLink>(links)
        .id((d) => d.id)
        .distance(60)
        .strength(0.3))
      .force('charge', d3.forceManyBody().strength(-80))
      .force('center', d3.forceCenter(dims.w / 2, dims.h / 2).strength(0.05))
      .force('collide', d3.forceCollide<GraphNode>().radius((d) => d.r + 4))
    simRef.current = sim

    const svgSel = d3.select(svg)
    svgSel.selectAll('*').remove()
    svgSel.attr('width', dims.w).attr('height', dims.h)

    const g = svgSel.append('g')

    // Zoom
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.3, 4])
      .on('zoom', (event) => g.attr('transform', event.transform))
    svgSel.call(zoom)

    // Defs for glow
    const defs = svgSel.append('defs')
    const filter = defs.append('filter').attr('id', 'node-glow').attr('x', '-50%').attr('y', '-50%').attr('width', '200%').attr('height', '200%')
    filter.append('feGaussianBlur').attr('stdDeviation', '3').attr('result', 'blur')
    const feMerge = filter.append('feMerge')
    feMerge.append('feMergeNode').attr('in', 'blur')
    feMerge.append('feMergeNode').attr('in', 'SourceGraphic')

    // Links
    const linkSel = g.append('g').attr('class', 'links')
      .selectAll('line')
      .data(links)
      .join('line')
      .attr('stroke', '#ffffff')
      .attr('stroke-opacity', (d) => Math.min(0.4, 0.1 + d.sharedAccess / 20))
      .attr('stroke-width', 1)

    // Nodes group
    const nodeGroup = g.append('g').attr('class', 'nodes')
      .selectAll('g')
      .data(nodes)
      .join('g')
      .attr('cursor', 'pointer')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .call(d3.drag<SVGGElement, GraphNode>()
        .on('start', (event, d) => {
          if (!event.active) sim.alphaTarget(0.3).restart()
          d.fx = d.x; d.fy = d.y
        })
        .on('drag', (event, d) => { d.fx = event.x; d.fy = event.y })
        .on('end', (event, d) => {
          if (!event.active) sim.alphaTarget(0)
          d.fx = null; d.fy = null
        }) as any)
      .on('click', (_event, d) => setDetail({ mem: d }))

    nodeGroup.append('circle')
      .attr('r', (d) => d.r)
      .attr('fill', (d) => `${TYPE_COLORS[d.type] ?? '#94a3b8'}22`)
      .attr('stroke', (d) => TYPE_COLORS[d.type] ?? '#94a3b8')
      .attr('stroke-width', 1.5)
      .attr('filter', 'url(#node-glow)')

    nodeGroup.append('text')
      .text((d) => (d.channel_slug ?? d.type).slice(0, 6))
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'middle')
      .attr('fill', (d) => TYPE_COLORS[d.type] ?? '#94a3b8')
      .attr('font-size', (d) => Math.max(6, d.r * 0.55))
      .attr('font-family', 'JetBrains Mono, monospace')
      .attr('pointer-events', 'none')

    function applyVisibility() {
      nodeGroup.attr('display', (d) => (activeTypes.has(d.type) ? null : 'none'))
      linkSel.attr('display', (d) => {
        const s = typeof d.source === 'object' ? (d.source as GraphNode).type : ''
        const t = typeof d.target === 'object' ? (d.target as GraphNode).type : ''
        return activeTypes.has(s) && activeTypes.has(t) ? null : 'none'
      })
    }
    applyVisibility()

    sim.on('tick', () => {
      linkSel
        .attr('x1', (d) => (d.source as GraphNode).x)
        .attr('y1', (d) => (d.source as GraphNode).y)
        .attr('x2', (d) => (d.target as GraphNode).x)
        .attr('y2', (d) => (d.target as GraphNode).y)

      nodeGroup.attr('transform', (d) => `translate(${d.x},${d.y})`)
    })

    return () => { sim.stop() }
  }, [records, dims])

  // Apply visibility filter without rebuilding sim
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const svgSel = d3.select(svg)
    svgSel.selectAll<SVGGElement, GraphNode>('.nodes > g')
      .attr('display', (d) => (activeTypes.has(d.type) ? null : 'none'))
    svgSel.selectAll<SVGLineElement, GraphLink>('.links > line')
      .attr('display', (d) => {
        const s = typeof d.source === 'object' ? (d.source as GraphNode).type : ''
        const t = typeof d.target === 'object' ? (d.target as GraphNode).type : ''
        return activeTypes.has(s) && activeTypes.has(t) ? null : 'none'
      })
  }, [activeTypes])

  function toggleType(type: string) {
    setActiveTypes((prev) => {
      const next = new Set(prev)
      if (next.has(type)) next.delete(type)
      else next.add(type)
      return next
    })
  }

  return (
    <div className="relative w-full h-full flex flex-col">
      {/* Filter chips */}
      <div className="absolute top-3 left-3 z-10 flex items-center gap-1.5 flex-wrap">
        {ALL_TYPES.map((type) => {
          const color = TYPE_COLORS[type] ?? '#94a3b8'
          const active = activeTypes.has(type)
          return (
            <button
              key={type}
              onClick={() => toggleType(type)}
              className="px-2 py-0.5 rounded text-[0.6rem] font-mono font-bold uppercase tracking-wider transition-all"
              style={{
                color: active ? color : '#475569',
                border: `1px solid ${active ? color + '60' : '#334155'}`,
                background: active ? `${color}12` : 'transparent',
              }}
            >
              {type.replace('_', ' ')}
            </button>
          )
        })}
        <span className="text-[0.55rem] text-slate-600 font-mono ml-1">{records.length} memories</span>
      </div>

      {/* SVG */}
      <div className="flex-1 relative overflow-hidden">
        {records.length === 0 ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
            <div className="text-4xl opacity-20">✦</div>
            <p className="text-xs text-slate-600 font-mono">No memories in memory.db</p>
          </div>
        ) : (
          <svg ref={svgRef} className="w-full h-full" style={{ background: 'transparent' }} />
        )}
      </div>

      {/* Detail card */}
      {detail && (
        <div
          className="absolute bottom-4 right-4 w-80 max-h-64 overflow-y-auto rounded-lg border border-white/10 bg-cyber-surface/95 backdrop-blur-md p-4 shadow-xl"
          style={{ boxShadow: `0 0 20px ${TYPE_COLORS[detail.mem.type] ?? '#94a3b8'}30` }}
        >
          <div className="flex items-start justify-between gap-2 mb-2">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span
                className="px-1.5 py-0.5 rounded text-[0.6rem] font-mono font-bold uppercase tracking-wider"
                style={{
                  color: TYPE_COLORS[detail.mem.type] ?? '#94a3b8',
                  border: `1px solid ${(TYPE_COLORS[detail.mem.type] ?? '#94a3b8')}40`,
                  background: `${(TYPE_COLORS[detail.mem.type] ?? '#94a3b8')}12`,
                }}
              >
                {detail.mem.type.replace('_', ' ')}
              </span>
              {detail.mem.channel_slug && (
                <span className="text-[0.6rem] font-mono text-cyber-cyan/70 bg-cyber-cyan/8 border border-cyber-cyan/20 px-1.5 py-0.5 rounded">
                  {detail.mem.channel_slug}
                </span>
              )}
            </div>
            <button
              onClick={() => setDetail(null)}
              className="text-xs text-slate-500 hover:text-slate-300 shrink-0"
            >
              ✕
            </button>
          </div>
          <p className="text-[0.72rem] text-slate-300 leading-relaxed mb-3">{detail.mem.content}</p>
          <div className="flex items-center justify-between text-[0.58rem] text-slate-600 font-mono border-t border-white/5 pt-2">
            <span title={detail.mem.id}>{detail.mem.id.slice(0, 16)}…</span>
            <div className="flex items-center gap-2">
              <span>{detail.mem.access_count}× accessed</span>
              <span>{formatRelative(detail.mem.last_accessed_at)}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
