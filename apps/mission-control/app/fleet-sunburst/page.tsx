'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import type { FleetResponse, FleetProject, ProjectState } from '../api/fleet/route'
import { useFreshness } from '../../lib/useFreshness'
import FreshnessBadge from '../../components/FreshnessBadge'

const STATE_ORDER: ProjectState[] = ['active', 'autonomous', 'idle', 'stalled']
const STATE_COLORS: Record<ProjectState, string> = {
  idle: '#00F5FF',
  active: '#4ADE80',
  stalled: '#EF4444',
  autonomous: '#A855F7',
}

interface Slice {
  key: string
  ring: 'state' | 'platform'
  state: ProjectState
  label: string
  count: number
  slugs: string[]
  a0: number // radians
  a1: number
  color: string
}

const CX = 200, CY = 200
const R0 = 58, R1 = 118, R2 = 178 // ring radii
const GAP = 0.012 // radian gap between platform segments

function polar(r: number, a: number) {
  return { x: CX + r * Math.cos(a), y: CY + r * Math.sin(a) }
}

// Annular sector path between radii [ri, ro] over angle [a0, a1] (radians, clockwise).
function sector(ri: number, ro: number, a0: number, a1: number): string {
  const large = a1 - a0 > Math.PI ? 1 : 0
  const p0 = polar(ro, a0)
  const p1 = polar(ro, a1)
  const p2 = polar(ri, a1)
  const p3 = polar(ri, a0)
  return [
    `M ${p0.x.toFixed(2)} ${p0.y.toFixed(2)}`,
    `A ${ro} ${ro} 0 ${large} 1 ${p1.x.toFixed(2)} ${p1.y.toFixed(2)}`,
    `L ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`,
    `A ${ri} ${ri} 0 ${large} 0 ${p3.x.toFixed(2)} ${p3.y.toFixed(2)}`,
    'Z',
  ].join(' ')
}

// Darken a hex color toward black by factor (0..1) for the outer ring.
function dim(hex: string, factor: number): string {
  const n = parseInt(hex.slice(1), 16)
  const r = Math.round(((n >> 16) & 255) * factor)
  const g = Math.round(((n >> 8) & 255) * factor)
  const b = Math.round((n & 255) * factor)
  return `rgb(${r}, ${g}, ${b})`
}

export default function FleetSunburstPage() {
  const { data, isStale, lastError, lastSuccessAt } = useFreshness<FleetResponse>('/api/fleet', 60_000)
  const loading = data === null && lastError === null
  const [hover, setHover] = useState<Slice | null>(null)

  const { slices, total } = useMemo(() => {
    const projects = (data?.projects ?? []) as FleetProject[]
    const total = projects.length
    const out: Slice[] = []
    if (total === 0) return { slices: out, total }

    // Group by state, then platform.
    const byState = new Map<ProjectState, FleetProject[]>()
    for (const p of projects) {
      const s = p.state
      if (!byState.has(s)) byState.set(s, [])
      byState.get(s)!.push(p)
    }

    let cursor = -Math.PI / 2 // start at 12 o'clock
    for (const state of STATE_ORDER) {
      const members = byState.get(state)
      if (!members || members.length === 0) continue
      const span = (members.length / total) * Math.PI * 2
      const sA0 = cursor, sA1 = cursor + span
      out.push({
        key: `state:${state}`, ring: 'state', state, label: state,
        count: members.length, slugs: members.map((m) => m.slug).sort(),
        a0: sA0, a1: sA1, color: STATE_COLORS[state],
      })

      // Outer ring: platforms within this state.
      const byPlat = new Map<string, FleetProject[]>()
      for (const m of members) {
        const plat = m.platform ?? 'discord'
        if (!byPlat.has(plat)) byPlat.set(plat, [])
        byPlat.get(plat)!.push(m)
      }
      let pCursor = sA0
      const plats = [...byPlat.keys()].sort()
      for (const plat of plats) {
        const pm = byPlat.get(plat)!
        const pSpan = (pm.length / members.length) * span
        const pa0 = pCursor + GAP / 2
        const pa1 = pCursor + pSpan - GAP / 2
        out.push({
          key: `plat:${state}:${plat}`, ring: 'platform', state, label: plat,
          count: pm.length, slugs: pm.map((m) => m.slug).sort(),
          a0: pa0, a1: Math.max(pa0, pa1), color: dim(STATE_COLORS[state], 0.62),
        })
        pCursor += pSpan
      }
      cursor = sA1
    }
    return { slices: out, total }
  }, [data])

  if (loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center" style={{ background: '#060d1a' }}>
        <div className="text-xs font-mono text-slate-600 animate-pulse">Composing fleet sunburst…</div>
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
            Fleet State Sunburst
          </h1>
          <span className="text-[0.6rem] font-mono text-slate-500 border border-slate-700 px-2 py-0.5 rounded">state → platform composition</span>
          <FreshnessBadge isStale={isStale} lastError={lastError} lastSuccessAt={lastSuccessAt} />
          <div className="flex-1" />
          <Link href="/topology" className="text-[0.6rem] font-mono text-slate-500 hover:text-cyber-cyan transition-colors border border-slate-700 hover:border-cyber-cyan/30 px-2 py-1 rounded">Topology →</Link>
        </div>
      </header>

      <main className="flex-1 p-6 max-w-4xl mx-auto w-full">
        {total === 0 ? (
          <div className="h-64 flex items-center justify-center text-slate-600 text-xs font-mono">No projects in the fleet.</div>
        ) : (
          <div className="flex flex-col items-center">
            <svg viewBox="0 0 400 400" className="w-full max-w-md" onMouseLeave={() => setHover(null)}>
              {slices.map((s) => {
                const ri = s.ring === 'state' ? R0 : R1
                const ro = s.ring === 'state' ? R1 : R2
                const active = hover?.key === s.key
                return (
                  <path
                    key={s.key}
                    d={sector(ri, ro, s.a0, s.a1)}
                    fill={s.color}
                    fillOpacity={active ? 0.95 : s.ring === 'state' ? 0.78 : 0.6}
                    stroke="#060d1a"
                    strokeWidth={1.5}
                    style={{ cursor: 'pointer', transition: 'fill-opacity 120ms' }}
                    onMouseEnter={() => setHover(s)}
                  >
                    <title>{`${s.ring === 'state' ? 'state' : 'platform'}: ${s.label} · ${s.count} project${s.count === 1 ? '' : 's'}\n${s.slugs.join(', ')}`}</title>
                  </path>
                )
              })}
              {/* center total */}
              <text x={CX} y={CY - 6} textAnchor="middle" fontSize={34} fontWeight={800} fill="#e2e8f0" fontFamily="Orbitron, monospace">{total}</text>
              <text x={CX} y={CY + 14} textAnchor="middle" fontSize={10} fill="#64748b" fontFamily="JetBrains Mono, monospace" letterSpacing="0.15em">PROJECTS</text>
            </svg>

            {/* hover detail */}
            <div className="mt-4 min-h-[3.5rem] w-full max-w-md text-center">
              {hover ? (
                <div className="rounded-lg border px-4 py-2 inline-block" style={{ borderColor: `${hover.color}55`, background: `${hover.color}11` }}>
                  <div className="text-[0.7rem] font-bold" style={{ color: hover.color, fontFamily: 'Orbitron, monospace' }}>
                    {hover.ring === 'state' ? hover.label : `${hover.state} · ${hover.label}`} — {hover.count} project{hover.count === 1 ? '' : 's'}
                  </div>
                  <div className="mt-1 text-[0.55rem] font-mono text-slate-400">{hover.slugs.join(' · ')}</div>
                </div>
              ) : (
                <div className="text-[0.55rem] font-mono text-slate-600 pt-3">Hover a segment — inner ring = runtime state, outer ring = platform.</div>
              )}
            </div>

            {/* state legend */}
            <div className="mt-4 flex items-center gap-4 text-[0.55rem] font-mono text-slate-500 flex-wrap justify-center">
              {STATE_ORDER.map((st) => (
                <span key={st} className="flex items-center gap-1.5">
                  <span className="inline-block w-3 h-3 rounded-sm" style={{ background: STATE_COLORS[st] }} />{st}
                </span>
              ))}
            </div>
          </div>
        )}

        <p className="text-[0.5rem] font-mono text-slate-700 mt-6 max-w-md mx-auto text-center">
          Two-ring sunburst: inner ring = runtime state, outer ring = platform within each state. Segment angle ∝ project count.
          Hover a segment for its count and member slugs. Reuses <code>/api/fleet</code>. Refreshes every 60s.
        </p>
      </main>
    </div>
  )
}
