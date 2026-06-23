'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { sankey, sankeyLinkHorizontal, type SankeyNode, type SankeyLink } from 'd3-sankey'
import type { BacklogResponse } from '../api/backlog/route'

const STATUS_COLOR: Record<string, string> = {
  pending: '#F59E0B',
  done: '#4ADE80',
}
const PROJECT_COLOR = '#22D3EE'

interface NodeDatum {
  id: string
  name: string
  kind: 'project' | 'status'
  status?: 'pending' | 'done'
}
interface LinkDatum {
  source: number
  target: number
  value: number
  slug: string
  status: 'pending' | 'done'
}

type SNode = SankeyNode<NodeDatum, LinkDatum>
type SLink = SankeyLink<NodeDatum, LinkDatum>

export default function ProposalFlowPage() {
  const [data, setData] = useState<BacklogResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [hover, setHover] = useState<string | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(900)

  useEffect(() => {
    function load() {
      fetch('/api/backlog')
        .then((r) => r.json() as Promise<BacklogResponse>)
        .then((d) => { setData(d); setLoading(false) })
        .catch(() => setLoading(false))
    }
    load()
    const t = setInterval(load, 60_000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    function onResize() { if (wrapRef.current) setWidth(wrapRef.current.clientWidth) }
    onResize()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [data])

  const H = 520
  const graph = useMemo(() => {
    if (!data) return null
    const projects = data.projects.filter((p) =>
      p.items.some((i) => i.status === 'pending' || i.status === 'done')
    )
    if (projects.length === 0) return null

    const nodes: NodeDatum[] = []
    const idx = new Map<string, number>()
    function nodeIdx(n: NodeDatum): number {
      if (!idx.has(n.id)) { idx.set(n.id, nodes.length); nodes.push(n) }
      return idx.get(n.id)!
    }
    // project nodes first (left), then status nodes (right)
    for (const p of projects) nodeIdx({ id: `proj:${p.slug}`, name: p.slug, kind: 'project' })
    const pendingIdx = nodeIdx({ id: 'status:pending', name: 'pending', kind: 'status', status: 'pending' })
    const doneIdx = nodeIdx({ id: 'status:done', name: 'done', kind: 'status', status: 'done' })

    const links: LinkDatum[] = []
    for (const p of projects) {
      const src = idx.get(`proj:${p.slug}`)!
      const pending = p.items.filter((i) => i.status === 'pending').length
      const done = p.items.filter((i) => i.status === 'done').length
      if (pending > 0) links.push({ source: src, target: pendingIdx, value: pending, slug: p.slug, status: 'pending' })
      if (done > 0) links.push({ source: src, target: doneIdx, value: done, slug: p.slug, status: 'done' })
    }
    if (links.length === 0) return null

    const layout = sankey<NodeDatum, LinkDatum>()
      .nodeWidth(14)
      .nodePadding(12)
      .extent([[8, 12], [width - 8, H - 12]])

    const g = layout({
      nodes: nodes.map((d) => ({ ...d })),
      links: links.map((d) => ({ ...d })),
    })
    return g as { nodes: SNode[]; links: SLink[] }
  }, [data, width])

  if (loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center" style={{ background: '#060d1a' }}>
        <div className="text-xs font-mono text-slate-600 animate-pulse">Loading proposal flow…</div>
      </div>
    )
  }

  const linkPath = sankeyLinkHorizontal<NodeDatum, LinkDatum>()

  function linkKey(l: SLink): string { return `${l.slug}->${l.status}` }
  function colorOf(l: SLink): string { return STATUS_COLOR[l.status] ?? '#64748b' }

  return (
    <div className="min-h-dvh flex flex-col" style={{ background: '#060d1a' }}>
      <header className="sticky top-0 z-30 border-b border-cyber-cyan/12 bg-[#060d1a]/90 backdrop-blur-md px-6 py-3">
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-cyber-cyan/40 to-transparent" />
        <div className="flex items-center gap-3 flex-wrap">
          <Link href="/" className="text-[0.6rem] font-mono text-slate-500 hover:text-cyber-cyan transition-colors uppercase tracking-wider">← Dashboard</Link>
          <h1 className="text-sm font-black tracking-[0.18em] text-cyber-cyan" style={{ fontFamily: 'Orbitron, JetBrains Mono, monospace' }}>
            Proposal Flow
          </h1>
          <span className="text-[0.6rem] font-mono text-slate-500 border border-slate-700 px-2 py-0.5 rounded">project → status</span>
          <div className="flex-1" />
          <Link href="/backlog" className="text-[0.6rem] font-mono text-slate-500 hover:text-cyber-cyan transition-colors border border-slate-700 hover:border-cyber-cyan/30 px-2 py-1 rounded">Backlog →</Link>
        </div>
      </header>

      <main className="flex-1 p-6 max-w-6xl mx-auto w-full">
        <div ref={wrapRef} className="relative rounded-lg border border-cyber-cyan/12 overflow-hidden" style={{ background: 'rgba(0,245,255,0.02)' }}>
          {!graph ? (
            <div className="h-[520px] flex items-center justify-center text-slate-600 text-xs font-mono">
              No proposals found across the fleet.
            </div>
          ) : (
            <svg width={width} height={H} style={{ display: 'block' }}>
              {/* links */}
              <g fill="none">
                {graph.links.map((l) => {
                  const k = linkKey(l)
                  const active = hover === k
                  return (
                    <path
                      key={k}
                      d={linkPath(l) ?? ''}
                      stroke={colorOf(l)}
                      strokeOpacity={hover ? (active ? 0.85 : 0.12) : 0.35}
                      strokeWidth={Math.max(1, l.width ?? 1)}
                      onMouseEnter={() => setHover(k)}
                      onMouseLeave={() => setHover(null)}
                      style={{ transition: 'stroke-opacity 0.15s', cursor: 'pointer' }}
                    >
                      <title>{l.slug} → {l.status}: {l.value}</title>
                    </path>
                  )
                })}
              </g>
              {/* nodes */}
              <g>
                {graph.nodes.map((n) => {
                  const color = n.kind === 'status' ? (STATUS_COLOR[n.status ?? ''] ?? '#64748b') : PROJECT_COLOR
                  const x0 = n.x0 ?? 0, x1 = n.x1 ?? 0, y0 = n.y0 ?? 0, y1 = n.y1 ?? 0
                  const isRight = n.kind === 'status'
                  return (
                    <g key={n.id}>
                      <rect x={x0} y={y0} width={x1 - x0} height={Math.max(1, y1 - y0)} fill={color} opacity={0.85} rx={2}>
                        <title>{n.name}: {n.value}</title>
                      </rect>
                      <text
                        x={isRight ? x0 - 6 : x1 + 6}
                        y={(y0 + y1) / 2}
                        dy="0.35em"
                        textAnchor={isRight ? 'end' : 'start'}
                        fill={isRight ? color : '#cbd5e1'}
                        fontSize={10}
                        fontFamily="JetBrains Mono, monospace"
                        fontWeight={isRight ? 700 : 400}
                      >
                        {n.name}{isRight ? ` (${n.value})` : ''}
                      </text>
                    </g>
                  )
                })}
              </g>
            </svg>
          )}
        </div>

        <div className="mt-4 flex items-center gap-4 text-[0.6rem] font-mono text-slate-500">
          <span className="flex items-center gap-1.5"><span style={{ width: 10, height: 10, borderRadius: 2, background: STATUS_COLOR.pending, display: 'inline-block' }} /> pending</span>
          <span className="flex items-center gap-1.5"><span style={{ width: 10, height: 10, borderRadius: 2, background: STATUS_COLOR.done, display: 'inline-block' }} /> done</span>
          <span className="flex items-center gap-1.5"><span style={{ width: 10, height: 10, borderRadius: 2, background: PROJECT_COLOR, display: 'inline-block' }} /> project</span>
        </div>

        <p className="text-[0.5rem] font-mono text-slate-700 mt-3">
          Sankey of proposal volume: each project flows to pending / done status nodes; link width = proposal count. Hover a flow to isolate it. Data from /api/backlog. Refreshes every 60s.
        </p>
      </main>
    </div>
  )
}
