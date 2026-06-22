'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import * as d3 from 'd3'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense } from 'react'
import type { ProposalGraphNode, ProposalGraphEdge, ProposalGraphResponse } from '../api/proposal-graph/route'

const CATEGORY_COLORS: Record<string, string> = {
  graph:       '#22D3EE',
  memory:      '#A78BFA',
  alerts:      '#EF4444',
  scheduler:   '#F59E0B',
  metrics:     '#34D399',
  timeline:    '#60A5FA',
  pipeline:    '#F97316',
  fleet:       '#4ADE80',
  operations:  '#FB923C',
  live:        '#E879F9',
  project:     '#38BDF8',
  search:      '#818CF8',
  reports:     '#86EFAC',
  diff:        '#FCD34D',
  navigation:  '#94A3B8',
  other:       '#6B7280',
}

const STATUS_COLORS = {
  done: '#4ADE80',
  pending: '#F59E0B',
}

interface SimNode extends ProposalGraphNode {
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
}

const MIN_RADIUS = 8
const MAX_RADIUS = 24
const STORAGE_KEY = 'mc_proposal_graph_positions'

function loadPositions(): Record<string, { x: number; y: number }> {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') } catch { return {} }
}

function savePositions(nodes: SimNode[]) {
  const map: Record<string, { x: number; y: number }> = {}
  for (const n of nodes) map[n.id] = { x: n.x, y: n.y }
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(map)) } catch {}
}

function hullPath(points: [number, number][], padding = 18): string {
  if (points.length < 3) return ''
  const hull = d3.polygonHull(points)
  if (!hull) return ''
  const padded = hull.map(([x, y], i, arr): [number, number] => {
    const cx = arr.reduce((s, [px]) => s + px, 0) / arr.length
    const cy = arr.reduce((s, [, py]) => s + py, 0) / arr.length
    const dx = x - cx
    const dy = y - cy
    const len = Math.hypot(dx, dy) || 1
    return [x + (dx / len) * padding, y + (dy / len) * padding]
  })
  return `M${padded.map(([x, y]) => `${x},${y}`).join('L')}Z`
}

function ProposalGraphInner() {
  const svgRef = useRef<SVGSVGElement>(null)
  const simRef = useRef<d3.Simulation<SimNode, SimEdge> | null>(null)
  const [data, setData] = useState<ProposalGraphResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<ProposalGraphNode | null>(null)
  const [filterCat, setFilterCat] = useState<string | null>(null)
  const [filterStatus, setFilterStatus] = useState<'all' | 'done' | 'pending'>('all')
  const router = useRouter()
  const searchParams = useSearchParams()
  const [quickWinsOnly, setQuickWinsOnly] = useState(searchParams.get('quickWins') === '1')

  useEffect(() => {
    fetch('/api/proposal-graph')
      .then((r) => r.json())
      .then((d: ProposalGraphResponse) => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  const buildGraph = useCallback(() => {
    if (!svgRef.current || !data) return
    const svg = d3.select(svgRef.current)
    svg.selectAll('*').remove()

    const W = svgRef.current.clientWidth || 900
    const H = svgRef.current.clientHeight || 700

    const filteredNodes = data.nodes.filter((n) => {
      if (filterCat && n.category !== filterCat) return false
      if (filterStatus !== 'all' && n.status !== filterStatus) return false
      if (quickWinsOnly && (n.status !== 'pending' || (n.impact?.riskScore ?? 100) >= 30)) return false
      return true
    })
    const filteredIds = new Set(filteredNodes.map((n) => n.id))
    const filteredEdges = data.edges.filter(
      (e) => filteredIds.has(e.source) && filteredIds.has(e.target)
    )

    if (filteredNodes.length === 0) {
      svg.append('text')
        .attr('x', W / 2).attr('y', H / 2)
        .attr('text-anchor', 'middle')
        .attr('fill', '#4B5563')
        .attr('font-family', 'monospace')
        .attr('font-size', 14)
        .text('No proposals match the current filter.')
      return
    }

    const saved = loadPositions()
    const maxCommits = Math.max(1, ...filteredNodes.map((n) => n.commitCount))
    const radiusScale = d3.scaleSqrt().domain([0, maxCommits]).range([MIN_RADIUS, MAX_RADIUS])

    const nodes: SimNode[] = filteredNodes.map((n) => ({
      ...n,
      x: saved[n.id]?.x ?? W / 2 + (Math.random() - 0.5) * 400,
      y: saved[n.id]?.y ?? H / 2 + (Math.random() - 0.5) * 400,
    }))
    const nodeMap = new Map(nodes.map((n) => [n.id, n]))

    const edges: SimEdge[] = filteredEdges
      .map((e) => ({ source: nodeMap.get(e.source)!, target: nodeMap.get(e.target)! }))
      .filter((e) => e.source && e.target)

    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.2, 4])
      .on('zoom', (event) => { container.attr('transform', event.transform.toString()) })
    svg.call(zoom)

    const container = svg.append('g')

    const sim = d3.forceSimulation<SimNode>(nodes)
      .force('link', d3.forceLink<SimNode, SimEdge>(edges).id((d) => d.id).distance(80).strength(0.3))
      .force('charge', d3.forceManyBody().strength(-120))
      .force('center', d3.forceCenter(W / 2, H / 2))
      .force('collide', d3.forceCollide<SimNode>((d) => radiusScale(d.commitCount) + 10))
    simRef.current = sim

    // Cluster halos
    const hullGroup = container.append('g').attr('class', 'hulls')

    // Edges
    const linkGroup = container.append('g').attr('class', 'links')
    const linkEl = linkGroup.selectAll<SVGLineElement, SimEdge>('line')
      .data(edges).join('line')
      .attr('stroke', '#334155')
      .attr('stroke-width', 1)
      .attr('stroke-opacity', 0.5)
      .attr('marker-end', 'url(#arrow)')

    svg.append('defs').append('marker')
      .attr('id', 'arrow')
      .attr('viewBox', '0 -5 10 10')
      .attr('refX', 10)
      .attr('refY', 0)
      .attr('markerWidth', 6)
      .attr('markerHeight', 6)
      .attr('orient', 'auto')
      .append('path')
      .attr('d', 'M0,-5L10,0L0,5')
      .attr('fill', '#334155')

    // Nodes
    const nodeGroup = container.append('g').attr('class', 'nodes')
    const nodeEl = nodeGroup.selectAll<SVGGElement, SimNode>('g')
      .data(nodes).join('g')
      .attr('cursor', 'pointer')
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
            savePositions(nodes)
          })
      )
      .on('click', (_event, d) => setSelected(d))

    nodeEl.append('circle')
      .attr('r', (d) => radiusScale(d.commitCount))
      .attr('fill', (d) => STATUS_COLORS[d.status])
      .attr('fill-opacity', 0.15)
      .attr('stroke', (d) => {
        if (d.status === 'pending' && d.impact) {
          if (d.impact.riskScore > 70) return '#EF4444'
          if (d.impact.riskScore < 30) return '#10B981'
        }
        return STATUS_COLORS[d.status]
      })
      .attr('stroke-width', (d) => (d.status === 'pending' && d.impact && (d.impact.riskScore > 70 || d.impact.riskScore < 30)) ? 2.5 : 1.5)

    // Category ring
    nodeEl.append('circle')
      .attr('r', (d) => radiusScale(d.commitCount) + 3)
      .attr('fill', 'none')
      .attr('stroke', (d) => CATEGORY_COLORS[d.category] ?? CATEGORY_COLORS.other)
      .attr('stroke-width', 1)
      .attr('stroke-opacity', 0.5)
      .attr('stroke-dasharray', '3,2')

    nodeEl.append('text')
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'middle')
      .attr('fill', (d) => STATUS_COLORS[d.status])
      .attr('font-family', 'monospace')
      .attr('font-size', (d) => Math.max(7, radiusScale(d.commitCount) * 0.55))
      .attr('pointer-events', 'none')
      .text((d) => `P${d.number}`)

    // Quick win badge (⚡) for pending risk < 30
    nodeEl.filter((d) => d.status === 'pending' && (d.impact?.riskScore ?? 100) < 30)
      .append('text')
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'middle')
      .attr('dy', (d) => -(radiusScale(d.commitCount) + 8))
      .attr('font-size', 8)
      .attr('fill', '#10B981')
      .attr('pointer-events', 'none')
      .text('⚡')

    nodeEl.append('title').text((d) => {
      const impact = d.impact
      const base = `${d.id} — ${d.title}\nStatus: ${d.status}\nCommits: ${d.commitCount}\nCategory: ${d.category}`
      return impact ? `${base}\nRisk: ${impact.riskScore}/100 · ~${impact.estimatedMinutes}min · ${impact.acCount} ACs` : base
    })

    // Pending nodes: pulsing opacity handled via CSS class
    nodeEl.filter((d) => d.status === 'pending')
      .select('circle:first-child')
      .attr('class', 'pending-pulse')

    sim.on('tick', () => {
      linkEl
        .attr('x1', (d) => (d.source as SimNode).x)
        .attr('y1', (d) => (d.source as SimNode).y)
        .attr('x2', (d) => (d.target as SimNode).x)
        .attr('y2', (d) => (d.target as SimNode).y)

      nodeEl.attr('transform', (d) => `translate(${d.x},${d.y})`)

      // Update hulls per category
      const categories = new Set(nodes.map((n) => n.category))
      hullGroup.selectAll('path').remove()
      for (const cat of categories) {
        const pts = nodes
          .filter((n) => n.category === cat)
          .map((n): [number, number] => [n.x, n.y])
        if (pts.length < 3) continue
        const d = hullPath(pts)
        if (!d) continue
        hullGroup.append('path')
          .attr('d', d)
          .attr('fill', CATEGORY_COLORS[cat] ?? CATEGORY_COLORS.other)
          .attr('fill-opacity', 0.04)
          .attr('stroke', CATEGORY_COLORS[cat] ?? CATEGORY_COLORS.other)
          .attr('stroke-width', 1)
          .attr('stroke-opacity', 0.15)
          .attr('stroke-dasharray', '4,3')
      }
    })

    sim.on('end', () => savePositions(nodes))
  }, [data, filterCat, filterStatus, quickWinsOnly])

  useEffect(() => { buildGraph() }, [buildGraph])

  useEffect(() => {
    const handleResize = () => buildGraph()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [buildGraph])

  const stats = data
    ? {
        total: data.nodes.length,
        done: data.nodes.filter((n) => n.status === 'done').length,
        pending: data.nodes.filter((n) => n.status === 'pending').length,
        edges: data.edges.length,
      }
    : null

  const selectedACs = selected
    ? [...selected.body.matchAll(/^- (AC\d+:.+)$/gm)].map((m) => m[1])
    : []

  return (
    <div className="flex flex-col h-screen bg-[#0B0F1A] text-slate-200 overflow-hidden">
      <style>{`
        @keyframes proposalPulse {
          0%, 100% { opacity: 0.15; }
          50% { opacity: 0.35; }
        }
        .pending-pulse { animation: proposalPulse 2s ease-in-out infinite; }
      `}</style>

      {/* Header */}
      <div className="flex items-center gap-4 px-4 py-3 border-b border-slate-800 shrink-0">
        <Link href="/" className="text-slate-500 hover:text-slate-300 font-mono text-xs">← Home</Link>
        <h1 className="font-mono text-sm font-bold text-cyan-400 tracking-wider">PROPOSAL DEPENDENCY GRAPH</h1>
        {stats && (
          <div className="flex gap-3 ml-auto text-[0.65rem] font-mono">
            <span style={{ color: STATUS_COLORS.done }}>{stats.done} done</span>
            <span style={{ color: STATUS_COLORS.pending }}>{stats.pending} pending</span>
            <span className="text-slate-500">{stats.edges} refs</span>
          </div>
        )}
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-slate-800/50 shrink-0 flex-wrap">
        <button
          onClick={() => {
            const next = !quickWinsOnly
            setQuickWinsOnly(next)
            const params = new URLSearchParams(searchParams.toString())
            if (next) params.set('quickWins', '1'); else params.delete('quickWins')
            router.replace(`?${params.toString()}`)
          }}
          className="text-[0.65rem] font-mono px-2 py-0.5 rounded transition-all"
          style={{
            background: quickWinsOnly ? '#10B98122' : 'transparent',
            border: `1px solid ${quickWinsOnly ? '#10B981' : '#334155'}`,
            color: quickWinsOnly ? '#10B981' : '#64748B',
          }}
        >
          ⚡ Quick Wins
        </button>
        <span className="text-slate-700">|</span>
        <span className="text-[0.6rem] font-mono text-slate-500 uppercase tracking-wider">Status:</span>
        {(['all', 'done', 'pending'] as const).map((s) => (
          <button
            key={s}
            onClick={() => setFilterStatus(s)}
            className="text-[0.65rem] font-mono px-2 py-0.5 rounded transition-all"
            style={{
              background: filterStatus === s ? (s === 'done' ? STATUS_COLORS.done : s === 'pending' ? STATUS_COLORS.pending : '#22D3EE') + '22' : 'transparent',
              border: `1px solid ${filterStatus === s ? (s === 'done' ? STATUS_COLORS.done : s === 'pending' ? STATUS_COLORS.pending : '#22D3EE') : '#334155'}`,
              color: filterStatus === s ? (s === 'done' ? STATUS_COLORS.done : s === 'pending' ? STATUS_COLORS.pending : '#22D3EE') : '#64748B',
            }}
          >
            {s}
          </button>
        ))}
        <span className="ml-3 text-[0.6rem] font-mono text-slate-500 uppercase tracking-wider">Category:</span>
        <button
          onClick={() => setFilterCat(null)}
          className="text-[0.65rem] font-mono px-2 py-0.5 rounded transition-all"
          style={{
            background: filterCat === null ? '#22D3EE22' : 'transparent',
            border: `1px solid ${filterCat === null ? '#22D3EE' : '#334155'}`,
            color: filterCat === null ? '#22D3EE' : '#64748B',
          }}
        >
          all
        </button>
        {data?.categories.map((cat) => (
          <button
            key={cat}
            onClick={() => setFilterCat(filterCat === cat ? null : cat)}
            className="text-[0.65rem] font-mono px-2 py-0.5 rounded transition-all capitalize"
            style={{
              background: filterCat === cat ? (CATEGORY_COLORS[cat] ?? '#6B7280') + '22' : 'transparent',
              border: `1px solid ${filterCat === cat ? (CATEGORY_COLORS[cat] ?? '#6B7280') : '#334155'}`,
              color: filterCat === cat ? (CATEGORY_COLORS[cat] ?? '#6B7280') : '#64748B',
            }}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Main area */}
      <div className="flex flex-1 min-h-0">
        {/* Graph */}
        <div className="flex-1 relative">
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-cyan-400 font-mono text-sm animate-pulse">Loading proposals…</span>
            </div>
          )}
          <svg ref={svgRef} className="w-full h-full" />

          {/* Legend */}
          <div className="absolute bottom-4 left-4 bg-[#0B0F1A]/90 border border-slate-800 rounded p-3 text-[0.6rem] font-mono flex flex-col gap-1.5">
            <span className="text-slate-500 uppercase tracking-wider mb-0.5">Legend</span>
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full border" style={{ borderColor: STATUS_COLORS.done, background: STATUS_COLORS.done + '22' }} />
              <span style={{ color: STATUS_COLORS.done }}>Done</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full border" style={{ borderColor: STATUS_COLORS.pending, background: STATUS_COLORS.pending + '22' }} />
              <span style={{ color: STATUS_COLORS.pending }}>Pending (pulses)</span>
            </div>
            <div className="mt-1 text-slate-600">Node size = commit count</div>
            <div className="text-slate-600">Dashed ring = category</div>
            <div className="text-slate-600">Arrows = body cross-refs</div>
            <div className="text-slate-600">Halos = theme clusters</div>
            {Object.entries(CATEGORY_COLORS).slice(0, 6).map(([cat, color]) => (
              <div key={cat} className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full" style={{ background: color }} />
                <span className="capitalize" style={{ color }}>{cat}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Detail drawer */}
        {selected && (
          <div className="w-80 border-l border-slate-800 flex flex-col overflow-hidden bg-[#0B0F1A]">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
              <span className="font-mono text-xs font-bold" style={{ color: STATUS_COLORS[selected.status] }}>
                {selected.id}
              </span>
              <button onClick={() => setSelected(null)} className="text-slate-500 hover:text-slate-300 text-xs font-mono">✕</button>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-3">
              <h2 className="font-mono text-xs font-semibold text-slate-200 leading-snug">{selected.title}</h2>

              <div className="flex gap-3 text-[0.6rem] font-mono">
                <span
                  className="px-1.5 py-0.5 rounded"
                  style={{
                    background: STATUS_COLORS[selected.status] + '22',
                    color: STATUS_COLORS[selected.status],
                    border: `1px solid ${STATUS_COLORS[selected.status]}44`,
                  }}
                >
                  {selected.status}
                </span>
                <span
                  className="px-1.5 py-0.5 rounded capitalize"
                  style={{
                    background: (CATEGORY_COLORS[selected.category] ?? '#6B7280') + '22',
                    color: CATEGORY_COLORS[selected.category] ?? '#6B7280',
                    border: `1px solid ${(CATEGORY_COLORS[selected.category] ?? '#6B7280')}44`,
                  }}
                >
                  {selected.category}
                </span>
                <span className="text-slate-500">{selected.commitCount} commits</span>
              </div>

              {/* Impact breakdown for pending proposals */}
              {selected.status === 'pending' && selected.impact && (() => {
                const imp = selected.impact
                const riskColor = imp.riskScore > 70 ? '#EF4444' : imp.riskScore < 30 ? '#10B981' : '#F59E0B'
                return (
                  <div className="rounded border border-white/5 p-2 bg-[#0d1b2e]">
                    <p className="text-[0.6rem] font-mono text-slate-500 uppercase tracking-wider mb-2">Impact Estimate</p>
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-[0.65rem] font-bold font-mono" style={{ color: riskColor }}>
                        Risk {imp.riskScore}/100
                      </span>
                      {imp.riskScore < 30 && <span className="text-[0.55rem] text-green-400">⚡ Quick Win</span>}
                      {imp.riskScore > 70 && <span className="text-[0.55rem] text-red-400">⚠ High Risk</span>}
                    </div>
                    <div className="grid grid-cols-3 gap-1 mb-2">
                      {[
                        { label: 'Complexity', val: imp.complexityScore },
                        { label: 'Surface', val: imp.surfaceScore },
                        { label: 'Deps', val: imp.depsScore },
                      ].map(({ label, val }) => (
                        <div key={label} className="text-center">
                          <div className="text-[0.5rem] text-slate-600 uppercase">{label}</div>
                          <div className="text-[0.7rem] font-bold font-mono text-slate-300">{val}</div>
                          <div className="h-1 rounded mt-0.5" style={{ background: '#1E293B' }}>
                            <div className="h-full rounded" style={{ width: `${val}%`, background: riskColor }} />
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="text-[0.55rem] text-slate-600 space-y-0.5">
                      <div>{imp.acCount} ACs · ~{imp.estimatedMinutes} min est.</div>
                      {imp.fileTypes.length > 0 && <div>Files: {imp.fileTypes.join(', ')}</div>}
                      {imp.linkedProposals.length > 0 && <div>Refs: {imp.linkedProposals.join(', ')}</div>}
                    </div>
                  </div>
                )
              })()}

              {selectedACs.length > 0 && (
                <div>
                  <p className="text-[0.6rem] font-mono text-slate-500 uppercase tracking-wider mb-1.5">Acceptance Criteria</p>
                  <ul className="flex flex-col gap-1">
                    {selectedACs.map((ac) => (
                      <li key={ac} className="text-[0.65rem] font-mono text-slate-400 leading-snug flex gap-1.5">
                        <span className="text-green-500/60 shrink-0">✓</span>
                        <span>{ac}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Cross-refs in body */}
              {(() => {
                const refs = [...new Set([...selected.body.matchAll(/\bP(\d+)\b/g)].map((m) => parseInt(m[1], 10)).filter((n) => n !== selected.number))]
                if (refs.length === 0) return null
                return (
                  <div>
                    <p className="text-[0.6rem] font-mono text-slate-500 uppercase tracking-wider mb-1.5">References</p>
                    <div className="flex flex-wrap gap-1">
                      {refs.map((n) => (
                        <button
                          key={n}
                          onClick={() => {
                            const node = data?.nodes.find((nd) => nd.number === n)
                            if (node) setSelected(node)
                          }}
                          className="text-[0.6rem] font-mono px-1.5 py-0.5 rounded border border-slate-700 text-slate-400 hover:border-cyan-500/50 hover:text-cyan-400 transition-colors"
                        >
                          P{n}
                        </button>
                      ))}
                    </div>
                  </div>
                )
              })()}

              <div>
                <p className="text-[0.6rem] font-mono text-slate-500 uppercase tracking-wider mb-1.5">Body Excerpt</p>
                <p className="text-[0.6rem] font-mono text-slate-500 leading-relaxed whitespace-pre-wrap">
                  {selected.body.replace(/^## .+$/m, '').trim().slice(0, 600)}
                  {selected.body.length > 600 ? '…' : ''}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default function ProposalGraphPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#0B0F1A] text-cyan-400 p-4 font-mono text-sm">Loading…</div>}>
      <ProposalGraphInner />
    </Suspense>
  )
}
