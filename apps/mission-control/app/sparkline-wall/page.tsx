'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import type { SparklineWallResponse, SparklineCard } from '../api/sparkline-wall/route'
import { useFreshness } from '../../lib/useFreshness'
import FreshnessBadge from '../../components/FreshnessBadge'

function fmtScore(s: number): string {
  return (s / 100).toFixed(2)
}

const DIR_COLOR: Record<SparklineCard['direction'], string> = {
  up: '#34d399',
  down: '#ef4444',
  flat: '#64748b',
}

const DIR_GLYPH: Record<SparklineCard['direction'], string> = {
  up: '▲',
  down: '▼',
  flat: '·',
}

function Sparkline({ card }: { card: SparklineCard }) {
  const color = DIR_COLOR[card.direction]
  const W = 120
  const H = 28
  const pts = card.points
  const path = useMemo(() => {
    if (pts.length === 0) return ''
    if (pts.length === 1) {
      // single point → flat dash centred vertically
      return `M 0 ${H / 2} L ${W} ${H / 2}`
    }
    const scores = pts.map((p) => p.score)
    const min = Math.min(...scores)
    const max = Math.max(...scores)
    const span = max - min || 1
    const stepX = W / (pts.length - 1)
    return pts
      .map((p, i) => {
        const x = i * stepX
        // invert y: higher score → higher on chart (smaller y)
        const y = H - ((p.score - min) / span) * (H - 4) - 2
        return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`
      })
      .join(' ')
  }, [pts])

  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="overflow-visible">
      <path d={path} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      {pts.length > 1 && (
        <circle
          cx={W}
          cy={(() => {
            const scores = pts.map((p) => p.score)
            const min = Math.min(...scores)
            const max = Math.max(...scores)
            const span = max - min || 1
            return H - ((card.latest - min) / span) * (H - 4) - 2
          })()}
          r={2}
          fill={color}
        />
      )}
    </svg>
  )
}

function Card({ card }: { card: SparklineCard }) {
  const color = DIR_COLOR[card.direction]
  const single = card.points.length <= 1
  return (
    <Link
      href={`/focus/${encodeURIComponent(card.slug)}`}
      className="flex flex-col gap-2 p-3 rounded-lg border border-slate-800 hover:border-cyber-cyan/40 transition-colors"
      style={{ background: 'rgba(255,255,255,0.01)' }}
    >
      <div className="flex items-center gap-2">
        <span className="text-[0.7rem] font-mono text-slate-200 flex-1 truncate">{card.slug}</span>
        <span className="text-sm font-black tabular-nums" style={{ fontFamily: 'Orbitron, monospace', color }}>
          {fmtScore(card.latest)}
        </span>
      </div>
      <Sparkline card={card} />
      <div className="flex items-center gap-1.5">
        <span
          className="text-[0.55rem] font-mono font-bold tabular-nums px-1.5 py-0.5 rounded"
          style={{ color, background: `${color}1a` }}
        >
          {DIR_GLYPH[card.direction]} {single ? '—' : `${card.delta > 0 ? '+' : card.delta < 0 ? '−' : ''}${fmtScore(Math.abs(card.delta))}`}
        </span>
        <span className="text-[0.5rem] font-mono text-slate-600">{card.points.length} pt{card.points.length === 1 ? '' : 's'}</span>
      </div>
    </Link>
  )
}

export default function SparklineWallPage() {
  const { data, isStale, lastError, lastSuccessAt } = useFreshness<SparklineWallResponse>('/api/sparkline-wall', 60_000)
  const loading = data === null && lastError === null

  const cards = data?.cards ?? []
  const decliners = cards.filter((c) => c.direction === 'down').length

  if (loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center" style={{ background: '#060d1a' }}>
        <div className="text-xs font-mono text-slate-600 animate-pulse">Loading convergence sparklines…</div>
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
            Convergence Sparkline Wall
          </h1>
          <span className="text-[0.6rem] font-mono text-slate-500 border border-slate-700 px-2 py-0.5 rounded">every project&apos;s trajectory at a glance</span>
          <FreshnessBadge isStale={isStale} lastError={lastError} lastSuccessAt={lastSuccessAt} />
          <div className="flex-1" />
          <div className="flex items-center gap-1.5">
            <span className="text-[0.55rem] font-mono text-slate-500 uppercase tracking-wider">declining</span>
            <span className="text-lg font-black tabular-nums" style={{ fontFamily: 'Orbitron, monospace', color: decliners > 0 ? '#ef4444' : '#34d399' }}>
              {decliners}
            </span>
          </div>
        </div>
      </header>

      <main className="flex-1 p-6 w-full">
        {cards.length === 0 ? (
          <div className="h-64 flex items-center justify-center text-slate-600 text-xs font-mono">No convergence history recorded yet.</div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
            {cards.map((c) => <Card key={c.slug} card={c} />)}
          </div>
        )}

        <p className="text-[0.5rem] font-mono text-slate-700 mt-5 max-w-3xl">
          One card per project showing the last {data?.days ?? 14} days of <code>convergence_history</code> as an inline
          sparkline (0.0–1.0). Line color encodes overall direction: green up, red down, slate flat. The delta chip compares
          the latest point to the first in the window. Cards are sorted steepest-decline first so projects needing attention
          surface at the top. Single-point series render a flat dash. Reuses <code>/api/sparkline-wall</code>. Refreshes every 60s.
        </p>
      </main>
    </div>
  )
}
