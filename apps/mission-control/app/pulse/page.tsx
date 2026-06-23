'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import type { FleetResponse, FleetProject, ProjectState } from '../api/fleet/route'

const STATE_COLOR: Record<ProjectState, string> = {
  active: '#4ADE80',
  idle: '#22D3EE',
  stalled: '#EF4444',
  autonomous: '#A78BFA',
}

// Stable hash → [0,1) for a slug, used to place each blip in a fixed angular sector.
function hashUnit(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return ((h >>> 0) % 100000) / 100000
}

const SWEEP_PERIOD_S = 4 // seconds per full rotation

// Radial distance from staleness: 0 mins → centre, MAX_MINS → rim.
const MAX_MINS = 240
function radialFrac(ageMins: number): number {
  const m = Math.max(0, Math.min(MAX_MINS, ageMins))
  // sqrt so freshly-active blips spread out near centre rather than bunching.
  return Math.sqrt(m / MAX_MINS)
}

interface Blip {
  project: FleetProject
  angleDeg: number
  cx: number
  cy: number
  color: string
  delayS: number
}

export default function PulsePage() {
  const [data, setData] = useState<FleetResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [hover, setHover] = useState<Blip | null>(null)

  useEffect(() => {
    function load() {
      fetch('/api/fleet')
        .then((r) => r.json() as Promise<FleetResponse>)
        .then((d) => { setData(d); setLoading(false) })
        .catch(() => setLoading(false))
    }
    load()
    const t = setInterval(load, 5_000)
    return () => clearInterval(t)
  }, [])

  const SIZE = 520
  const C = SIZE / 2
  const R = C - 24

  const blips: Blip[] = useMemo(() => {
    const projects = data?.projects ?? []
    return projects.map((p) => {
      const angleDeg = hashUnit(p.slug) * 360
      const rad = (angleDeg - 90) * (Math.PI / 180)
      const dist = radialFrac(p.ageMins) * R
      return {
        project: p,
        angleDeg,
        cx: C + Math.cos(rad) * dist,
        cy: C + Math.sin(rad) * dist,
        color: STATE_COLOR[p.state] ?? '#64748B',
        // Brighten when the sweep line passes this blip's angle.
        delayS: (angleDeg / 360) * SWEEP_PERIOD_S,
      }
    })
  }, [data, C, R])

  if (loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center" style={{ background: '#060d1a' }}>
        <div className="text-xs font-mono text-slate-600 animate-pulse">Acquiring fleet pulse…</div>
      </div>
    )
  }

  const rings = [0.25, 0.5, 0.75, 1]
  const spokes = [0, 45, 90, 135, 180, 225, 270, 315]

  return (
    <div className="min-h-dvh flex flex-col" style={{ background: '#060d1a' }}>
      <style>{`
        @keyframes mc-sweep { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes mc-blip { 0%,100% { opacity: 0.45; } 8% { opacity: 1; } 24% { opacity: 0.45; } }
      `}</style>
      <header className="sticky top-0 z-30 border-b border-cyber-cyan/12 bg-[#060d1a]/90 backdrop-blur-md px-6 py-3">
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-cyber-cyan/40 to-transparent" />
        <div className="flex items-center gap-3 flex-wrap">
          <Link href="/" className="text-[0.6rem] font-mono text-slate-500 hover:text-cyber-cyan transition-colors uppercase tracking-wider">← Dashboard</Link>
          <h1 className="text-sm font-black tracking-[0.18em] text-cyber-cyan" style={{ fontFamily: 'Orbitron, JetBrains Mono, monospace' }}>
            Fleet Pulse Radar
          </h1>
          <span className="text-[0.6rem] font-mono text-slate-500 border border-slate-700 px-2 py-0.5 rounded">centre = fresh · rim = stale</span>
          <div className="flex-1" />
          <Link href="/constellation" className="text-[0.6rem] font-mono text-slate-500 hover:text-cyber-cyan transition-colors border border-slate-700 hover:border-cyber-cyan/30 px-2 py-1 rounded">Constellation →</Link>
        </div>
      </header>

      <main className="flex-1 p-6 flex flex-col items-center gap-4">
        {blips.length === 0 ? (
          <div className="h-64 flex items-center justify-center text-slate-600 text-xs font-mono">No projects in fleet.</div>
        ) : (
          <div className="relative">
            <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
              <defs>
                <radialGradient id="sweepGrad">
                  <stop offset="0%" stopColor="#22D3EE" stopOpacity="0.35" />
                  <stop offset="100%" stopColor="#22D3EE" stopOpacity="0" />
                </radialGradient>
              </defs>

              {/* range rings */}
              {rings.map((f) => (
                <circle key={f} cx={C} cy={C} r={R * f} fill="none" stroke="#1e3a4a" strokeWidth={1} strokeOpacity={0.5} />
              ))}
              {/* spokes */}
              {spokes.map((a) => {
                const rad = (a - 90) * (Math.PI / 180)
                return <line key={a} x1={C} y1={C} x2={C + Math.cos(rad) * R} y2={C + Math.sin(rad) * R} stroke="#1e3a4a" strokeWidth={0.5} strokeOpacity={0.4} />
              })}

              {/* rotating sweep wedge */}
              <g style={{ transformOrigin: `${C}px ${C}px`, animation: `mc-sweep ${SWEEP_PERIOD_S}s linear infinite` }}>
                <path d={`M ${C} ${C} L ${C} ${C - R} A ${R} ${R} 0 0 1 ${C + R * Math.sin(Math.PI / 6)} ${C - R * Math.cos(Math.PI / 6)} Z`} fill="url(#sweepGrad)" />
                <line x1={C} y1={C} x2={C} y2={C - R} stroke="#22D3EE" strokeWidth={1.5} strokeOpacity={0.7} />
              </g>

              {/* blips */}
              {blips.map((b) => {
                const isHover = hover?.project.slug === b.project.slug
                return (
                  <g key={b.project.slug}
                    onMouseEnter={() => setHover(b)} onMouseLeave={() => setHover((h) => (h?.project.slug === b.project.slug ? null : h))}
                    style={{ cursor: 'pointer' }}>
                    {isHover && <circle cx={b.cx} cy={b.cy} r={9} fill="none" stroke={b.color} strokeWidth={1} strokeOpacity={0.6} />}
                    <circle cx={b.cx} cy={b.cy} r={isHover ? 5 : 4} fill={b.color}
                      style={{ animation: `mc-blip ${SWEEP_PERIOD_S}s linear infinite`, animationDelay: `${b.delayS}s`, filter: `drop-shadow(0 0 4px ${b.color})` }} />
                  </g>
                )
              })}
              <circle cx={C} cy={C} r={2.5} fill="#22D3EE" />
            </svg>

            {hover && (
              <div className="absolute top-2 left-2 rounded border px-2 py-1 text-[0.6rem] font-mono pointer-events-none"
                style={{ borderColor: `${hover.color}55`, background: '#060d1aee', color: hover.color }}>
                <div className="font-bold">{hover.project.slug}</div>
                <div className="text-slate-400">{hover.project.state} · {hover.project.ageMins}m idle</div>
              </div>
            )}
          </div>
        )}

        {/* legend */}
        <div className="flex flex-wrap gap-3 justify-center">
          {(['active', 'idle', 'autonomous', 'stalled'] as ProjectState[]).map((s) => (
            <span key={s} className="flex items-center gap-1.5 text-[0.6rem] font-mono text-slate-400">
              <span style={{ width: 8, height: 8, borderRadius: 999, background: STATE_COLOR[s], display: 'inline-block', boxShadow: `0 0 4px ${STATE_COLOR[s]}` }} />
              {s}
            </span>
          ))}
        </div>

        <p className="text-[0.5rem] font-mono text-slate-700 max-w-lg text-center">
          Each blip is a project; angular sector is hashed from the slug (stable across refreshes). Radial distance encodes staleness:
          centre = active within a minute, rim = idle/stalled ≥ {MAX_MINS / 60}h. The sweep line rotates every {SWEEP_PERIOD_S}s and brightens blips as it passes. Refreshes every 5s.
        </p>
      </main>
    </div>
  )
}
