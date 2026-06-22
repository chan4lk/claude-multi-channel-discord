'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import * as d3 from 'd3'
import type { TopologyNode, TopologyEdge, TopologyEvent, TopologyResponse } from '../app/api/topology/route'

type StatusFilter = 'active' | 'idle' | 'stuck'
type TimeWindow = '1m' | '5m' | '15m'

interface SimNode extends TopologyNode {
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
  weight: number
}

interface Particle {
  edge: SimEdge
  t: number // 0..1 along edge
  speed: number
}

const STATE_COLORS: Record<string, string> = {
  active: '#22D3EE',
  idle: '#F59E0B',
  stuck: '#EF4444',
}

export default function TopologyGraph() {
  const containerRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const simRef = useRef<d3.Simulation<SimNode, never> | null>(null)
  const particlesRef = useRef<Particle[]>([])
  const rafRef = useRef<number>(0)
  const nodesRef = useRef<SimNode[]>([])
  const edgesRef = useRef<SimEdge[]>([])
  const pausedRef = useRef(false)

  const [data, setData] = useState<TopologyResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [paused, setPaused] = useState(false)
  const [filter, setFilter] = useState<StatusFilter[]>(['active', 'idle', 'stuck'])
  const [timeWindow] = useState<TimeWindow>('15m')
  const [events, setEvents] = useState<TopologyEvent[]>([])

  const fetchData = useCallback(() => {
    if (pausedRef.current) return
    fetch(`/api/topology?window=${timeWindow}`)
      .then((r) => r.json())
      .then((d: TopologyResponse) => {
        setData(d)
        setEvents(d.events)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [timeWindow])

  useEffect(() => {
    fetchData()
    const iv = setInterval(fetchData, 5_000)
    return () => clearInterval(iv)
  }, [fetchData])

  // Particle animation loop on canvas
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    function animate() {
      if (!ctx || !canvas) return
      ctx.clearRect(0, 0, canvas.width, canvas.height)

      if (!pausedRef.current) {
        // Advance particles
        particlesRef.current = particlesRef.current
          .map((p) => ({ ...p, t: p.t + p.speed }))
          .filter((p) => p.t <= 1)

        // Spawn new particles for active edges
        for (const edge of edgesRef.current) {
          if (Math.random() < 0.03 * edge.weight) {
            particlesRef.current.push({ edge, t: 0, speed: 0.008 + Math.random() * 0.006 })
          }
        }
      }

      // Draw particles
      for (const p of particlesRef.current) {
        const sx = p.edge.source.x
        const sy = p.edge.source.y
        const tx = p.edge.target.x
        const ty = p.edge.target.y
        if (isNaN(sx) || isNaN(sy) || isNaN(tx) || isNaN(ty)) continue
        const x = sx + (tx - sx) * p.t
        const y = sy + (ty - sy) * p.t

        ctx.beginPath()
        ctx.arc(x, y, 2.5, 0, Math.PI * 2)
        ctx.fillStyle = '#22D3EE'
        ctx.shadowColor = '#22D3EE'
        ctx.shadowBlur = 6
        ctx.fill()
        ctx.shadowBlur = 0
      }

      rafRef.current = requestAnimationFrame(animate)
    }

    rafRef.current = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(rafRef.current)
  }, [])

  // D3 force simulation
  useEffect(() => {
    const svg = svgRef.current
    const container = containerRef.current
    const canvas = canvasRef.current
    if (!svg || !container || !canvas || !data) return

    const { width, height } = container.getBoundingClientRect()
    const W = width || 800
    const H = height || 600

    canvas.width = W
    canvas.height = H

    const filteredNodes = data.nodes.filter((n) => filter.includes(n.state))
    const filteredSlugs = new Set(filteredNodes.map((n) => n.id))
    const filteredEdges = data.edges.filter(
      (e) => filteredSlugs.has(e.source) && filteredSlugs.has(e.target)
    )

    const simNodes: SimNode[] = filteredNodes.map((n) => {
      const existing = nodesRef.current.find((sn) => sn.id === n.id)
      return {
        ...n,
        x: existing?.x ?? W / 2 + (Math.random() - 0.5) * 200,
        y: existing?.y ?? H / 2 + (Math.random() - 0.5) * 200,
      }
    })

    const nodeById = new Map(simNodes.map((n) => [n.id, n]))
    const simEdges: SimEdge[] = filteredEdges
      .map((e) => {
        const source = nodeById.get(e.source)
        const target = nodeById.get(e.target)
        if (!source || !target) return null
        return { source, target, weight: e.weight }
      })
      .filter(Boolean) as SimEdge[]

    nodesRef.current = simNodes
    edgesRef.current = simEdges

    d3.select(svg).selectAll('*').remove()

    const root = d3.select(svg).attr('width', W).attr('height', H)

    const defs = root.append('defs')
    for (const [state, color] of Object.entries(STATE_COLORS)) {
      const glow = defs.append('filter')
        .attr('id', `glow-${state}`)
        .attr('x', '-80%').attr('y', '-80%').attr('width', '260%').attr('height', '260%')
      glow.append('feGaussianBlur').attr('stdDeviation', '5').attr('result', 'blur')
      const merge = glow.append('feMerge')
      merge.append('feMergeNode').attr('in', 'blur')
      merge.append('feMergeNode').attr('in', 'SourceGraphic')
      void color
    }

    // Arrow marker
    defs.append('marker')
      .attr('id', 'arrow')
      .attr('viewBox', '0 -5 10 10')
      .attr('refX', 18)
      .attr('refY', 0)
      .attr('markerWidth', 6)
      .attr('markerHeight', 6)
      .attr('orient', 'auto')
      .append('path')
      .attr('d', 'M0,-5L10,0L0,5')
      .attr('fill', '#22D3EE44')

    const zoomG = root.append('g')
    root.call(
      d3.zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.2, 4])
        .on('zoom', (ev) => zoomG.attr('transform', ev.transform))
    )

    // Grid background
    const gridStep = 60
    for (let x = 0; x < W; x += gridStep) {
      zoomG.append('line').attr('x1', x).attr('y1', 0).attr('x2', x).attr('y2', H)
        .attr('stroke', '#22D3EE08').attr('stroke-width', 1)
    }
    for (let y = 0; y < H; y += gridStep) {
      zoomG.append('line').attr('x1', 0).attr('y1', y).attr('x2', W).attr('y2', y)
        .attr('stroke', '#22D3EE08').attr('stroke-width', 1)
    }

    // Edges
    const linkSel = zoomG.append('g')
      .selectAll<SVGLineElement, SimEdge>('line')
      .data(simEdges)
      .join('line')
      .attr('stroke', '#22D3EE33')
      .attr('stroke-width', (d) => Math.min(4, 1 + d.weight * 0.5))
      .attr('marker-end', 'url(#arrow)')

    // Nodes
    const nodeSel = zoomG.append('g')
      .selectAll<SVGGElement, SimNode>('g')
      .data(simNodes, (d) => d.id)
      .join('g')
      .call(
        d3.drag<SVGGElement, SimNode>()
          .on('start', (ev, d) => {
            if (!ev.active && simRef.current) simRef.current.alphaTarget(0.3).restart()
            d.fx = d.x; d.fy = d.y
          })
          .on('drag', (ev, d) => { d.fx = ev.x; d.fy = ev.y })
          .on('end', (ev, d) => {
            if (!ev.active && simRef.current) simRef.current.alphaTarget(0)
            d.fx = null; d.fy = null
          })
      )

    nodeSel.append('circle')
      .attr('r', (d) => Math.max(14, Math.min(30, 14 + d.turnsPerHour * 0.8)))
      .attr('fill', '#060d1a')
      .attr('stroke', (d) => STATE_COLORS[d.state] ?? '#475569')
      .attr('stroke-width', 2.5)
      .attr('filter', (d) => d.state === 'active' ? `url(#glow-${d.state})` : '')

    // Pulse ring for active
    nodeSel.filter((d) => d.state === 'active')
      .append('circle')
      .attr('r', (d) => Math.max(14, Math.min(30, 14 + d.turnsPerHour * 0.8)) + 6)
      .attr('fill', 'none')
      .attr('stroke', '#22D3EE')
      .attr('stroke-width', 1)
      .attr('opacity', 0.3)

    nodeSel.append('text')
      .attr('text-anchor', 'middle')
      .attr('dy', (d) => Math.max(14, Math.min(30, 14 + d.turnsPerHour * 0.8)) + 14)
      .attr('font-size', 9)
      .attr('font-family', 'JetBrains Mono, monospace')
      .attr('fill', '#94A3B8')
      .text((d) => d.slug.slice(0, 14))

    nodeSel.append('title')
      .text((d) => `${d.slug}\nState: ${d.state}\nTurns/hr: ${d.turnsPerHour}\nLast reply: ${d.lastReplyAge < 0 ? 'never' : `${d.lastReplyAge}s ago`}`)

    const sim = d3.forceSimulation<SimNode>(simNodes)
      .force('link', d3.forceLink<SimNode, SimEdge>(simEdges).id((d) => d.id).distance(140))
      .force('charge', d3.forceManyBody().strength(-300))
      .force('center', d3.forceCenter(W / 2, H / 2))
      .force('collision', d3.forceCollide(40))

    simRef.current = sim

    sim.on('tick', () => {
      linkSel
        .attr('x1', (d) => d.source.x)
        .attr('y1', (d) => d.source.y)
        .attr('x2', (d) => d.target.x)
        .attr('y2', (d) => d.target.y)

      nodeSel.attr('transform', (d) => `translate(${d.x},${d.y})`)
    })

    return () => { sim.stop() }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, filter])

  function toggleFilter(f: StatusFilter) {
    setFilter((prev) => prev.includes(f) ? prev.filter((x) => x !== f) : [...prev, f])
  }

  function togglePause() {
    pausedRef.current = !pausedRef.current
    setPaused(pausedRef.current)
  }

  const FILTERS: { key: StatusFilter; label: string; color: string }[] = [
    { key: 'active', label: 'Active', color: STATE_COLORS.active },
    { key: 'idle', label: 'Idle', color: STATE_COLORS.idle },
    { key: 'stuck', label: 'Stuck', color: STATE_COLORS.stuck },
  ]

  return (
    <div className="flex h-full">
      {/* Graph area */}
      <div ref={containerRef} className="relative flex-1 overflow-hidden">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="font-mono text-xs text-cyber-cyan animate-pulse">Mapping topology…</span>
          </div>
        )}
        <svg ref={svgRef} className="absolute inset-0 w-full h-full" />
        <canvas ref={canvasRef} className="absolute inset-0 pointer-events-none" />

        {/* Controls overlay */}
        <div className="absolute top-3 left-3 flex flex-col gap-2">
          <div className="flex gap-1.5">
            {FILTERS.map((f) => {
              const active = filter.includes(f.key)
              return (
                <button
                  key={f.key}
                  onClick={() => toggleFilter(f.key)}
                  className="text-[0.55rem] px-2 py-0.5 rounded font-mono font-bold uppercase tracking-wider transition-all"
                  style={{
                    color: active ? f.color : '#475569',
                    border: `1px solid ${active ? f.color + '60' : '#334155'}`,
                    background: active ? f.color + '14' : 'transparent',
                  }}
                >
                  {f.label}
                </button>
              )
            })}
          </div>
          <button
            onClick={togglePause}
            className="text-[0.55rem] px-2 py-0.5 rounded font-mono font-bold uppercase tracking-wider border transition-all self-start"
            style={{
              color: paused ? '#F59E0B' : '#94A3B8',
              borderColor: paused ? '#F59E0B60' : '#334155',
              background: paused ? '#F59E0B14' : 'transparent',
            }}
          >
            {paused ? '▶ Resume' : '⏸ Pause'}
          </button>
        </div>

        {/* Computed-at badge */}
        {data && (
          <div className="absolute bottom-3 left-3 text-[0.5rem] font-mono text-slate-700">
            Updated {new Date(data.computedAt).toLocaleTimeString()} · {data.nodes.length} nodes · {data.edges.length} edges
          </div>
        )}
      </div>

      {/* Event log sidebar */}
      <div
        className="w-52 flex-shrink-0 border-l border-cyber-cyan/10 flex flex-col overflow-hidden"
        style={{ background: '#040a14' }}
      >
        <div
          className="px-3 py-2 text-[0.55rem] font-mono uppercase tracking-widest font-bold border-b border-cyber-cyan/10"
          style={{ color: '#22D3EE' }}
        >
          Live Events
        </div>
        <div className="flex-1 overflow-y-auto">
          {events.length === 0 ? (
            <div className="px-3 py-4 text-[0.55rem] font-mono text-slate-700">No recent events</div>
          ) : (
            events.map((ev, i) => (
              <div key={i} className="px-3 py-1.5 border-b border-white/5 flex flex-col gap-0.5">
                <div className="flex items-center gap-1.5">
                  <span
                    className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                    style={{ background: ev.action === 'reply' ? '#22D3EE' : '#A78BFA' }}
                  />
                  <span className="text-[0.6rem] font-mono font-bold text-slate-300 truncate">{ev.slug}</span>
                </div>
                <div className="text-[0.5rem] font-mono text-slate-600">
                  {ev.action} · {new Date(ev.ts).toLocaleTimeString()}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
