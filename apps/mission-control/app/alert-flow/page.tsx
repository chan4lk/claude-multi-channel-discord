'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import type { AlertFlowResponse, AlertFlowLink, AlertFlowNode } from '../api/alert-flow/route'
import { useFreshness } from '../../lib/useFreshness'
import FreshnessBadge from '../../components/FreshnessBadge'

// Stable color per alert type — hash the type name onto a neon palette.
const PALETTE = ['#22d3ee', '#a78bfa', '#f59e0b', '#34d399', '#ef4444', '#ec4899', '#60a5fa', '#eab308', '#fb923c', '#2dd4bf']
function typeColor(type: string): string {
  let h = 0
  for (let i = 0; i < type.length; i++) h = (h * 31 + type.charCodeAt(i)) >>> 0
  return PALETTE[h % PALETTE.length]
}

const W = 900
const NODE_W = 14
const COL_GAP = 8 // vertical gap between stacked node slices
const PAD_Y = 16

interface Placed {
  id: string
  total: number
  y0: number
  y1: number
}

// Lay out a column of nodes vertically, height ∝ total, scaled to fit `h`.
function placeColumn(nodes: AlertFlowNode[], h: number, grandTotal: number): Map<string, Placed> {
  const m = new Map<string, Placed>()
  const gaps = Math.max(0, nodes.length - 1) * COL_GAP
  const usable = Math.max(1, h - gaps)
  let y = PAD_Y
  for (const n of nodes) {
    const seg = grandTotal > 0 ? (n.total / grandTotal) * usable : usable / Math.max(1, nodes.length)
    m.set(n.id, { id: n.id, total: n.total, y0: y, y1: y + seg })
    y += seg + COL_GAP
  }
  return m
}

function Sankey({ data }: { data: AlertFlowResponse }) {
  const [hover, setHover] = useState<{ kind: 'project' | 'type' | 'link'; key: string } | null>(null)

  const { left, right, ribbons, height } = useMemo(() => {
    const rowH = Math.max(28, Math.min(34, 520 / Math.max(data.projects.length, data.types.length, 1)))
    const height = Math.max(
      data.projects.length * rowH + PAD_Y * 2,
      data.types.length * rowH + PAD_Y * 2,
      200
    )
    const left = placeColumn(data.projects, height, data.total)
    const right = placeColumn(data.types, height, data.total)

    // Track per-node running offset so multiple ribbons stack within a slice.
    const lOff = new Map<string, number>()
    const rOff = new Map<string, number>()
    const leftX = 160
    const rightX = W - 160

    const ribbons = data.links
      .slice()
      .map((lnk: AlertFlowLink, i) => {
        const lp = left.get(lnk.slug)
        const rp = right.get(lnk.alert_type)
        if (!lp || !rp) return null
        const lh = lp.y1 - lp.y0
        const rh = rp.y1 - rp.y0
        const lThick = data.total > 0 ? (lnk.count / Math.max(1, lp.total)) * lh : lh
        const rThick = data.total > 0 ? (lnk.count / Math.max(1, rp.total)) * rh : rh
        const ly = lp.y0 + (lOff.get(lnk.slug) ?? 0)
        const ry = rp.y0 + (rOff.get(lnk.alert_type) ?? 0)
        lOff.set(lnk.slug, (lOff.get(lnk.slug) ?? 0) + lThick)
        rOff.set(lnk.alert_type, (rOff.get(lnk.alert_type) ?? 0) + rThick)
        const lyc = ly + lThick / 2
        const ryc = ry + rThick / 2
        const x0 = leftX + NODE_W
        const x1 = rightX
        const mx = (x0 + x1) / 2
        const path = `M ${x0} ${lyc} C ${mx} ${lyc} ${mx} ${ryc} ${x1} ${ryc}`
        return {
          key: `${lnk.slug}→${lnk.alert_type}`,
          slug: lnk.slug,
          alert_type: lnk.alert_type,
          count: lnk.count,
          path,
          thickness: Math.max(1, (lThick + rThick) / 2),
          color: typeColor(lnk.alert_type),
        }
      })
      .filter(Boolean) as {
        key: string; slug: string; alert_type: string; count: number; path: string; thickness: number; color: string
      }[]

    return { left, right, ribbons, height, leftX, rightX }
  }, [data])

  const leftX = 160
  const rightX = W - 160

  function ribbonActive(r: { key: string; slug: string; alert_type: string }): boolean {
    if (!hover) return true
    if (hover.kind === 'link') return hover.key === r.key
    if (hover.kind === 'project') return hover.key === r.slug
    return hover.key === r.alert_type
  }

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${height}`} className="block" style={{ maxWidth: W }}>
      {/* ribbons */}
      {ribbons.map((r) => {
        const active = ribbonActive(r)
        return (
          <path
            key={r.key}
            d={r.path}
            fill="none"
            stroke={r.color}
            strokeWidth={r.thickness}
            strokeOpacity={active ? 0.5 : 0.08}
            style={{ transition: 'stroke-opacity 0.15s' }}
            onMouseEnter={() => setHover({ kind: 'link', key: r.key })}
            onMouseLeave={() => setHover(null)}
          >
            <title>{`${r.slug} → ${r.alert_type}: ${r.count}`}</title>
          </path>
        )
      })}

      {/* project nodes (left) */}
      {data.projects.map((n) => {
        const p = left.get(n.id)!
        const active = !hover || (hover.kind === 'project' && hover.key === n.id) ||
          (hover.kind === 'link' && hover.key.startsWith(`${n.id}→`))
        return (
          <g key={`p-${n.id}`} onMouseEnter={() => setHover({ kind: 'project', key: n.id })} onMouseLeave={() => setHover(null)} style={{ cursor: 'pointer' }}>
            <rect x={leftX} y={p.y0} width={NODE_W} height={Math.max(2, p.y1 - p.y0)} rx={2} fill="#22d3ee" fillOpacity={active ? 0.9 : 0.3} />
            <text x={leftX - 6} y={(p.y0 + p.y1) / 2} textAnchor="end" dominantBaseline="middle" className="font-mono" fontSize={9} fill={active ? '#e2e8f0' : '#64748b'}>
              {n.id} · {n.total}
            </text>
          </g>
        )
      })}

      {/* type nodes (right) */}
      {data.types.map((n) => {
        const p = right.get(n.id)!
        const c = typeColor(n.id)
        const active = !hover || (hover.kind === 'type' && hover.key === n.id) ||
          (hover.kind === 'link' && hover.key.endsWith(`→${n.id}`))
        return (
          <g key={`t-${n.id}`} onMouseEnter={() => setHover({ kind: 'type', key: n.id })} onMouseLeave={() => setHover(null)} style={{ cursor: 'pointer' }}>
            <rect x={rightX} y={p.y0} width={NODE_W} height={Math.max(2, p.y1 - p.y0)} rx={2} fill={c} fillOpacity={active ? 0.9 : 0.3} />
            <text x={rightX + NODE_W + 6} y={(p.y0 + p.y1) / 2} textAnchor="start" dominantBaseline="middle" className="font-mono" fontSize={9} fill={active ? '#e2e8f0' : '#64748b'}>
              {n.id} · {n.total}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

export default function AlertFlowPage() {
  const { data, isStale, lastError, lastSuccessAt } = useFreshness<AlertFlowResponse>('/api/alert-flow', 60_000)
  const loading = data === null && lastError === null

  if (loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center" style={{ background: '#060d1a' }}>
        <div className="text-xs font-mono text-slate-600 animate-pulse">Loading alert flow…</div>
      </div>
    )
  }

  const total = data?.total ?? 0
  const dominant = data?.dominant ?? null

  return (
    <div className="min-h-dvh flex flex-col" style={{ background: '#060d1a' }}>
      <header className="sticky top-0 z-30 border-b border-cyber-cyan/12 bg-[#060d1a]/90 backdrop-blur-md px-6 py-3">
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-cyber-cyan/40 to-transparent" />
        <div className="flex items-center gap-3 flex-wrap">
          <Link href="/" className="text-[0.6rem] font-mono text-slate-500 hover:text-cyber-cyan transition-colors uppercase tracking-wider">← Dashboard</Link>
          <h1 className="text-sm font-black tracking-[0.18em] text-cyber-cyan" style={{ fontFamily: 'Orbitron, JetBrains Mono, monospace' }}>
            Alert Type Flow
          </h1>
          <span className="text-[0.6rem] font-mono text-slate-500 border border-slate-700 px-2 py-0.5 rounded">projects → alert types · 30d</span>
          <FreshnessBadge isStale={isStale} lastError={lastError} lastSuccessAt={lastSuccessAt} />
          <div className="flex-1" />
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5">
              <span className="text-[0.55rem] font-mono text-slate-500 uppercase tracking-wider">alerts</span>
              <span className="text-lg font-black tabular-nums text-cyber-cyan" style={{ fontFamily: 'Orbitron, monospace' }}>{total}</span>
            </div>
            {dominant && (
              <div className="flex items-center gap-1.5">
                <span className="text-[0.55rem] font-mono text-slate-500 uppercase tracking-wider">dominant</span>
                <span className="text-[0.65rem] font-mono text-slate-300">{dominant.slug} · {dominant.alert_type} ({dominant.count})</span>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 p-6 w-full overflow-x-auto">
        {total === 0 ? (
          <div className="h-64 flex items-center justify-center text-slate-600 text-xs font-mono">No alert events recorded in the last 30 days.</div>
        ) : (
          <div className="rounded-lg border border-cyber-cyan/10 bg-[#0a1424]/40 p-4">
            <Sankey data={data!} />
          </div>
        )}

        <p className="text-[0.5rem] font-mono text-slate-700 mt-6 max-w-3xl">
          Two-column flow (lightweight Sankey) of <code>alert_events</code> over the last 30 days. Left nodes are projects,
          right nodes are alert types; ribbon thickness ∝ alert count and ribbons are colored by alert type. Hovering a
          ribbon, project, or type highlights its connections. Node labels show per-node totals. Reuses
          <code>/api/alert-flow</code>. Refreshes every 60s.
        </p>
      </main>
    </div>
  )
}
