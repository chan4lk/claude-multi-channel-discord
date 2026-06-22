'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import * as d3 from 'd3'
import { useRouter } from 'next/navigation'
import type { MindMapNode, MindMapLink, MindMapResponse, BranchType } from '../app/api/mindmap/route'

const BRANCH_COLORS: Record<BranchType | 'fleet' | 'project', string> = {
  fleet: '#22D3EE',
  project: '#38BDF8',
  goal: '#22D3EE',
  memory: '#A855F7',
  proposal: '#F59E0B',
}

const BRANCH_RADIUS: Record<string, number> = {
  fleet: 28,
  project: 16,
  goal: 9,
  memory: 9,
  proposal: 9,
}

interface SimNode extends MindMapNode {
  x: number
  y: number
  vx?: number
  vy?: number
  fx?: number | null
  fy?: number | null
}

interface SimLink {
  source: SimNode
  target: SimNode
}

interface Props {
  activeBranches: BranchType[]
}

export default function MindMap({ activeBranches }: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const simRef = useRef<d3.Simulation<SimNode, never> | null>(null)
  const [data, setData] = useState<MindMapResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [tooltip, setTooltip] = useState<{ x: number; y: number; label: string } | null>(null)
  const router = useRouter()

  const fetchData = useCallback(() => {
    fetch('/api/mindmap')
      .then((r) => r.json())
      .then((d: MindMapResponse) => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  useEffect(() => {
    fetchData()
    const id = setInterval(fetchData, 60_000)
    return () => clearInterval(id)
  }, [fetchData])

  useEffect(() => {
    if (!data || !svgRef.current || !containerRef.current) return

    const { width, height } = containerRef.current.getBoundingClientRect()
    const W = width || 900
    const H = height || 700

    // Filter nodes/links based on active branches
    const visibleTypes = new Set<string>(['fleet', 'project', ...activeBranches])
    const visibleNodes = data.nodes.filter((n) => visibleTypes.has(n.type))
    const visibleIds = new Set(visibleNodes.map((n) => n.id))
    const visibleLinks = data.links.filter((l) => visibleIds.has(l.source) && visibleIds.has(l.target))

    const simNodes: SimNode[] = visibleNodes.map((n) => ({
      ...n,
      x: n.type === 'fleet' ? W / 2 : Math.random() * W,
      y: n.type === 'fleet' ? H / 2 : Math.random() * H,
    }))

    const nodeById = new Map(simNodes.map((n) => [n.id, n]))

    const simLinks: SimLink[] = visibleLinks
      .map((l) => ({ source: nodeById.get(l.source)!, target: nodeById.get(l.target)! }))
      .filter((l) => l.source && l.target)

    // Clear SVG
    const svg = d3.select(svgRef.current)
    svg.selectAll('*').remove()

    svg
      .attr('width', W)
      .attr('height', H)
      .attr('viewBox', `0 0 ${W} ${H}`)

    const g = svg.append('g')

    // Zoom
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.3, 3])
      .on('zoom', (event) => g.attr('transform', event.transform))
    svg.call(zoom)

    // Links
    const linkSel = g.append('g')
      .selectAll<SVGLineElement, SimLink>('line')
      .data(simLinks)
      .join('line')
      .attr('stroke', (d) => {
        const targetType = d.target.type as BranchType | 'fleet' | 'project'
        return BRANCH_COLORS[targetType] ?? '#4B5563'
      })
      .attr('stroke-opacity', 0.35)
      .attr('stroke-width', (d) => d.target.type === 'project' ? 1.5 : 0.8)

    // Node groups
    const nodeSel = g.append('g')
      .selectAll<SVGGElement, SimNode>('g')
      .data(simNodes)
      .join('g')
      .style('cursor', (d) => d.href ? 'pointer' : 'default')
      .on('click', (_event, d) => { if (d.href) router.push(d.href) })
      .on('mouseenter', (event, d) => {
        if (d.label.length >= 24) {
          const rect = svgRef.current!.getBoundingClientRect()
          setTooltip({ x: event.clientX - rect.left, y: event.clientY - rect.top, label: d.label })
        }
      })
      .on('mouseleave', () => setTooltip(null))
      .call(
        d3.drag<SVGGElement, SimNode>()
          .on('start', (event, d) => {
            if (!event.active) simRef.current?.alphaTarget(0.3).restart()
            d.fx = d.x; d.fy = d.y
          })
          .on('drag', (event, d) => { d.fx = event.x; d.fy = event.y })
          .on('end', (event, d) => {
            if (!event.active) simRef.current?.alphaTarget(0)
            d.fx = null; d.fy = null
          })
      )

    nodeSel.append('circle')
      .attr('r', (d) => BRANCH_RADIUS[d.type] ?? 8)
      .attr('fill', (d) => {
        const color = BRANCH_COLORS[d.type as BranchType | 'fleet' | 'project'] ?? '#4B5563'
        return d.type === 'fleet' || d.type === 'project' ? color + '22' : color + '18'
      })
      .attr('stroke', (d) => BRANCH_COLORS[d.type as BranchType | 'fleet' | 'project'] ?? '#4B5563')
      .attr('stroke-width', (d) => d.type === 'fleet' ? 2.5 : d.type === 'project' ? 1.5 : 1)

    nodeSel.append('text')
      .attr('text-anchor', 'middle')
      .attr('dy', (d) => d.type === 'fleet' ? '0.35em' : (BRANCH_RADIUS[d.type] ?? 8) + 12)
      .attr('font-size', (d) => d.type === 'fleet' ? 11 : d.type === 'project' ? 9 : 7)
      .attr('font-family', 'JetBrains Mono, monospace')
      .attr('fill', (d) => BRANCH_COLORS[d.type as BranchType | 'fleet' | 'project'] ?? '#94A3B8')
      .attr('opacity', 0.9)
      .text((d) => d.label.length > 20 ? d.label.slice(0, 20) + '…' : d.label)

    // Simulation
    const sim = d3.forceSimulation<SimNode>(simNodes)
      .force('link', d3.forceLink<SimNode, SimLink>(simLinks).id((d) => d.id).distance((d) => {
        if (d.target.type === 'project') return 120
        return 70
      }).strength(0.6))
      .force('charge', d3.forceManyBody<SimNode>().strength((d) => d.type === 'fleet' ? -600 : d.type === 'project' ? -200 : -60))
      .force('center', d3.forceCenter(W / 2, H / 2).strength(0.05))
      .force('collision', d3.forceCollide<SimNode>().radius((d) => (BRANCH_RADIUS[d.type] ?? 8) + 6))

    simRef.current = sim

    // Fix fleet node at center
    const fleetNode = simNodes.find((n) => n.type === 'fleet')
    if (fleetNode) { fleetNode.fx = W / 2; fleetNode.fy = H / 2 }

    sim.on('tick', () => {
      linkSel
        .attr('x1', (d) => d.source.x)
        .attr('y1', (d) => d.source.y)
        .attr('x2', (d) => d.target.x)
        .attr('y2', (d) => d.target.y)
      nodeSel.attr('transform', (d) => `translate(${d.x},${d.y})`)
    })

    return () => { sim.stop() }
  }, [data, activeBranches, router])

  return (
    <div ref={containerRef} className="relative w-full h-full">
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-cyber-cyan/50 text-xs font-mono animate-pulse">LOADING MIND MAP…</span>
        </div>
      )}
      <svg ref={svgRef} className="w-full h-full" />
      {tooltip && (
        <div
          className="pointer-events-none absolute z-50 bg-cyber-surface border border-cyber-cyan/30 rounded px-2 py-1 text-[0.65rem] font-mono text-slate-300 whitespace-nowrap"
          style={{ left: tooltip.x + 12, top: tooltip.y - 24 }}
        >
          {tooltip.label}
        </div>
      )}
    </div>
  )
}
