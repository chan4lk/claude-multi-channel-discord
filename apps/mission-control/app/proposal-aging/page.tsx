'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import type { BacklogResponse, ProjectBacklog } from '../api/backlog/route'
import { useFreshness } from '../../lib/useFreshness'
import FreshnessBadge from '../../components/FreshnessBadge'

interface Dot {
  title: string
  slug: string
  ageDays: number | null // null = undated
}

interface Lane {
  slug: string
  dots: Dot[]
}

// Age bands: fresh <7d green, aging <30d amber, stale ≥30d red.
function bandColor(age: number | null): string {
  if (age === null) return '#6B7280' // undated
  if (age < 7) return '#34d399'
  if (age < 30) return '#f59e0b'
  return '#ef4444'
}

const DAY_MS = 86_400_000

const LANE_H = 34
const PAD_L = 130 // label gutter
const PAD_R = 24
const DOT_R = 4.5

export default function ProposalAgingPage() {
  const { data, isStale, lastError, lastSuccessAt } = useFreshness<BacklogResponse>('/api/backlog', 60_000)
  const loading = data === null && lastError === null

  // now is read at render; refresh cadence (60s) keeps ages current enough.
  const now = Date.now()

  const { lanes, undated, maxAge, staleCount, oldest } = useMemo(() => {
    const projects = (data?.projects ?? []) as ProjectBacklog[]
    const lanes: Lane[] = []
    const undatedDots: Dot[] = []
    let maxAge = 30
    let staleCount = 0
    let oldest: Dot | null = null

    for (const proj of projects) {
      const dots: Dot[] = []
      for (const item of proj.items) {
        if (item.status !== 'pending') continue
        if (!item.createdAt) {
          undatedDots.push({ title: item.title, slug: proj.slug, ageDays: null })
          continue
        }
        const t = Date.parse(item.createdAt)
        if (Number.isNaN(t)) {
          undatedDots.push({ title: item.title, slug: proj.slug, ageDays: null })
          continue
        }
        const age = Math.max(0, Math.floor((now - t) / DAY_MS))
        const dot: Dot = { title: item.title, slug: proj.slug, ageDays: age }
        dots.push(dot)
        if (age > maxAge) maxAge = age
        if (age >= 30) staleCount++
        if (!oldest || (oldest.ageDays ?? -1) < age) oldest = dot
      }
      if (dots.length > 0) {
        dots.sort((a, b) => (b.ageDays ?? 0) - (a.ageDays ?? 0))
        lanes.push({ slug: proj.slug, dots })
      }
    }
    lanes.sort((a, b) => (b.dots[0]?.ageDays ?? 0) - (a.dots[0]?.ageDays ?? 0))
    return { lanes, undated: undatedDots, maxAge, staleCount, oldest: oldest as Dot | null }
  }, [data, now])

  if (loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center" style={{ background: '#060d1a' }}>
        <div className="text-xs font-mono text-slate-600 animate-pulse">Aging pending proposals…</div>
      </div>
    )
  }

  const totalLanes = lanes.length + (undated.length > 0 ? 1 : 0)
  const VB_W = 800
  const plotW = VB_W - PAD_L - PAD_R
  const ageScale = (age: number) => PAD_L + (age / maxAge) * plotW
  // Beeswarm vertical offset within a lane to reduce overlap.
  const beeY = (laneTop: number, idx: number) => laneTop + LANE_H / 2 + ((idx % 5) - 2) * 5
  const gridDays = [0, 7, 30, Math.round(maxAge)].filter((d, i, a) => a.indexOf(d) === i && d <= maxAge)

  return (
    <div className="min-h-dvh flex flex-col" style={{ background: '#060d1a' }}>
      <header className="sticky top-0 z-30 border-b border-cyber-cyan/12 bg-[#060d1a]/90 backdrop-blur-md px-6 py-3">
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-cyber-cyan/40 to-transparent" />
        <div className="flex items-center gap-3 flex-wrap">
          <Link href="/" className="text-[0.6rem] font-mono text-slate-500 hover:text-cyber-cyan transition-colors uppercase tracking-wider">← Dashboard</Link>
          <h1 className="text-sm font-black tracking-[0.18em] text-cyber-cyan" style={{ fontFamily: 'Orbitron, JetBrains Mono, monospace' }}>
            Proposal Aging Spectrum
          </h1>
          <span className="text-[0.6rem] font-mono text-slate-500 border border-slate-700 px-2 py-0.5 rounded">how long pending proposals have waited</span>
          <FreshnessBadge isStale={isStale} lastError={lastError} lastSuccessAt={lastSuccessAt} />
          <div className="flex-1" />
          <div className="flex items-center gap-2">
            <span className="text-[0.55rem] font-mono text-slate-500 uppercase tracking-wider">stale ≥30d</span>
            <span className="text-lg font-black tabular-nums" style={{ fontFamily: 'Orbitron, monospace', color: staleCount > 0 ? '#ef4444' : '#34d399' }}>{staleCount}</span>
          </div>
          <Link href="/backlog" className="text-[0.6rem] font-mono text-slate-500 hover:text-cyber-cyan transition-colors border border-slate-700 hover:border-cyber-cyan/30 px-2 py-1 rounded">Backlog →</Link>
        </div>
      </header>

      <main className="flex-1 p-6 max-w-5xl mx-auto w-full">
        {oldest && (
          <div className="mb-4 text-[0.6rem] font-mono text-slate-500">
            oldest pending: <span className="text-slate-300">{oldest.title}</span>
            {oldest.ageDays != null && <span style={{ color: bandColor(oldest.ageDays) }}> · {oldest.ageDays}d</span>}
            <span className="text-slate-600"> ({oldest.slug})</span>
          </div>
        )}

        {totalLanes === 0 ? (
          <div className="h-64 flex items-center justify-center text-slate-600 text-xs font-mono">No pending proposals.</div>
        ) : (
          <div className="rounded-xl border border-cyber-cyan/12 p-3" style={{ background: 'rgba(0,245,255,0.02)' }}>
            <svg viewBox={`0 0 ${VB_W} ${totalLanes * LANE_H + 28}`} width="100%">
              {/* gridlines + day labels */}
              {gridDays.map((d) => (
                <g key={d}>
                  <line x1={ageScale(d)} x2={ageScale(d)} y1={0} y2={totalLanes * LANE_H} stroke="#1e293b" strokeWidth={0.6} strokeDasharray="2 3" />
                  <text x={ageScale(d)} y={totalLanes * LANE_H + 16} textAnchor="middle" fontSize={8} fill="#64748b" fontFamily="JetBrains Mono, monospace">{d}d</text>
                </g>
              ))}

              {/* dated lanes */}
              {lanes.map((lane, li) => {
                const top = li * LANE_H
                return (
                  <g key={lane.slug}>
                    {li % 2 === 1 && <rect x={0} y={top} width={VB_W} height={LANE_H} fill="rgba(255,255,255,0.015)" />}
                    <text x={PAD_L - 8} y={top + LANE_H / 2 + 3} textAnchor="end" fontSize={9} fontWeight={700} fill="#cbd5e1" fontFamily="Orbitron, monospace">{lane.slug}</text>
                    {lane.dots.map((dot, di) => (
                      <Link key={di} href="/backlog">
                        <circle cx={ageScale(dot.ageDays!)} cy={beeY(top, di)} r={DOT_R} fill={bandColor(dot.ageDays)} fillOpacity={0.85} stroke="#060d1a" strokeWidth={0.8} className="hover:fill-opacity-100">
                          <title>{dot.title} — {dot.ageDays}d ({dot.slug})</title>
                        </circle>
                      </Link>
                    ))}
                  </g>
                )
              })}

              {/* undated lane */}
              {undated.length > 0 && (() => {
                const top = lanes.length * LANE_H
                return (
                  <g>
                    <rect x={0} y={top} width={VB_W} height={LANE_H} fill="rgba(107,114,128,0.06)" />
                    <text x={PAD_L - 8} y={top + LANE_H / 2 + 3} textAnchor="end" fontSize={9} fontWeight={700} fill="#94a3b8" fontFamily="Orbitron, monospace">undated</text>
                    {undated.map((dot, di) => (
                      <Link key={di} href="/backlog">
                        <circle cx={PAD_L + (di % 30) * 16 + 8} cy={beeY(top, di)} r={DOT_R} fill={bandColor(null)} fillOpacity={0.7} stroke="#060d1a" strokeWidth={0.8}>
                          <title>{dot.title} — undated ({dot.slug})</title>
                        </circle>
                      </Link>
                    ))}
                  </g>
                )
              })()}
            </svg>
          </div>
        )}

        {/* legend */}
        <div className="mt-6 flex items-center gap-4 text-[0.55rem] font-mono text-slate-500 flex-wrap">
          <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded-full" style={{ background: '#34d399' }} />fresh &lt;7d</span>
          <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded-full" style={{ background: '#f59e0b' }} />aging 7–29d</span>
          <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded-full" style={{ background: '#ef4444' }} />stale ≥30d</span>
          <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded-full" style={{ background: '#6B7280' }} />undated</span>
        </div>

        <p className="text-[0.5rem] font-mono text-slate-700 mt-4">
          One dot per pending proposal, positioned on the x-axis by age in days since <code>createdAt</code>; dots grouped into a labeled
          lane per project. Color band: green &lt;7d, amber 7–29d, red ≥30d. Header shows the count of stale (≥30d) proposals and the oldest
          pending item. Proposals without a parseable <code>createdAt</code> appear in a separate &ldquo;undated&rdquo; lane. Reuses
          <code> /api/backlog</code>. Refreshes every 60s.
        </p>
      </main>
    </div>
  )
}
