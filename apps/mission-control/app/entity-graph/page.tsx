'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import * as d3 from 'd3'
import type { EntityGraphResponse, EntityNode, EntityKind } from '../api/entity-graph/route'
import { useFreshness } from '../../lib/useFreshness'
import FreshnessBadge from '../../components/FreshnessBadge'
import SubPageHeader from '../../components/SubPageHeader'

const KIND_COLOR: Record<EntityKind, string> = {
  project: '#00F5FF',
  memory: '#A78BFA',
  proposal: '#fbbf24',
}

const KIND_LABEL: Record<EntityKind, string> = {
  project: 'Project',
  memory: 'Memory',
  proposal: 'Proposal',
}

interface SimNode extends EntityNode {
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
}

function nodeRadius(n: EntityNode, maxDegree: number): number {
  if (n.kind !== 'project') return n.kind === 'memory' ? 5 : 4
  if (maxDegree <= 0) return 12
  return 11 + Math.round(Math.sqrt(n.degree / maxDegree) * 20)
}

export default function EntityGraphPage() {
  const { data, isStale, lastError, lastSuccessAt } = useFreshness<EntityGraphResponse>('/api/entity-graph', 60_000)
  const loading = data === null && lastError === null

  const svgRef = useRef<SVGSVGElement>(null)
  const simRef = useRef<d3.Simulation<SimNode, undefined> | null>(null)
  const nodesRef = useRef<SimNode[]>([])
  const [dims, setDims] = useState({ w: 900, h: 600 })
  const [selected, setSelected] = useState<EntityNode | null>(null)
  const [layers, setLayers] = useState<Record<EntityKind, boolean>>({ project: true, memory: true, proposal: true })

  const allNodes = useMemo(() => data?.nodes ?? [], [data])
  const allEdges = useMemo(() => data?.edges ?? [], [data])
  const counts = data?.counts ?? { projects: 0, memories: 0, proposals: 0 }

  // Apply layer toggles. Projects always shown; memory/proposal independently filtered.
  const { nodes, edges } = useMemo(() => {
    const visible = allNodes.filter((n) => layers[n.kind])
    const ids = new Set(visible.map((n) => n.id))
    const e = allEdges.filter((l) => ids.has(l.source) && ids.has(l.target))
    return { nodes: visible, edges: e }
  }, [allNodes, allEdges, layers])

  const maxDegree = useMemo(() => nodes.reduce((m, n) => (n.kind === 'project' ? Math.max(m, n.degree) : m), 0), [nodes])

  useEffect(() => {
    const el = svgRef.current?.parentElement
    if (!el) return
    const obs = new ResizeObserver((entries) => {
      const { width, height } = entries[0]!.contentRect
      setDims({ w: Math.floor(width), h: Math.max(440, Math.floor(height)) })
    })
    obs.observe(el)
    setDims({ w: Math.floor(el.clientWidth), h: Math.max(440, Math.floor(el.clientHeight || 600)) })
    return () => obs.disconnect()
  }, [nodes.length])

  useEffect(() => {
    const svg = svgRef.current
    if (!svg || nodes.length === 0) return

    const posCache: Record<string, { x: number; y: number }> = {}
    for (const n of nodesRef.current) if (n.x && n.y) posCache[n.id] = { x: n.x, y: n.y }

    const simNodes: SimNode[] = nodes.map((n) => ({
      ...n,
      r: nodeRadius(n, maxDegree),
      x: posCache[n.id]?.x ?? dims.w / 2 + (Math.random() - 0.5) * 300,
      y: posCache[n.id]?.y ?? dims.h / 2 + (Math.random() - 0.5) * 300,
    }))
    nodesRef.current = simNodes

    const simLinks: SimLink[] = edges.map((e) => ({ source: e.source, target: e.target }))

    if (simRef.current) simRef.current.stop()

    const sim = d3.forceSimulation(simNodes)
      .force('link', d3.forceLink<SimNode, SimLink>(simLinks).id((d) => d.id).distance(50).strength(0.4))
      .force('charge', d3.forceManyBody().strength((d) => ((d as SimNode).kind === 'project' ? -340 : -60)))
      .force('center', d3.forceCenter(dims.w / 2, dims.h / 2).strength(0.05))
      .force('collide', d3.forceCollide<SimNode>().radius((d) => d.r + 4))
    simRef.current = sim

    const svgSel = d3.select(svg)
    svgSel.selectAll('*').remove()
    svgSel.attr('width', dims.w).attr('height', dims.h)
    const g = svgSel.append('g')

    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.25, 4])
      .on('zoom', (event) => g.attr('transform', event.transform))
    svgSel.call(zoom)

    const defs = svgSel.append('defs')
    const filter = defs.append('filter').attr('id', 'eg-glow').attr('x', '-50%').attr('y', '-50%').attr('width', '200%').attr('height', '200%')
    filter.append('feGaussianBlur').attr('stdDeviation', '2.5').attr('result', 'blur')
    const feMerge = filter.append('feMerge')
    feMerge.append('feMergeNode').attr('in', 'blur')
    feMerge.append('feMergeNode').attr('in', 'SourceGraphic')

    const linkSel = g.append('g').attr('class', 'links')
      .selectAll('line')
      .data(simLinks)
      .join('line')
      .attr('stroke', (d) => KIND_COLOR[((d as SimLink).target as SimNode)?.kind ?? 'memory'] ?? '#475569')
      .attr('stroke-opacity', 0.18)
      .attr('stroke-width', 1)

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
      .on('click', (_e, d) => setSelected(d))

    nodeGroup.append('circle')
      .attr('r', (d) => d.r)
      .attr('fill', (d) => `${KIND_COLOR[d.kind]}26`)
      .attr('stroke', (d) => KIND_COLOR[d.kind])
      .attr('stroke-width', (d) => (d.kind === 'project' ? 1.8 : 1))
      .attr('filter', (d) => (d.kind === 'project' ? 'url(#eg-glow)' : null))

    // Label project nodes only (keep the canvas legible).
    nodeGroup.filter((d) => d.kind === 'project')
      .append('text')
      .text((d) => d.label)
      .attr('text-anchor', 'middle')
      .attr('dy', (d) => d.r + 11)
      .attr('fill', KIND_COLOR.project)
      .attr('font-size', 9)
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
  }, [nodes, edges, dims, maxDegree])

  if (loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center" style={{ background: '#060d1a' }}>
        <div className="text-xs font-mono text-slate-600 animate-pulse">Loading entity graph…</div>
      </div>
    )
  }

  const toggle = (k: EntityKind) => setLayers((s) => ({ ...s, [k]: !s[k] }))

  return (
    <div className="min-h-dvh flex flex-col" style={{ background: '#060d1a' }}>
      <SubPageHeader title="Unified Entity Graph">
        <div className="flex items-center gap-1.5">
          {(['project', 'memory', 'proposal'] as const).map((k) => (
            <button key={k} onClick={() => toggle(k)}
              className="text-[0.55rem] font-mono px-2 py-0.5 rounded border transition-colors uppercase tracking-wider"
              style={{
                color: layers[k] ? KIND_COLOR[k] : '#475569',
                borderColor: layers[k] ? `${KIND_COLOR[k]}60` : '#1e293b',
                background: layers[k] ? `${KIND_COLOR[k]}14` : 'transparent',
              }}>
              {KIND_LABEL[k]} {k === 'project' ? counts.projects : k === 'memory' ? counts.memories : counts.proposals}
            </button>
          ))}
        </div>
        <FreshnessBadge isStale={isStale} lastError={lastError} lastSuccessAt={lastSuccessAt} />
      </SubPageHeader>

      <main className="flex-1 p-6 max-w-7xl mx-auto w-full flex flex-col">
        {allNodes.length === 0 ? (
          <div className="flex-1 min-h-[24rem] flex flex-col items-center justify-center gap-2 text-center px-6">
            <div className="text-4xl opacity-20">⬡</div>
            <p className="text-xs text-slate-600 font-mono">
              No entities to graph. Once projects own memories or carry proposals, they connect here.
            </p>
          </div>
        ) : (
          <div className="relative rounded-xl border border-cyber-cyan/12 flex-1 min-h-[30rem] overflow-hidden" style={{ background: 'rgba(0,245,255,0.02)' }}>
            <svg ref={svgRef} className="w-full h-full" style={{ background: 'transparent' }} />

            {/* legend */}
            <div className="absolute top-3 left-3 flex flex-col gap-1 rounded-lg border border-white/8 bg-cyber-surface/70 backdrop-blur-md p-2">
              {(['project', 'memory', 'proposal'] as const).map((k) => (
                <div key={k} className="flex items-center gap-2 text-[0.55rem] font-mono">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ background: KIND_COLOR[k], boxShadow: `0 0 6px ${KIND_COLOR[k]}` }} />
                  <span className="text-slate-400">{KIND_LABEL[k]}</span>
                </div>
              ))}
            </div>

            {/* detail drawer */}
            {selected && (
              <div className="absolute top-3 right-3 w-72 rounded-lg border border-white/10 bg-cyber-surface/95 backdrop-blur-md p-3 shadow-xl"
                style={{ boxShadow: `0 0 20px ${KIND_COLOR[selected.kind]}30` }}>
                <div className="flex items-center justify-between mb-2">
                  <span className="px-1.5 py-0.5 rounded text-[0.6rem] font-mono font-bold uppercase tracking-wider"
                    style={{ color: KIND_COLOR[selected.kind], border: `1px solid ${KIND_COLOR[selected.kind]}40` }}>
                    {KIND_LABEL[selected.kind]}
                  </span>
                  <button onClick={() => setSelected(null)} className="text-slate-600 hover:text-slate-300 text-xs">✕</button>
                </div>
                <div className="text-xs font-mono text-slate-200 mb-2 break-words">{selected.label}</div>
                <div className="flex flex-col gap-1 text-[0.6rem] font-mono text-slate-500 mb-3">
                  <div>project: <span className="text-slate-300">{selected.slug}</span></div>
                  {selected.kind === 'project' && <div>connections: <span className="text-slate-300 tabular-nums">{selected.degree}</span></div>}
                  {Object.entries(selected.meta).filter(([, v]) => v !== null && v !== '').map(([k, v]) => (
                    <div key={k}>{k}: <span className="text-slate-300">{String(v)}</span></div>
                  ))}
                </div>
                <Link href={selected.href}
                  className="block text-center text-[0.6rem] font-mono text-cyber-cyan border border-cyber-cyan/30 rounded px-2 py-1 hover:bg-cyber-cyan/10 transition-colors">
                  Open →
                </Link>
              </div>
            )}
          </div>
        )}

        <p className="text-[0.5rem] font-mono text-slate-700 mt-4 max-w-3xl">
          Tri-partite graph (P213) fusing the three domains that were previously siloed: runtime
          <span style={{ color: KIND_COLOR.project }}> projects</span>, the
          <span style={{ color: KIND_COLOR.memory }}> memories</span> they own (from <code>memory.db</code>), and the pending
          <span style={{ color: KIND_COLOR.proposal }}> proposals</span> they&apos;re working (from BACKLOG.md / specclaw STATUS.md).
          Project nodes are sized by combined degree. Toggle entity layers from the header; click any node for its
          detail drawer and a deep-link. Reuses <code>/api/memories</code> + <code>/api/backlog</code> sources and the
          MemoryGraph force sim. Refreshes every 60s.
        </p>
      </main>
    </div>
  )
}
