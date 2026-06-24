'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import * as d3 from 'd3'
import type {
  MemoryConstellationResponse,
  ConstellationKeywordNode,
  ConstellationKeywordEdge,
} from '../app/api/memory-constellation/route'

interface GraphNode extends ConstellationKeywordNode {
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
  weight: number
}

// Node color encodes distinct-project count: isolated (dim slate) → shared (bright cyan).
function colorFor(projectCount: number, max: number): string {
  const frac = max <= 1 ? 0 : (projectCount - 1) / (max - 1)
  return d3.interpolateRgb('#475569', '#22D3EE')(Math.max(0, Math.min(1, frac)))
}

function nodeRadius(occurrences: number, maxOcc: number): number {
  if (maxOcc <= 0) return 8
  return 6 + Math.round(Math.sqrt(occurrences / maxOcc) * 18)
}

interface HoverCard {
  node: GraphNode
}

export default function MemoryConstellation() {
  const svgRef = useRef<SVGSVGElement>(null)
  const [data, setData] = useState<MemoryConstellationResponse | null>(null)
  const [hover, setHover] = useState<HoverCard | null>(null)
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

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/memory-constellation')
      if (res.ok) setData(await res.json())
    } catch {}
  }, [])

  useEffect(() => {
    fetchData()
    const t = setInterval(fetchData, 60_000)
    return () => clearInterval(t)
  }, [fetchData])

  useEffect(() => {
    const svg = svgRef.current
    if (!svg || !data || data.nodes.length === 0) return

    const maxOcc = Math.max(...data.nodes.map((n) => n.occurrences), 1)
    const maxWeight = Math.max(...data.edges.map((e) => e.weight), 1)
    const posCache: Record<string, { x: number; y: number }> = {}
    for (const n of nodesRef.current) {
      if (n.x && n.y) posCache[n.keyword] = { x: n.x, y: n.y }
    }

    const nodes: GraphNode[] = data.nodes.map((n) => ({
      ...n,
      r: nodeRadius(n.occurrences, maxOcc),
      x: posCache[n.keyword]?.x ?? dims.w / 2 + (Math.random() - 0.5) * 200,
      y: posCache[n.keyword]?.y ?? dims.h / 2 + (Math.random() - 0.5) * 200,
    }))
    nodesRef.current = nodes

    const links: GraphLink[] = data.edges.map((e) => ({ ...e }))

    if (simRef.current) simRef.current.stop()

    const sim = d3.forceSimulation(nodes)
      .force('link', d3.forceLink<GraphNode, GraphLink>(links)
        .id((d) => d.keyword)
        .distance(70)
        .strength((l) => Math.min(0.6, 0.15 + (l as GraphLink).weight / (maxWeight * 2))))
      .force('charge', d3.forceManyBody().strength(-120))
      .force('center', d3.forceCenter(dims.w / 2, dims.h / 2).strength(0.05))
      .force('collide', d3.forceCollide<GraphNode>().radius((d) => d.r + 6))
    simRef.current = sim

    const svgSel = d3.select(svg)
    svgSel.selectAll('*').remove()
    svgSel.attr('width', dims.w).attr('height', dims.h)

    const g = svgSel.append('g')

    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.3, 4])
      .on('zoom', (event) => g.attr('transform', event.transform))
    svgSel.call(zoom)

    const defs = svgSel.append('defs')
    const filter = defs.append('filter').attr('id', 'kw-glow').attr('x', '-50%').attr('y', '-50%').attr('width', '200%').attr('height', '200%')
    filter.append('feGaussianBlur').attr('stdDeviation', '3').attr('result', 'blur')
    const feMerge = filter.append('feMerge')
    feMerge.append('feMergeNode').attr('in', 'blur')
    feMerge.append('feMergeNode').attr('in', 'SourceGraphic')

    const linkSel = g.append('g').attr('class', 'links')
      .selectAll('line')
      .data(links)
      .join('line')
      .attr('stroke', '#22D3EE')
      .attr('stroke-opacity', (d) => Math.min(0.5, 0.08 + d.weight / (maxWeight * 1.5)))
      .attr('stroke-width', (d) => Math.max(0.5, Math.min(3, d.weight)))

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
      .on('mouseenter', (_event, d) => setHover({ node: d }))
      .on('mouseleave', () => setHover(null))

    nodeGroup.append('circle')
      .attr('r', (d) => d.r)
      .attr('fill', (d) => `${colorFor(d.projectCount, data.maxProjectCount)}33`)
      .attr('stroke', (d) => colorFor(d.projectCount, data.maxProjectCount))
      .attr('stroke-width', 1.5)
      .attr('filter', 'url(#kw-glow)')

    nodeGroup.append('text')
      .text((d) => d.keyword)
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'middle')
      .attr('fill', (d) => colorFor(d.projectCount, data.maxProjectCount))
      .attr('font-size', (d) => Math.max(7, Math.min(13, d.r * 0.5)))
      .attr('font-family', 'JetBrains Mono, monospace')
      .attr('pointer-events', 'none')

    sim.on('tick', () => {
      linkSel
        .attr('x1', (d) => (d.source as GraphNode).x)
        .attr('y1', (d) => (d.source as GraphNode).y)
        .attr('x2', (d) => (d.target as GraphNode).x)
        .attr('y2', (d) => (d.target as GraphNode).y)
      nodeGroup.attr('transform', (d) => `translate(${d.x},${d.y})`)
    })

    return () => { sim.stop() }
  }, [data, dims])

  const nodeCount = data?.nodes.length ?? 0
  const maxPc = data?.maxProjectCount ?? 0

  return (
    <div className="relative w-full h-full flex flex-col">
      {/* Legend */}
      <div className="absolute top-3 left-3 z-10 flex items-center gap-2 flex-wrap">
        <span className="text-[0.55rem] text-slate-500 font-mono">{nodeCount} themes</span>
        <span className="flex items-center gap-1 text-[0.55rem] text-slate-500 font-mono">
          <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: colorFor(1, maxPc) }} /> isolated
        </span>
        <span className="flex items-center gap-1 text-[0.55rem] text-slate-500 font-mono">
          <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: colorFor(maxPc, maxPc) }} /> shared ({maxPc} projects)
        </span>
        <span className="text-[0.55rem] text-slate-600 font-mono">size ∝ mentions</span>
      </div>

      <div className="flex-1 relative overflow-hidden">
        {nodeCount === 0 ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
            <div className="text-4xl opacity-20">✦</div>
            <p className="text-xs text-slate-600 font-mono">No memory themes found across the fleet</p>
          </div>
        ) : (
          <svg ref={svgRef} className="w-full h-full" style={{ background: 'transparent' }} />
        )}
      </div>

      {/* Hover card: projects referencing this keyword */}
      {hover && (
        <div
          className="absolute bottom-4 right-4 w-72 max-h-64 overflow-y-auto rounded-lg border border-white/10 bg-cyber-surface/95 backdrop-blur-md p-4 shadow-xl pointer-events-none"
          style={{ boxShadow: `0 0 20px ${colorFor(hover.node.projectCount, maxPc)}30` }}
        >
          <div className="flex items-center gap-2 mb-2">
            <span
              className="px-1.5 py-0.5 rounded text-[0.65rem] font-mono font-bold tracking-wider"
              style={{
                color: colorFor(hover.node.projectCount, maxPc),
                border: `1px solid ${colorFor(hover.node.projectCount, maxPc)}40`,
                background: `${colorFor(hover.node.projectCount, maxPc)}12`,
              }}
            >
              {hover.node.keyword}
            </span>
            <span className="text-[0.55rem] font-mono text-slate-500">{hover.node.occurrences}× · {hover.node.projectCount} project{hover.node.projectCount === 1 ? '' : 's'}</span>
          </div>
          <div className="flex flex-wrap gap-1">
            {hover.node.projects.map((p) => (
              <span key={p} className="text-[0.55rem] font-mono text-cyber-cyan/80 bg-cyber-cyan/8 border border-cyber-cyan/20 px-1.5 py-0.5 rounded">{p}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
