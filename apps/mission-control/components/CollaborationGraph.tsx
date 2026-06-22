'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import * as d3 from 'd3'
import type { CollabNode, CollabEdge, CollabGraphResponse, ConnectionType } from '../app/api/collaboration-graph/route'

const TYPE_COLORS: Record<ConnectionType, string> = {
  memory: '#A855F7',
  goal: '#22D3EE',
  proposal: '#F59E0B',
}

interface SimNode extends CollabNode {
  x: number
  y: number
  vx?: number
  vy?: number
  fx?: number | null
  fy?: number | null
}

interface SimEdge {
  source: SimNode
  target: SimNode
  score: number
  types: ConnectionType[]
  sharedKeywords: string[]
}

interface EdgePopover {
  x: number
  y: number
  edge: SimEdge
}

interface Props {
  minScore: number
  activeTypes: ConnectionType[]
}

export default function CollaborationGraph({ minScore, activeTypes }: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const simRef = useRef<d3.Simulation<SimNode, never> | null>(null)

  const [data, setData] = useState<CollabGraphResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [popover, setPopover] = useState<EdgePopover | null>(null)

  const fetchData = useCallback(() => {
    const params = new URLSearchParams({
      minScore: String(minScore),
      types: activeTypes.join(','),
    })
    fetch(`/api/collaboration-graph?${params}`)
      .then((r) => r.json())
      .then((d: CollabGraphResponse) => {
        setData(d)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [minScore, activeTypes])

  useEffect(() => {
    fetchData()
    const iv = setInterval(fetchData, 60_000)
    return () => clearInterval(iv)
  }, [fetchData])

  useEffect(() => {
    const svg = svgRef.current
    const container = containerRef.current
    if (!svg || !container || !data) return

    const { width, height } = container.getBoundingClientRect()
    const W = width || 800
    const H = height || 600

    d3.select(svg).selectAll('*').remove()

    const root = d3.select(svg).attr('width', W).attr('height', H)

    // Glow filter
    const defs = root.append('defs')
    const glow = defs.append('filter').attr('id', 'cg-glow').attr('x', '-60%').attr('y', '-60%').attr('width', '220%').attr('height', '220%')
    glow.append('feGaussianBlur').attr('stdDeviation', '4').attr('result', 'blur')
    const merge = glow.append('feMerge')
    merge.append('feMergeNode').attr('in', 'blur')
    merge.append('feMergeNode').attr('in', 'SourceGraphic')

    const zoomG = root.append('g')
    root.call(
      d3.zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.15, 5])
        .on('zoom', (ev) => zoomG.attr('transform', ev.transform))
    )

    const simNodes: SimNode[] = data.nodes.map((n) => ({
      ...n,
      x: W / 2 + (Math.random() - 0.5) * 300,
      y: H / 2 + (Math.random() - 0.5) * 300,
    }))
    const nodeById = new Map(simNodes.map((n) => [n.id, n]))

    const simEdges: SimEdge[] = data.edges
      .map((e) => ({
        source: nodeById.get(e.source)!,
        target: nodeById.get(e.target)!,
        score: e.score,
        types: e.types,
        sharedKeywords: e.sharedKeywords,
      }))
      .filter((e) => e.source && e.target)

    // Edges
    const linkG = zoomG.append('g')
    const linkSel = linkG
      .selectAll<SVGLineElement, SimEdge>('line')
      .data(simEdges)
      .join('line')
      .attr('stroke-linecap', 'round')
      .attr('stroke', (d) => {
        // multi-type: blend or use first type's color
        if (d.types.length === 1) return TYPE_COLORS[d.types[0]] + '70'
        return '#94A3B870'
      })
      .attr('stroke-width', (d) => Math.max(0.8, d.score * 6))
      .style('cursor', 'pointer')
      .on('click', (event, d) => {
        event.stopPropagation()
        const pt = d3.pointer(event, svg)
        setPopover({ x: pt[0], y: pt[1], edge: d })
      })

    // Nodes
    const nodeG = zoomG.append('g')
      .selectAll<SVGGElement, SimNode>('g.cg-node')
      .data(simNodes, (d) => d.id)
      .join('g')
      .attr('class', 'cg-node')
      .style('cursor', 'grab')
      .call(
        d3.drag<SVGGElement, SimNode>()
          .on('start', (event, d) => {
            if (!event.active) sim.alphaTarget(0.3).restart()
            d.fx = d.x; d.fy = d.y
          })
          .on('drag', (event, d) => { d.fx = event.x; d.fy = event.y })
          .on('end', (event, d) => {
            if (!event.active) sim.alphaTarget(0)
            d.fx = null; d.fy = null
          })
      )
      .on('click', () => setPopover(null))

    nodeG.append('circle')
      .attr('r', (d) => Math.max(10, Math.sqrt(d.turnCount / 20) + 10))
      .attr('fill', '#00F5FF18')
      .attr('stroke', '#00F5FF')
      .attr('stroke-width', 1.5)
      .attr('filter', 'url(#cg-glow)')

    nodeG.append('text')
      .attr('text-anchor', 'middle')
      .attr('dy', '0.35em')
      .attr('font-size', '8px')
      .attr('font-family', 'JetBrains Mono, monospace')
      .attr('fill', '#E2E8F0')
      .attr('pointer-events', 'none')
      .text((d) => d.slug.length > 10 ? d.slug.slice(0, 9) + '…' : d.slug)

    nodeG.append('text')
      .attr('text-anchor', 'middle')
      .attr('dy', (d) => Math.max(10, Math.sqrt(d.turnCount / 20) + 10) + 12)
      .attr('font-size', '7px')
      .attr('font-family', 'JetBrains Mono, monospace')
      .attr('fill', '#475569')
      .attr('pointer-events', 'none')
      .text((d) => `${d.turnCount}t`)

    const sim = d3.forceSimulation<SimNode>(simNodes)
      .force('link', d3.forceLink<SimNode, SimEdge>(simEdges)
        .id((d) => d.id)
        .distance((d) => Math.max(60, 200 * (1 - d.score)))
        .strength(0.3))
      .force('charge', d3.forceManyBody().strength(-180))
      .force('center', d3.forceCenter(W / 2, H / 2).strength(0.05))
      .force('collide', d3.forceCollide<SimNode>((d) => Math.max(10, Math.sqrt(d.turnCount / 20) + 15))
      )
      .on('tick', () => {
        linkSel
          .attr('x1', (d) => d.source.x)
          .attr('y1', (d) => d.source.y)
          .attr('x2', (d) => d.target.x)
          .attr('y2', (d) => d.target.y)
        nodeG.attr('transform', (d) => `translate(${d.x},${d.y})`)
      })

    simRef.current = sim as unknown as d3.Simulation<SimNode, never>

    // Close popover on svg bg click
    root.on('click', () => setPopover(null))

    return () => { sim.stop() }
  }, [data])

  const nodeCount = data?.nodes.length ?? 0
  const edgeCount = data?.edges.length ?? 0

  return (
    <div ref={containerRef} className="relative w-full h-full">
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-xs font-mono text-cyber-cyan/50 animate-pulse">Computing collaboration network…</span>
        </div>
      )}
      {!loading && nodeCount === 0 && (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-xs font-mono text-slate-600">No projects with memory data found</span>
        </div>
      )}
      {!loading && nodeCount > 0 && edgeCount === 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className="text-xs font-mono text-slate-500">No connections above threshold — lower the min-score</span>
        </div>
      )}
      <svg ref={svgRef} className="w-full h-full" />

      {/* Stats badge */}
      <div className="absolute bottom-3 left-3 flex gap-2">
        <span className="text-[0.55rem] font-mono text-slate-600 bg-cyber-surface/80 px-2 py-0.5 rounded border border-slate-700/40">
          {nodeCount} projects · {edgeCount} connections
        </span>
      </div>

      {/* Edge popover */}
      {popover && (
        <div
          className="absolute z-50 pointer-events-none"
          style={{ left: Math.min(popover.x + 12, window.innerWidth - 240), top: Math.min(popover.y - 8, window.innerHeight - 200) }}
        >
          <div className="bg-cyber-surface border border-cyber-cyan/20 rounded-lg p-3 shadow-xl w-56">
            <div className="flex items-center gap-1.5 mb-2">
              <span className="text-[0.6rem] font-mono font-bold text-cyber-cyan">{popover.edge.source.slug}</span>
              <span className="text-[0.55rem] text-slate-500">↔</span>
              <span className="text-[0.6rem] font-mono font-bold text-cyber-cyan">{popover.edge.target.slug}</span>
            </div>
            <div className="flex flex-wrap gap-1 mb-2">
              {popover.edge.types.map((t) => (
                <span
                  key={t}
                  className="text-[0.5rem] px-1.5 py-0.5 rounded font-mono uppercase tracking-wider"
                  style={{ color: TYPE_COLORS[t], border: `1px solid ${TYPE_COLORS[t]}50`, background: `${TYPE_COLORS[t]}18` }}
                >
                  {t}
                </span>
              ))}
              <span className="text-[0.5rem] font-mono text-slate-500 ml-auto">
                {(popover.edge.score * 100).toFixed(0)}% match
              </span>
            </div>
            {popover.edge.sharedKeywords.length > 0 && (
              <div>
                <p className="text-[0.5rem] font-mono text-slate-500 uppercase tracking-wider mb-1">Shared topics</p>
                <div className="flex flex-wrap gap-0.5">
                  {popover.edge.sharedKeywords.map((kw) => (
                    <span key={kw} className="text-[0.5rem] font-mono text-slate-400 bg-slate-800/60 px-1 py-0.5 rounded">
                      {kw}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
