'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import * as d3 from 'd3'
import type { KnowledgeNode, KnowledgeEdge, GoalStatus, ProjectState } from '../app/api/knowledge/route'

type FilterType = 'all' | 'project' | 'memory' | 'goal'

const MEM_TYPE_COLORS: Record<string, string> = {
  decision: '#F59E0B',
  pattern: '#4ADE80',
  coordination: '#A78BFA',
  channel_summary: '#22D3EE',
  general: '#94A3B8',
}

const PROJECT_STATE_COLORS: Record<ProjectState, string> = {
  idle: '#00F5FF',
  active: '#4ADE80',
  stalled: '#EF4444',
  autonomous: '#A855F7',
}

const GOAL_STATUS_COLORS: Record<GoalStatus, string> = {
  active: '#C084FC',
  paused: '#64748B',
  completed: '#4ADE80',
}

function nodeColor(n: KnowledgeNode): string {
  if (n.type === 'project') return PROJECT_STATE_COLORS[n.state ?? 'idle']
  if (n.type === 'memory') return MEM_TYPE_COLORS[n.memType ?? 'general'] ?? '#94A3B8'
  return GOAL_STATUS_COLORS[n.goalStatus ?? 'active']
}

// SVG path helpers
function diamondPath(r: number): string {
  return `M 0 ${-r} L ${r} 0 L 0 ${r} L ${-r} 0 Z`
}

function hexPath(r: number): string {
  const pts: string[] = []
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i - Math.PI / 6
    pts.push(`${r * Math.cos(angle)},${r * Math.sin(angle)}`)
  }
  return `M ${pts.join(' L ')} Z`
}

interface SimNode extends KnowledgeNode {
  x: number
  y: number
  vx?: number
  vy?: number
  fx?: number | null
  fy?: number | null
}

interface DrawerContent {
  node: KnowledgeNode
}

const FILTER_STORAGE_KEY = 'mc_knowledge_filter'

function loadFilter(): FilterType {
  try { return (localStorage.getItem(FILTER_STORAGE_KEY) as FilterType) ?? 'all' } catch { return 'all' }
}

function saveFilter(f: FilterType) {
  try { localStorage.setItem(FILTER_STORAGE_KEY, f) } catch {}
}

function formatAge(ageMins: number): string {
  if (ageMins >= 9999) return '—'
  if (ageMins < 60) return `${ageMins}m ago`
  if (ageMins < 1440) return `${Math.floor(ageMins / 60)}h ago`
  return `${Math.floor(ageMins / 1440)}d ago`
}

export default function KnowledgeGraph() {
  const svgRef = useRef<SVGSVGElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const simRef = useRef<d3.Simulation<SimNode, KnowledgeEdge> | null>(null)

  const [filter, setFilter] = useState<FilterType>('all')
  const [drawer, setDrawer] = useState<DrawerContent | null>(null)
  const [allNodes, setAllNodes] = useState<KnowledgeNode[]>([])
  const [allEdges, setAllEdges] = useState<KnowledgeEdge[]>([])
  const [loading, setLoading] = useState(true)
  const [lastFetch, setLastFetch] = useState(0)

  // load filter from localStorage on mount
  useEffect(() => { setFilter(loadFilter()) }, [])

  const fetchData = useCallback(() => {
    fetch('/api/knowledge')
      .then((r) => r.json())
      .then((d: { nodes: KnowledgeNode[]; edges: KnowledgeEdge[] }) => {
        setAllNodes(d.nodes)
        setAllEdges(d.edges)
        setLastFetch(Date.now())
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  useEffect(() => {
    fetchData()
    const iv = setInterval(fetchData, 30_000)
    return () => clearInterval(iv)
  }, [fetchData])

  const visibleNodes = filter === 'all' ? allNodes : allNodes.filter((n) => n.type === filter)
  const visibleIds = new Set(visibleNodes.map((n) => n.id))
  const visibleEdges = allEdges.filter((e) => visibleIds.has(e.source) && visibleIds.has(e.target))

  useEffect(() => {
    const svg = svgRef.current
    const container = containerRef.current
    if (!svg || !container || visibleNodes.length === 0) return

    const { width, height } = container.getBoundingClientRect()
    const W = width || 800
    const H = height || 600

    // clear previous
    d3.select(svg).selectAll('*').remove()

    const root = d3.select(svg)
      .attr('width', W)
      .attr('height', H)

    // defs: arrow marker
    root.append('defs').append('marker')
      .attr('id', 'kg-arrow')
      .attr('viewBox', '0 -3 6 6')
      .attr('refX', 6)
      .attr('refY', 0)
      .attr('markerWidth', 4)
      .attr('markerHeight', 4)
      .attr('orient', 'auto')
      .append('path')
      .attr('d', 'M0,-3L6,0L0,3')
      .attr('fill', '#334155')

    const simNodes: SimNode[] = visibleNodes.map((n) => ({ ...n, x: W / 2 + (Math.random() - 0.5) * 200, y: H / 2 + (Math.random() - 0.5) * 200 }))
    const nodeById = new Map(simNodes.map((n) => [n.id, n]))

    const simEdges: Array<{ source: SimNode; target: SimNode; kind: string }> = visibleEdges
      .map((e) => ({ source: nodeById.get(e.source)!, target: nodeById.get(e.target)!, kind: e.kind }))
      .filter((e) => e.source && e.target)

    // Zoom
    const zoomG = root.append('g')
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.2, 4])
      .on('zoom', (event) => zoomG.attr('transform', event.transform))
    root.call(zoom)

    // Edges
    const linkSel = zoomG.append('g')
      .selectAll<SVGLineElement, typeof simEdges[0]>('line')
      .data(simEdges)
      .join('line')
      .attr('stroke', (d) => d.kind === 'project-goal' ? '#A78BFA30' : '#22D3EE18')
      .attr('stroke-width', 1)
      .attr('marker-end', 'url(#kg-arrow)')

    // Nodes group
    const nodeG = zoomG.append('g')
      .selectAll<SVGGElement, SimNode>('g.kn-node')
      .data(simNodes, (d) => d.id)
      .join('g')
      .attr('class', 'kn-node')
      .style('cursor', 'pointer')
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
      .on('click', (_event, d) => setDrawer({ node: d }))

    // Glow filter
    const defs = root.select('defs')
    const filter = defs.append('filter').attr('id', 'kg-glow').attr('x', '-50%').attr('y', '-50%').attr('width', '200%').attr('height', '200%')
    filter.append('feGaussianBlur').attr('stdDeviation', '3').attr('result', 'blur')
    const merge = filter.append('feMerge')
    merge.append('feMergeNode').attr('in', 'blur')
    merge.append('feMergeNode').attr('in', 'SourceGraphic')

    // Draw shapes per type
    nodeG.each(function(d) {
      const g = d3.select(this)
      const color = nodeColor(d)
      const r = d.size

      if (d.type === 'project') {
        // circle with glow
        g.append('circle')
          .attr('r', r)
          .attr('fill', color + '22')
          .attr('stroke', color)
          .attr('stroke-width', 1.5)
          .attr('filter', 'url(#kg-glow)')
      } else if (d.type === 'memory') {
        // diamond
        g.append('path')
          .attr('d', diamondPath(r))
          .attr('fill', color + '22')
          .attr('stroke', color)
          .attr('stroke-width', 1.5)
      } else {
        // hexagon for goal
        g.append('path')
          .attr('d', hexPath(r))
          .attr('fill', color + '22')
          .attr('stroke', color)
          .attr('stroke-width', 1.5)
          .attr('filter', 'url(#kg-glow)')
      }

      // label
      g.append('text')
        .attr('dy', r + 10)
        .attr('text-anchor', 'middle')
        .attr('font-size', '8px')
        .attr('font-family', 'JetBrains Mono, monospace')
        .attr('fill', '#94A3B8')
        .text(d.label.length > 16 ? d.label.slice(0, 15) + '…' : d.label)
    })

    // Simulation
    const sim = d3.forceSimulation<SimNode>(simNodes)
      .force('link', d3.forceLink<SimNode, typeof simEdges[0]>(simEdges).id((d) => d.id).distance(80).strength(0.4))
      .force('charge', d3.forceManyBody().strength(-120))
      .force('center', d3.forceCenter(W / 2, H / 2).strength(0.05))
      .force('collide', d3.forceCollide<SimNode>((d) => d.size + 10))
      .on('tick', () => {
        linkSel
          .attr('x1', (d) => d.source.x)
          .attr('y1', (d) => d.source.y)
          .attr('x2', (d) => {
            const dx = d.target.x - d.source.x
            const dy = d.target.y - d.source.y
            const dist = Math.sqrt(dx * dx + dy * dy)
            return dist === 0 ? d.target.x : d.target.x - (dx / dist) * (d.target.size + 6)
          })
          .attr('y2', (d) => {
            const dx = d.target.x - d.source.x
            const dy = d.target.y - d.source.y
            const dist = Math.sqrt(dx * dx + dy * dy)
            return dist === 0 ? d.target.y : d.target.y - (dy / dist) * (d.target.size + 6)
          })
        nodeG.attr('transform', (d) => `translate(${d.x},${d.y})`)
      })

    simRef.current = sim as unknown as d3.Simulation<SimNode, KnowledgeEdge>

    return () => { sim.stop() }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleNodes.length, visibleEdges.length, filter, lastFetch])

  function changeFilter(f: FilterType) {
    setFilter(f)
    saveFilter(f)
  }

  const FILTERS: { key: FilterType; label: string; color: string }[] = [
    { key: 'all', label: 'All', color: '#94A3B8' },
    { key: 'project', label: '● Projects', color: '#00F5FF' },
    { key: 'memory', label: '◆ Memories', color: '#F59E0B' },
    { key: 'goal', label: '⬡ Goals', color: '#C084FC' },
  ]

  return (
    <div className="flex h-full">
      {/* Graph area */}
      <div ref={containerRef} className="flex-1 relative overflow-hidden">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-xs font-mono text-cyber-cyan/50 animate-pulse">Loading knowledge graph…</span>
          </div>
        )}
        {!loading && visibleNodes.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-xs font-mono text-slate-600">No nodes — no projects configured</span>
          </div>
        )}
        <svg ref={svgRef} className="w-full h-full" />

        {/* Filter chips */}
        <div className="absolute top-3 left-3 flex gap-1.5">
          {FILTERS.map((f) => {
            const active = filter === f.key
            return (
              <button
                key={f.key}
                onClick={() => changeFilter(f.key)}
                className="text-[0.55rem] px-2 py-0.5 rounded font-mono font-bold uppercase tracking-wider transition-all"
                style={{
                  color: active ? f.color : '#475569',
                  border: `1px solid ${active ? f.color + '60' : '#334155'}`,
                  background: active ? f.color + '12' : 'transparent',
                }}
              >
                {f.label}
              </button>
            )
          })}
        </div>

        {/* Node count */}
        <div className="absolute top-3 right-3 flex flex-col gap-0.5 items-end">
          <span className="text-[0.5rem] font-mono text-slate-600">
            {visibleNodes.filter((n) => n.type === 'project').length} projects ·{' '}
            {visibleNodes.filter((n) => n.type === 'memory').length} memories ·{' '}
            {visibleNodes.filter((n) => n.type === 'goal').length} goals ·{' '}
            {visibleEdges.length} edges
          </span>
        </div>

        {/* Legend */}
        <div className="absolute bottom-3 left-3 flex flex-col gap-1 p-2 rounded" style={{ background: '#060d1a80' }}>
          <span className="text-[0.45rem] font-mono text-slate-600 uppercase tracking-wider">Legend</span>
          <div className="flex items-center gap-1.5">
            <svg width="10" height="10"><circle cx="5" cy="5" r="5" fill="none" stroke="#00F5FF" strokeWidth="1.5" /></svg>
            <span className="text-[0.5rem] font-mono text-slate-500">Project</span>
          </div>
          <div className="flex items-center gap-1.5">
            <svg width="10" height="10"><path d="M5,0 L10,5 L5,10 L0,5 Z" fill="none" stroke="#F59E0B" strokeWidth="1.5" /></svg>
            <span className="text-[0.5rem] font-mono text-slate-500">Memory</span>
          </div>
          <div className="flex items-center gap-1.5">
            <svg width="10" height="10"><path d="M5,0 L9.3,2.5 L9.3,7.5 L5,10 L0.7,7.5 L0.7,2.5 Z" fill="none" stroke="#C084FC" strokeWidth="1.5" /></svg>
            <span className="text-[0.5rem] font-mono text-slate-500">Goal</span>
          </div>
        </div>
      </div>

      {/* Detail drawer */}
      {drawer && (
        <aside
          className="w-64 border-l flex flex-col overflow-y-auto"
          style={{ borderColor: '#1e2d3d', background: '#060d1a' }}
        >
          <div className="flex items-center justify-between px-3 py-2 border-b" style={{ borderColor: '#1e2d3d' }}>
            <span className="text-[0.55rem] font-mono uppercase tracking-wider" style={{ color: nodeColor(drawer.node) }}>
              {drawer.node.type}
            </span>
            <button onClick={() => setDrawer(null)} className="text-slate-600 hover:text-slate-300 text-xs">✕</button>
          </div>

          <div className="p-3 flex flex-col gap-3">
            {drawer.node.type === 'project' && (
              <>
                <div>
                  <p className="text-[0.5rem] font-mono text-slate-600 uppercase mb-0.5">Slug</p>
                  <p className="text-xs font-mono" style={{ color: PROJECT_STATE_COLORS[drawer.node.state ?? 'idle'] }}>{drawer.node.label}</p>
                </div>
                <div>
                  <p className="text-[0.5rem] font-mono text-slate-600 uppercase mb-0.5">State</p>
                  <p className="text-[0.6rem] font-mono text-slate-300">{drawer.node.state}</p>
                </div>
                <div>
                  <p className="text-[0.5rem] font-mono text-slate-600 uppercase mb-0.5">Last Active</p>
                  <p className="text-[0.6rem] font-mono text-slate-300">{formatAge(drawer.node.ageMins ?? 9999)}</p>
                </div>
                <a
                  href={`/projects/${drawer.node.label}`}
                  className="text-[0.55rem] font-mono px-2 py-1 rounded text-center transition-colors"
                  style={{ color: '#00F5FF', border: '1px solid #00F5FF30', background: '#00F5FF08' }}
                >
                  View Timeline →
                </a>
              </>
            )}

            {drawer.node.type === 'memory' && (
              <>
                <div>
                  <p className="text-[0.5rem] font-mono text-slate-600 uppercase mb-0.5">Type</p>
                  <p className="text-[0.6rem] font-mono" style={{ color: MEM_TYPE_COLORS[drawer.node.memType ?? 'general'] ?? '#94A3B8' }}>
                    {drawer.node.memType}
                  </p>
                </div>
                {drawer.node.channelSlug && (
                  <div>
                    <p className="text-[0.5rem] font-mono text-slate-600 uppercase mb-0.5">Project</p>
                    <p className="text-[0.6rem] font-mono text-cyan-400">{drawer.node.channelSlug}</p>
                  </div>
                )}
                <div>
                  <p className="text-[0.5rem] font-mono text-slate-600 uppercase mb-0.5">Access Count</p>
                  <p className="text-[0.6rem] font-mono text-slate-300">{drawer.node.accessCount ?? 0}</p>
                </div>
                <div>
                  <p className="text-[0.5rem] font-mono text-slate-600 uppercase mb-0.5">Content</p>
                  <p className="text-[0.6rem] font-mono text-slate-400 leading-relaxed whitespace-pre-wrap break-words">{drawer.node.content}</p>
                </div>
                <a
                  href="/memory-graph"
                  className="text-[0.55rem] font-mono px-2 py-1 rounded text-center transition-colors"
                  style={{ color: '#F59E0B', border: '1px solid #F59E0B30', background: '#F59E0B08' }}
                >
                  Memory Graph →
                </a>
              </>
            )}

            {drawer.node.type === 'goal' && (
              <>
                <div>
                  <p className="text-[0.5rem] font-mono text-slate-600 uppercase mb-0.5">Status</p>
                  <p className="text-[0.6rem] font-mono" style={{ color: GOAL_STATUS_COLORS[drawer.node.goalStatus ?? 'active'] }}>
                    {drawer.node.goalStatus}
                  </p>
                </div>
                <div>
                  <p className="text-[0.5rem] font-mono text-slate-600 uppercase mb-0.5">Goal</p>
                  <p className="text-[0.6rem] font-mono text-slate-300 leading-relaxed whitespace-pre-wrap break-words">{drawer.node.goalText}</p>
                </div>
                {drawer.node.id.startsWith('goal:') && (
                  <a
                    href={`/projects/${drawer.node.id.slice(5)}`}
                    className="text-[0.55rem] font-mono px-2 py-1 rounded text-center transition-colors"
                    style={{ color: '#C084FC', border: '1px solid #C084FC30', background: '#C084FC08' }}
                  >
                    Project Timeline →
                  </a>
                )}
              </>
            )}
          </div>
        </aside>
      )}
    </div>
  )
}
