'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import type { BridgeGraph, BridgeEdge } from '../api/memory-proposal-bridge/route'
import { useFreshness } from '../../lib/useFreshness'
import FreshnessBadge from '../../components/FreshnessBadge'
import SubPageHeader from '../../components/SubPageHeader'

const MEM_COLOR = '#A78BFA'
const PROP_COLOR = '#fbbf24'

const W = 920
const COL_LEFT = 200
const COL_RIGHT = W - 200
const ROW_H = 34
const PAD_TOP = 28

interface Placed {
  id: string
  label: string
  slug: string
  x: number
  y: number
}

export default function MemoryBridgePage() {
  const [min, setMin] = useState(2)
  const { data, isStale, lastError, lastSuccessAt } = useFreshness<BridgeGraph>(
    `/api/memory-proposal-bridge?min=${min}`,
    60_000,
  )
  const loading = data === null && lastError === null
  const [hover, setHover] = useState<BridgeEdge | null>(null)

  // Lay out memories down the left column, proposals down the right, ordered by
  // their connectedness so the busiest nodes cluster near the top.
  const { memPlaced, propPlaced, height, byId } = useMemo(() => {
    const edges = data?.edges ?? []
    const degree = new Map<string, number>()
    for (const e of edges) {
      degree.set(e.source, (degree.get(e.source) ?? 0) + e.weight)
      degree.set(e.target, (degree.get(e.target) ?? 0) + e.weight)
    }
    const sortByDeg = <T extends { id: string }>(arr: T[]) =>
      [...arr].sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0))

    const mem = sortByDeg(data?.memories ?? [])
    const prop = sortByDeg(data?.proposals ?? [])
    const memPlaced: Placed[] = mem.map((n, i) => ({ ...n, x: COL_LEFT, y: PAD_TOP + i * ROW_H }))
    const propPlaced: Placed[] = prop.map((n, i) => ({ ...n, x: COL_RIGHT, y: PAD_TOP + i * ROW_H }))
    const byId = new Map<string, Placed>()
    for (const p of memPlaced) byId.set(p.id, p)
    for (const p of propPlaced) byId.set(p.id, p)
    const height = PAD_TOP * 2 + Math.max(mem.length, prop.length, 1) * ROW_H
    return { memPlaced, propPlaced, height, byId }
  }, [data])

  const edges = data?.edges ?? []
  const maxWeight = useMemo(() => edges.reduce((m, e) => Math.max(m, e.weight), 1), [edges])
  const hasData = (data?.edges.length ?? 0) > 0

  if (loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center" style={{ background: '#060d1a' }}>
        <div className="text-xs font-mono text-slate-600 animate-pulse">Loading theme bridge…</div>
      </div>
    )
  }

  return (
    <div className="min-h-dvh flex flex-col" style={{ background: '#060d1a' }}>
      <SubPageHeader title="Memory ⇄ Proposal Bridge">
        <div className="flex items-center gap-1.5 text-[0.55rem] font-mono">
          <span className="text-slate-500 uppercase tracking-wider">min overlap</span>
          {[1, 2, 3].map((v) => (
            <button key={v} onClick={() => setMin(v)}
              className="px-2 py-0.5 rounded border transition-colors tabular-nums"
              style={{
                color: min === v ? '#00F5FF' : '#475569',
                borderColor: min === v ? '#00F5FF60' : '#1e293b',
                background: min === v ? '#00F5FF14' : 'transparent',
              }}>
              ≥{v}
            </button>
          ))}
        </div>
        <FreshnessBadge isStale={isStale} lastError={lastError} lastSuccessAt={lastSuccessAt} />
      </SubPageHeader>

      <main className="flex-1 p-6 max-w-7xl mx-auto w-full flex flex-col">
        {!hasData ? (
          <div className="flex-1 min-h-[24rem] flex flex-col items-center justify-center gap-2 text-center px-6">
            <div className="text-4xl opacity-20">⇄</div>
            <p className="text-xs text-slate-600 font-mono">
              No theme overlaps at min ≥{min}. Lower the threshold, or once proposals echo recorded
              learnings the links appear here.
            </p>
          </div>
        ) : (
          <div className="relative rounded-xl border border-cyber-cyan/12 overflow-x-auto" style={{ background: 'rgba(0,245,255,0.02)' }}>
            <svg viewBox={`0 0 ${W} ${height}`} width="100%" style={{ minWidth: 720, display: 'block' }}>
              {/* column captions */}
              <text x={COL_LEFT} y={16} textAnchor="end" fill={MEM_COLOR} fontSize={10} fontFamily="JetBrains Mono, monospace" opacity={0.7}>
                MEMORIES
              </text>
              <text x={COL_RIGHT} y={16} textAnchor="start" fill={PROP_COLOR} fontSize={10} fontFamily="JetBrains Mono, monospace" opacity={0.7}>
                PROPOSALS
              </text>

              {/* edges */}
              <g>
                {edges.map((e, i) => {
                  const s = byId.get(e.source)
                  const t = byId.get(e.target)
                  if (!s || !t) return null
                  const active = hover === e
                  const dim = hover !== null && !active
                  const midX = (s.x + t.x) / 2
                  const d = `M ${s.x} ${s.y} C ${midX} ${s.y}, ${midX} ${t.y}, ${t.x} ${t.y}`
                  return (
                    <path key={i} d={d} fill="none"
                      stroke={active ? '#00F5FF' : MEM_COLOR}
                      strokeWidth={1 + (e.weight / maxWeight) * 4}
                      strokeOpacity={dim ? 0.06 : active ? 0.9 : 0.22}
                      onMouseEnter={() => setHover(e)}
                      onMouseLeave={() => setHover(null)}
                      style={{ cursor: 'pointer' }}
                    />
                  )
                })}
              </g>

              {/* memory nodes */}
              {memPlaced.map((n) => (
                <g key={n.id}>
                  <circle cx={n.x} cy={n.y} r={4} fill={`${MEM_COLOR}33`} stroke={MEM_COLOR} strokeWidth={1} />
                  <text x={n.x - 9} y={n.y + 3} textAnchor="end" fill="#cbd5e1" fontSize={9} fontFamily="JetBrains Mono, monospace">
                    {n.label.length > 30 ? n.label.slice(0, 29) + '…' : n.label}
                  </text>
                </g>
              ))}

              {/* proposal nodes */}
              {propPlaced.map((n) => (
                <g key={n.id}>
                  <circle cx={n.x} cy={n.y} r={4} fill={`${PROP_COLOR}33`} stroke={PROP_COLOR} strokeWidth={1} />
                  <text x={n.x + 9} y={n.y + 3} textAnchor="start" fill="#cbd5e1" fontSize={9} fontFamily="JetBrains Mono, monospace">
                    {n.label.length > 30 ? n.label.slice(0, 29) + '…' : n.label}
                  </text>
                </g>
              ))}
            </svg>

            {/* hover detail */}
            {hover && (
              <div className="absolute top-3 left-1/2 -translate-x-1/2 rounded-lg border border-white/10 bg-cyber-surface/95 backdrop-blur-md px-3 py-2 shadow-xl pointer-events-none">
                <div className="text-[0.55rem] font-mono text-slate-500 uppercase tracking-wider mb-1">
                  {hover.weight} shared term{hover.weight === 1 ? '' : 's'}
                </div>
                <div className="flex flex-wrap gap-1 max-w-xs">
                  {hover.terms.map((t) => (
                    <span key={t} className="text-[0.6rem] font-mono px-1.5 py-0.5 rounded" style={{ color: '#00F5FF', background: '#00F5FF14' }}>
                      {t}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="flex items-center gap-4 mt-3 text-[0.55rem] font-mono">
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full" style={{ background: MEM_COLOR }} /> <span className="text-slate-400">memory</span></span>
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full" style={{ background: PROP_COLOR }} /> <span className="text-slate-400">proposal</span></span>
          <Link href="/backlog" className="text-slate-500 hover:text-cyber-cyan transition-colors">backlog →</Link>
          <Link href="/memory-graph" className="text-slate-500 hover:text-cyber-cyan transition-colors">memory graph →</Link>
        </div>

        <p className="text-[0.5rem] font-mono text-slate-700 mt-4 max-w-3xl">
          Bipartite theme bridge (P215). Edges link a <span style={{ color: MEM_COLOR }}>memory</span> to a
          pending <span style={{ color: PROP_COLOR }}>proposal</span> when they share ≥{min} significant theme
          terms (token overlap over <code>memory.db</code> descriptions and BACKLOG.md / specclaw STATUS.md
          titles + problem statements). Thicker edges = stronger overlap. Hover a link for the matched terms.
          Tune the threshold from the header; refreshes every 60s.
        </p>
      </main>
    </div>
  )
}
