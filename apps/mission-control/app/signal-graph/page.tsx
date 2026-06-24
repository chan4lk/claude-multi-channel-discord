'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import * as d3 from 'd3'
import type { CooccurrenceResponse, CooccurrenceNode, CooccurrenceEdge } from '../api/signal-cooccurrence/route'
import { useFreshness } from '../../lib/useFreshness'
import FreshnessBadge from '../../components/FreshnessBadge'

// Node color by dominant severity.
const SEV_COLOR: Record<string, string> = {
  critical: '#ef4444',
  warn: '#fbbf24',
  info: '#00F5FF',
  ok: '#94a3b8',
}

interface SimNode extends CooccurrenceNode {
  x: number
  y: number
  vx?: number
  vy?: number
  fx?: number | null
  fy?: number | null
  r: number
}

interface SimLink {
  source: string | SimNode
  target: string | SimNode
  weight: number
}

function nodeRadius(count: number, max: number): number {
  if (max <= 0) return 10
  return 10 + Math.round(Math.sqrt(count / max) * 22)
}

export default function SignalGraphPage() {
  const { data, isStale, lastError, lastSuccessAt } = useFreshness<CooccurrenceResponse>('/api/signal-cooccurrence', 60_000)
  const loading = data === null && lastError === null

  const svgRef = useRef<SVGSVGElement>(null)
  const simRef = useRef<d3.Simulation<SimNode, undefined> | null>(null)
  const nodesRef = useRef<SimNode[]>([])
  const [dims, setDims] = useState({ w: 800, h: 560 })
  const [hover, setHover] = useState<CooccurrenceNode | null>(null)

  const { nodes, edges, maxNodeCount, maxEdgeWeight, mode, dominantSignal } = useMemo(() => ({
    nodes: data?.nodes ?? [],
    edges: data?.edges ?? [],
    maxNodeCount: data?.maxNodeCount ?? 0,
    maxEdgeWeight: data?.maxEdgeWeight ?? 0,
    mode: data?.mode ?? 'history',
    dominantSignal: data?.dominantSignal ?? null,
  }), [data])

  // Track container size.
  useEffect(() => {
    const el = svgRef.current?.parentElement
    if (!el) return
    const obs = new ResizeObserver((entries) => {
      const { width, height } = entries[0]!.contentRect
      setDims({ w: Math.floor(width), h: Math.max(420, Math.floor(height)) })
    })
    obs.observe(el)
    setDims({ w: Math.floor(el.clientWidth), h: Math.max(420, Math.floor(el.clientHeight || 560)) })
    return () => obs.disconnect()
  }, [nodes.length])

  // Build / rebuild the force sim (mirrors MemoryGraph's pattern).
  useEffect(() => {
    const svg = svgRef.current
    if (!svg || nodes.length === 0) return

    const posCache: Record<string, { x: number; y: number }> = {}
    for (const n of nodesRef.current) if (n.x && n.y) posCache[n.signal] = { x: n.x, y: n.y }

    const simNodes: SimNode[] = nodes.map((n) => ({
      ...n,
      r: nodeRadius(n.count, maxNodeCount),
      x: posCache[n.signal]?.x ?? dims.w / 2 + (Math.random() - 0.5) * 200,
      y: posCache[n.signal]?.y ?? dims.h / 2 + (Math.random() - 0.5) * 200,
    }))
    nodesRef.current = simNodes

    const simLinks: SimLink[] = edges.map((e) => ({ source: e.a, target: e.b, weight: e.weight }))

    if (simRef.current) simRef.current.stop()

    const sim = d3.forceSimulation(simNodes)
      .force('link', d3.forceLink<SimNode, SimLink>(simLinks)
        .id((d) => d.signal)
        .distance((l) => 140 - Math.min(90, (l.weight / Math.max(1, maxEdgeWeight)) * 90))
        .strength((l) => 0.15 + (l.weight / Math.max(1, maxEdgeWeight)) * 0.5))
      .force('charge', d3.forceManyBody().strength(-260))
      .force('center', d3.forceCenter(dims.w / 2, dims.h / 2).strength(0.06))
      .force('collide', d3.forceCollide<SimNode>().radius((d) => d.r + 8))
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
    const filter = defs.append('filter').attr('id', 'sig-glow').attr('x', '-50%').attr('y', '-50%').attr('width', '200%').attr('height', '200%')
    filter.append('feGaussianBlur').attr('stdDeviation', '3').attr('result', 'blur')
    const feMerge = filter.append('feMerge')
    feMerge.append('feMergeNode').attr('in', 'blur')
    feMerge.append('feMergeNode').attr('in', 'SourceGraphic')

    const linkSel = g.append('g').attr('class', 'links')
      .selectAll('line')
      .data(simLinks)
      .join('line')
      .attr('stroke', '#00F5FF')
      .attr('stroke-opacity', (d) => 0.12 + (d.weight / Math.max(1, maxEdgeWeight)) * 0.5)
      .attr('stroke-width', (d) => 1 + (d.weight / Math.max(1, maxEdgeWeight)) * 6)

    const nodeGroup = g.append('g').attr('class', 'nodes')
      .selectAll('g')
      .data(simNodes)
      .join('g')
      .attr('cursor', 'pointer')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .call(d3.drag<SVGGElement, SimNode>()
        .on('start', (event, d) => { if (!event.active) sim.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y })
        .on('drag', (event, d) => { d.fx = event.x; d.fy = event.y })
        .on('end', (event, d) => { if (!event.active) sim.alphaTarget(0); d.fx = null; d.fy = null }) as any)
      .on('mouseenter', (_e, d) => setHover(d))
      .on('mouseleave', () => setHover(null))

    nodeGroup.append('circle')
      .attr('r', (d) => d.r)
      .attr('fill', (d) => `${SEV_COLOR[d.severity] ?? SEV_COLOR.ok}22`)
      .attr('stroke', (d) => SEV_COLOR[d.severity] ?? SEV_COLOR.ok)
      .attr('stroke-width', 1.5)
      .attr('filter', 'url(#sig-glow)')

    nodeGroup.append('text')
      .text((d) => d.signal)
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'middle')
      .attr('fill', (d) => SEV_COLOR[d.severity] ?? SEV_COLOR.ok)
      .attr('font-size', (d) => Math.max(7, Math.min(11, d.r * 0.45)))
      .attr('font-family', 'JetBrains Mono, monospace')
      .attr('pointer-events', 'none')

    nodeGroup.append('text')
      .text((d) => String(d.count))
      .attr('text-anchor', 'middle')
      .attr('dy', (d) => d.r * 0.55 + 8)
      .attr('fill', '#64748b')
      .attr('font-size', 8)
      .attr('font-family', 'JetBrains Mono, monospace')
      .attr('pointer-events', 'none')

    sim.on('tick', () => {
      linkSel
        .attr('x1', (d) => (d.source as SimNode).x)
        .attr('y1', (d) => (d.source as SimNode).y)
        .attr('x2', (d) => (d.target as SimNode).x)
        .attr('y2', (d) => (d.target as SimNode).y)
      nodeGroup.attr('transform', (d) => `translate(${d.x},${d.y})`)
    })

    return () => { sim.stop() }
  }, [nodes, edges, dims, maxNodeCount, maxEdgeWeight])

  if (loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center" style={{ background: '#060d1a' }}>
        <div className="text-xs font-mono text-slate-600 animate-pulse">Loading signal co-occurrence graph…</div>
      </div>
    )
  }

  return (
    <div className="min-h-dvh flex flex-col" style={{ background: '#060d1a' }}>
      <header className="sticky top-0 z-30 border-b border-cyber-cyan/12 bg-[#060d1a]/90 backdrop-blur-md px-6 py-3">
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-cyber-cyan/40 to-transparent" />
        <div className="flex items-center gap-3 flex-wrap">
          <Link href="/" className="text-[0.6rem] font-mono text-slate-500 hover:text-cyber-cyan transition-colors uppercase tracking-wider">← Dashboard</Link>
          <h1 className="text-sm font-black tracking-[0.18em] text-cyber-cyan" style={{ fontFamily: 'Orbitron, JetBrains Mono, monospace' }}>
            Signal Co-occurrence Graph
          </h1>
          <span className="text-[0.6rem] font-mono text-slate-500 border border-slate-700 px-2 py-0.5 rounded">which signals travel together?</span>
          <span className="text-[0.55rem] font-mono px-2 py-0.5 rounded" style={{ color: mode === 'history' ? '#A78BFA' : '#fbbf24', border: `1px solid ${mode === 'history' ? '#A78BFA40' : '#fbbf2440'}` }}>
            {mode === 'history' ? 'history' : 'live snapshot'}
          </span>
          <FreshnessBadge isStale={isStale} lastError={lastError} lastSuccessAt={lastSuccessAt} />
          <div className="flex-1" />
          <div className="flex items-center gap-1.5">
            <span className="text-[0.55rem] font-mono text-slate-500 uppercase tracking-wider">dominant</span>
            <span className="text-xs font-black tabular-nums" style={{ fontFamily: 'Orbitron, monospace', color: dominantSignal ? '#A78BFA' : '#475569' }}>
              {dominantSignal ?? '—'}
            </span>
          </div>
        </div>
      </header>

      <main className="flex-1 p-6 max-w-6xl mx-auto w-full flex flex-col">
        {nodes.length === 0 ? (
          <div className="flex-1 min-h-[24rem] flex flex-col items-center justify-center gap-2 text-center px-6">
            <div className="text-4xl opacity-20">⬡</div>
            <p className="text-xs text-slate-600 font-mono">
              No attention signals to graph. Findings are recorded each time the Fleet Brief computes — open
              <Link href="/brief" className="text-cyber-cyan underline mx-1">Fleet Brief</Link> to start populating co-occurrence.
            </p>
          </div>
        ) : (
          <div className="relative rounded-xl border border-cyber-cyan/12 flex-1 min-h-[28rem] overflow-hidden" style={{ background: 'rgba(0,245,255,0.02)' }}>
            <svg ref={svgRef} className="w-full h-full" style={{ background: 'transparent' }} />

            {/* hover card: projects firing this signal */}
            {hover && (
              <div className="absolute bottom-4 left-4 w-72 max-h-56 overflow-y-auto rounded-lg border border-white/10 bg-cyber-surface/95 backdrop-blur-md p-3 shadow-xl"
                style={{ boxShadow: `0 0 20px ${SEV_COLOR[hover.severity] ?? SEV_COLOR.ok}30` }}>
                <div className="flex items-center gap-2 mb-2">
                  <span className="px-1.5 py-0.5 rounded text-[0.6rem] font-mono font-bold uppercase tracking-wider"
                    style={{ color: SEV_COLOR[hover.severity] ?? SEV_COLOR.ok, border: `1px solid ${(SEV_COLOR[hover.severity] ?? SEV_COLOR.ok)}40`, background: `${(SEV_COLOR[hover.severity] ?? SEV_COLOR.ok)}12` }}>
                    {hover.signal}
                  </span>
                  <span className="text-[0.55rem] font-mono text-slate-500">{hover.count} firing{hover.count === 1 ? '' : 's'}</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {hover.slugs.map((slug) => (
                    <Link key={slug} href={`/brief?slug=${encodeURIComponent(slug)}`}
                      className="text-[0.55rem] font-mono text-slate-400 border border-slate-800 px-1.5 py-0.5 rounded hover:text-cyber-cyan hover:border-cyber-cyan/40 transition-colors">
                      {slug}
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <p className="text-[0.5rem] font-mono text-slate-700 mt-4">
          Force-directed co-occurrence of attention signals over the last 30 days. Each node is a signal type
          (size ∝ total firings, color = worst severity reached); each edge links two signals that fired on the
          same project, with thickness ∝ how often they co-occurred. In <code>history</code> mode the graph is built
          from the <code>attention_event</code> table (P209); when no history exists it degrades to the live finding
          set from the unified P208 engine. Hover a node to list the projects firing it; click a project to open the
          Brief. Reuses <code>/api/signal-cooccurrence</code> and the MemoryGraph force sim. Refreshes every 60s.
        </p>
      </main>
    </div>
  )
}
