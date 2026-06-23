'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import type { NexusResponse, NexusProject, ProjectState, GoalStatus } from '../api/nexus/route'

const STATE_COLOR: Record<ProjectState, string> = {
  active: '#4ADE80',
  autonomous: '#A78BFA',
  stalled: '#EF4444',
  idle: '#38BDF8',
}

const GOAL_COLOR: Record<GoalStatus, string> = {
  active: '#A78BFA',
  paused: '#F59E0B',
  completed: '#4ADE80',
  none: '#334155',
}

const MEM_COLOR = '#00F5FF'
const PROP_COLOR = '#F59E0B'

function fmtAge(mins: number): string {
  if (mins >= 9999) return 'never'
  if (mins < 60) return `${mins}m`
  if (mins < 1440) return `${Math.floor(mins / 60)}h`
  return `${Math.floor(mins / 1440)}d`
}

// Memory satellite radius scales with count (log-ish), clamped.
function memRadius(n: number): number {
  if (n <= 0) return 0
  return Math.min(14, 4 + Math.sqrt(n) * 1.6)
}

interface Placed extends NexusProject {
  cx: number
  cy: number
}

const VIEW = 760
const CENTER = VIEW / 2
const RING = 280

export default function NexusPage() {
  const [data, setData] = useState<NexusResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [hover, setHover] = useState<string | null>(null)

  useEffect(() => {
    function load() {
      fetch('/api/nexus')
        .then((r) => r.json() as Promise<NexusResponse>)
        .then((d) => { setData(d); setLoading(false) })
        .catch(() => setLoading(false))
    }
    load()
    const t = setInterval(load, 60_000)
    return () => clearInterval(t)
  }, [])

  const placed = useMemo<Placed[]>(() => {
    const projects = data?.projects ?? []
    const n = projects.length
    if (n === 0) return []
    // Single project sits at center; otherwise spread deterministically on a ring.
    if (n === 1) return [{ ...projects[0]!, cx: CENTER, cy: CENTER }]
    return projects.map((p, i) => {
      const angle = (i / n) * Math.PI * 2 - Math.PI / 2
      return { ...p, cx: CENTER + Math.cos(angle) * RING, cy: CENTER + Math.sin(angle) * RING }
    })
  }, [data])

  if (loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center" style={{ background: '#060d1a' }}>
        <div className="text-xs font-mono text-slate-600 animate-pulse">Loading nexus map…</div>
      </div>
    )
  }

  const fleet = data?.fleet
  const active = hover ? placed.find((p) => p.slug === hover) ?? null : null

  return (
    <div className="min-h-dvh flex flex-col" style={{ background: '#060d1a' }}>
      <header className="sticky top-0 z-30 border-b border-cyber-cyan/12 bg-[#060d1a]/90 backdrop-blur-md px-6 py-3">
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-cyber-cyan/40 to-transparent" />
        <div className="flex items-center gap-3 flex-wrap">
          <Link href="/" className="text-[0.6rem] font-mono text-slate-500 hover:text-cyber-cyan transition-colors uppercase tracking-wider">← Dashboard</Link>
          <h1 className="text-sm font-black tracking-[0.18em] text-cyber-cyan" style={{ fontFamily: 'Orbitron, JetBrains Mono, monospace' }}>
            Nexus Map
          </h1>
          {/* Fleet summary bar */}
          {fleet && (
            <div className="flex items-center gap-3 flex-wrap text-[0.6rem] font-mono">
              <span className="text-slate-500">{fleet.projects} projects</span>
              <span style={{ color: MEM_COLOR }}>◈ {fleet.memories} memories</span>
              <span style={{ color: PROP_COLOR }}>⬒ {fleet.proposalPending} pending</span>
              <span className="text-emerald-400">✓ {fleet.proposalDone} done</span>
              <span style={{ color: GOAL_COLOR.active }}>◎ {fleet.activeGoals} active goals</span>
            </div>
          )}
          <div className="flex-1" />
          <Link href="/knowledge" className="text-[0.6rem] font-mono text-slate-500 hover:text-cyber-cyan transition-colors border border-slate-700 hover:border-cyber-cyan/30 px-2 py-1 rounded">
            Knowledge →
          </Link>
        </div>
      </header>

      <main className="flex-1 p-4 flex items-center justify-center relative">
        {placed.length === 0 ? (
          <div className="text-slate-600 font-mono text-xs">No projects found.</div>
        ) : (
          <svg viewBox={`0 0 ${VIEW} ${VIEW}`} className="w-full" style={{ maxWidth: VIEW, maxHeight: '80vh' }}>
            {/* faint orbit ring */}
            {placed.length > 1 && (
              <circle cx={CENTER} cy={CENTER} r={RING} fill="none" stroke="#0e2233" strokeWidth={1} strokeDasharray="2 6" />
            )}
            {placed.map((p) => {
              const sc = STATE_COLOR[p.state]
              const isHot = hover === p.slug
              const hubR = 18
              const mr = memRadius(p.memoryCount)
              // satellite anchor points around the hub
              const memPt = { x: p.cx - 30, y: p.cy - 26 }
              const propPt = { x: p.cx + 30, y: p.cy - 26 }
              const goalPt = { x: p.cx, y: p.cy + 34 }
              return (
                <g
                  key={p.slug}
                  onMouseEnter={() => setHover(p.slug)}
                  onMouseLeave={() => setHover((h) => (h === p.slug ? null : h))}
                  style={{ cursor: 'pointer' }}
                >
                  {/* hub→satellite spokes */}
                  <line x1={p.cx} y1={p.cy} x2={memPt.x} y2={memPt.y} stroke={MEM_COLOR} strokeWidth={0.6} opacity={p.memoryCount > 0 ? 0.3 : 0.08} />
                  <line x1={p.cx} y1={p.cy} x2={propPt.x} y2={propPt.y} stroke={PROP_COLOR} strokeWidth={0.6} opacity={(p.proposalPending + p.proposalDone) > 0 ? 0.3 : 0.08} />
                  <line x1={p.cx} y1={p.cy} x2={goalPt.x} y2={goalPt.y} stroke={GOAL_COLOR[p.goalStatus]} strokeWidth={0.6} opacity={p.goalStatus !== 'none' ? 0.3 : 0.08} />

                  {/* Memory satellite */}
                  {p.memoryCount > 0 && (
                    <g>
                      <circle cx={memPt.x} cy={memPt.y} r={mr} fill={MEM_COLOR} opacity={0.18} />
                      <circle cx={memPt.x} cy={memPt.y} r={mr} fill="none" stroke={MEM_COLOR} strokeWidth={1} opacity={0.7} />
                      <text x={memPt.x} y={memPt.y + 3} textAnchor="middle" fontSize={8} fill={MEM_COLOR} fontFamily="monospace">{p.memoryCount}</text>
                    </g>
                  )}

                  {/* Proposal satellite — pending arc (amber) + done (emerald) */}
                  {(p.proposalPending + p.proposalDone) > 0 && (
                    <g>
                      <circle cx={propPt.x} cy={propPt.y} r={11} fill={PROP_COLOR} opacity={p.proposalPending > 0 ? 0.18 : 0.06} />
                      <circle cx={propPt.x} cy={propPt.y} r={11} fill="none" stroke={p.proposalPending > 0 ? PROP_COLOR : '#4ADE80'} strokeWidth={1} opacity={0.7} />
                      <text x={propPt.x} y={propPt.y + 3} textAnchor="middle" fontSize={7.5} fill={p.proposalPending > 0 ? PROP_COLOR : '#4ADE80'} fontFamily="monospace">
                        {p.proposalPending}/{p.proposalDone}
                      </text>
                    </g>
                  )}

                  {/* Goal satellite */}
                  {p.goalStatus !== 'none' && (
                    <g>
                      <circle cx={goalPt.x} cy={goalPt.y} r={9} fill={GOAL_COLOR[p.goalStatus]} opacity={0.2} />
                      <circle cx={goalPt.x} cy={goalPt.y} r={9} fill="none" stroke={GOAL_COLOR[p.goalStatus]} strokeWidth={1} opacity={0.75} />
                      <text x={goalPt.x} y={goalPt.y + 3} textAnchor="middle" fontSize={9} fill={GOAL_COLOR[p.goalStatus]} fontFamily="monospace">◎</text>
                    </g>
                  )}

                  {/* Project hub */}
                  <circle cx={p.cx} cy={p.cy} r={hubR + (isHot ? 4 : 0)} fill={sc} opacity={0.14} />
                  <circle cx={p.cx} cy={p.cy} r={hubR} fill="#081320" stroke={sc} strokeWidth={isHot ? 2 : 1.4} opacity={0.95}>
                    {p.state === 'stalled' && <animate attributeName="opacity" values="0.95;0.5;0.95" dur="1.4s" repeatCount="indefinite" />}
                  </circle>
                  <text x={p.cx} y={p.cy + 3} textAnchor="middle" fontSize={9} fill={sc} fontFamily="monospace" fontWeight="bold">
                    {p.slug.slice(0, 4)}
                  </text>
                  <text x={p.cx} y={p.cy + hubR + 12} textAnchor="middle" fontSize={8} fill="#64748b" fontFamily="monospace">
                    {p.slug.length > 14 ? p.slug.slice(0, 13) + '…' : p.slug}
                  </text>
                </g>
              )
            })}
          </svg>
        )}

        {/* Hover detail card */}
        {active && (
          <div
            className="absolute top-4 right-4 z-20 rounded-lg border border-cyber-cyan/25 p-4 font-mono text-[0.65rem] shadow-xl"
            style={{ background: '#081320', minWidth: 220 }}
          >
            <div className="flex items-center gap-2 mb-2 pb-2 border-b border-white/10">
              <span style={{ color: STATE_COLOR[active.state] }}>●</span>
              <Link href={`/projects/${encodeURIComponent(active.slug)}`} className="text-cyber-cyan hover:underline font-bold">{active.slug}</Link>
            </div>
            <div className="grid grid-cols-2 gap-y-1.5 gap-x-3 text-slate-400">
              <span>State</span><span style={{ color: STATE_COLOR[active.state] }}>{active.state}</span>
              <span>Last active</span><span className="text-slate-300">{fmtAge(active.ageMins)}</span>
              <span>Memories</span><span style={{ color: MEM_COLOR }}>{active.memoryCount}</span>
              <span>Proposals</span><span><span style={{ color: PROP_COLOR }}>{active.proposalPending} pending</span> <span className="text-emerald-400">/ {active.proposalDone} done</span></span>
              <span>Goal</span><span style={{ color: GOAL_COLOR[active.goalStatus] }}>{active.goalStatus}</span>
            </div>
            {active.goalText && (
              <div className="mt-2 pt-2 border-t border-white/10 text-slate-500 leading-snug">{active.goalText}</div>
            )}
          </div>
        )}

        {/* Legend */}
        <div className="absolute bottom-4 left-4 z-10 flex flex-col gap-1 font-mono text-[0.55rem] text-slate-500">
          <div className="flex items-center gap-1.5"><span style={{ color: MEM_COLOR }}>◈</span> memory (sized by count)</div>
          <div className="flex items-center gap-1.5"><span style={{ color: PROP_COLOR }}>⬒</span> proposals (pending/done)</div>
          <div className="flex items-center gap-1.5"><span style={{ color: GOAL_COLOR.active }}>◎</span> goal (colored by status)</div>
        </div>
      </main>
    </div>
  )
}
