'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { sankey, sankeyLinkHorizontal, type SankeyNode as D3SankeyNode, type SankeyLink as D3SankeyLink } from 'd3-sankey'
import type { AttentionSankeyResponse, SankeyNodeKind } from '../api/attention-sankey/route'

const SEVERITY_COLOR: Record<string, string> = {
  critical: '#F87171',
  warn: '#F59E0B',
  info: '#22D3EE',
}
const PROJECT_COLOR = '#22D3EE'
const SIGNAL_COLOR = '#A78BFA'

interface NodeDatum {
  id: string
  name: string
  kind: SankeyNodeKind
}
interface LinkDatum {
  source: number
  target: number
  value: number
  sourceName: string
  targetName: string
}

type SNode = D3SankeyNode<NodeDatum, LinkDatum>
type SLink = D3SankeyLink<NodeDatum, LinkDatum>

function nodeColor(kind: SankeyNodeKind, name: string): string {
  if (kind === 'project') return PROJECT_COLOR
  if (kind === 'signal') return SIGNAL_COLOR
  return SEVERITY_COLOR[name] ?? '#64748b'
}

export default function AttentionSankeyPage() {
  const [data, setData] = useState<AttentionSankeyResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [hover, setHover] = useState<string | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(900)

  useEffect(() => {
    function load() {
      fetch('/api/attention-sankey')
        .then((r) => r.json() as Promise<AttentionSankeyResponse>)
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

  const H = 560
  const graph = useMemo(() => {
    if (!data || data.nodes.length === 0 || data.links.length === 0) return null

    const idx = new Map<string, number>()
    const nodes: NodeDatum[] = data.nodes.map((n, i) => { idx.set(n.id, i); return { id: n.id, name: n.name, kind: n.kind } })
    const links: LinkDatum[] = []
    for (const l of data.links) {
      const s = idx.get(l.source), t = idx.get(l.target)
      if (s === undefined || t === undefined) continue
      links.push({ source: s, target: t, value: l.value, sourceName: nodes[s].name, targetName: nodes[t].name })
    }
    if (links.length === 0) return null

    const layout = sankey<NodeDatum, LinkDatum>()
      .nodeWidth(14)
      .nodePadding(10)
      .extent([[8, 12], [width - 8, H - 12]])

    return layout({
      nodes: nodes.map((d) => ({ ...d })),
      links: links.map((d) => ({ ...d })),
    }) as { nodes: SNode[]; links: SLink[] }
  }, [data, width])

  if (loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center" style={{ background: '#060d1a' }}>
        <div className="text-xs font-mono text-slate-600 animate-pulse">Loading attention flow…</div>
      </div>
    )
  }

  const linkPath = sankeyLinkHorizontal<NodeDatum, LinkDatum>()
  const linkKey = (l: SLink): string => `${l.sourceName}->${l.targetName}`
  // Color a link by its target: project→signal links inherit signal purple;
  // signal→severity links inherit the severity color.
  function linkColor(l: SLink): string {
    const tgt = l.target as SNode
    return nodeColor(tgt.kind, tgt.name)
  }

  return (
    <div className="min-h-dvh flex flex-col" style={{ background: '#060d1a' }}>
      <header className="sticky top-0 z-30 border-b border-cyber-cyan/12 bg-[#060d1a]/90 backdrop-blur-md px-6 py-3">
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-cyber-cyan/40 to-transparent" />
        <div className="flex items-center gap-3 flex-wrap">
          <Link href="/" className="text-[0.6rem] font-mono text-slate-500 hover:text-cyber-cyan transition-colors uppercase tracking-wider">← Dashboard</Link>
          <h1 className="text-sm font-black tracking-[0.18em] text-cyber-cyan" style={{ fontFamily: 'Orbitron, JetBrains Mono, monospace' }}>
            Attention Sankey
          </h1>
          <span className="text-[0.6rem] font-mono text-slate-500 border border-slate-700 px-2 py-0.5 rounded">project → signal → severity</span>
          {data && (
            <span className="text-[0.6rem] font-mono text-slate-500">{data.findingCount} findings · {data.projectCount} projects</span>
          )}
          <div className="flex-1" />
          <Link href="/signal-graph" className="text-[0.6rem] font-mono text-slate-500 hover:text-cyber-cyan transition-colors border border-slate-700 hover:border-cyber-cyan/30 px-2 py-1 rounded">Signal Graph →</Link>
        </div>
      </header>

      <main className="flex-1 p-6 max-w-6xl mx-auto w-full">
        <div ref={wrapRef} className="relative rounded-lg border border-cyber-cyan/12 overflow-hidden" style={{ background: 'rgba(0,245,255,0.02)' }}>
          {!graph ? (
            <div className="h-[560px] flex items-center justify-center text-slate-600 text-xs font-mono">
              No attention findings — the fleet is healthy.
            </div>
          ) : (
            <svg width={width} height={H} style={{ display: 'block' }}>
              <g fill="none">
                {graph.links.map((l) => {
                  const k = linkKey(l)
                  const active = hover === k
                  return (
                    <path
                      key={k}
                      d={linkPath(l) ?? ''}
                      stroke={linkColor(l)}
                      strokeOpacity={hover ? (active ? 0.9 : 0.1) : 0.35}
                      strokeWidth={Math.max(1, l.width ?? 1)}
                      onMouseEnter={() => setHover(k)}
                      onMouseLeave={() => setHover(null)}
                      style={{ transition: 'stroke-opacity 0.15s', cursor: 'pointer' }}
                    >
                      <title>{l.sourceName} → {l.targetName}: {l.value}</title>
                    </path>
                  )
                })}
              </g>
              <g>
                {graph.nodes.map((n) => {
                  const color = nodeColor(n.kind, n.name)
                  const x0 = n.x0 ?? 0, x1 = n.x1 ?? 0, y0 = n.y0 ?? 0, y1 = n.y1 ?? 0
                  const isRight = n.kind === 'severity'
                  const labelX = isRight ? x0 - 6 : x1 + 6
                  const label = (
                    <text
                      x={labelX}
                      y={(y0 + y1) / 2}
                      dy="0.35em"
                      textAnchor={isRight ? 'end' : 'start'}
                      fill={n.kind === 'project' ? '#cbd5e1' : color}
                      fontSize={10}
                      fontFamily="JetBrains Mono, monospace"
                      fontWeight={isRight ? 700 : 400}
                    >
                      {n.name}{n.kind !== 'project' ? ` (${n.value})` : ''}
                    </text>
                  )
                  return (
                    <g key={n.id}>
                      <rect x={x0} y={y0} width={x1 - x0} height={Math.max(1, y1 - y0)} fill={color} opacity={0.85} rx={2}>
                        <title>{n.name}: {n.value}</title>
                      </rect>
                      {n.kind === 'project'
                        ? <Link href={`/projects/${encodeURIComponent(n.name)}`}>{label}</Link>
                        : label}
                    </g>
                  )
                })}
              </g>
            </svg>
          )}
        </div>

        <div className="mt-4 flex items-center gap-4 text-[0.6rem] font-mono text-slate-500 flex-wrap">
          <span className="flex items-center gap-1.5"><span style={{ width: 10, height: 10, borderRadius: 2, background: PROJECT_COLOR, display: 'inline-block' }} /> project</span>
          <span className="flex items-center gap-1.5"><span style={{ width: 10, height: 10, borderRadius: 2, background: SIGNAL_COLOR, display: 'inline-block' }} /> signal</span>
          <span className="flex items-center gap-1.5"><span style={{ width: 10, height: 10, borderRadius: 2, background: SEVERITY_COLOR.critical, display: 'inline-block' }} /> critical</span>
          <span className="flex items-center gap-1.5"><span style={{ width: 10, height: 10, borderRadius: 2, background: SEVERITY_COLOR.warn, display: 'inline-block' }} /> warn</span>
          <span className="flex items-center gap-1.5"><span style={{ width: 10, height: 10, borderRadius: 2, background: SEVERITY_COLOR.info, display: 'inline-block' }} /> info</span>
        </div>

        <p className="text-[0.5rem] font-mono text-slate-700 mt-3">
          Three-layer flow of live attention findings: each project flows to the signals it fires, which flow to their severity. Link width = finding count. Hover a flow to isolate it; click a project label to open its view. Healthy/ok findings excluded. Data from /api/attention-sankey. Refreshes every 60s.
        </p>
      </main>
    </div>
  )
}
