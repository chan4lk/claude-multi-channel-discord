'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import * as d3 from 'd3'
import type { AttentionClockResponse, ClockCell } from '../api/attention-clock/route'
import { useFreshness } from '../../lib/useFreshness'
import FreshnessBadge from '../../components/FreshnessBadge'
import SubPageHeader from '../../components/SubPageHeader'

const SEV_COLOR: Record<string, string> = {
  critical: '#ef4444',
  warn: '#fbbf24',
  info: '#00F5FF',
  ok: '#334155',
}

const SIZE = 560
const CENTER = SIZE / 2
const INNER = 70 // inner hole radius
const OUTER = 250 // outer ring radius
const HOUR_ANGLE = (2 * Math.PI) / 24

interface WedgeHover {
  hour: number
  signal: string
  cell: ClockCell
}

export default function AttentionClockPage() {
  const { data, isStale, lastError, lastSuccessAt } = useFreshness<AttentionClockResponse>('/api/attention-clock', 60_000)
  const loading = data === null && lastError === null
  const [hover, setHover] = useState<WedgeHover | null>(null)

  const { hours, signals, max, total, peakHour } = useMemo(() => ({
    hours: data?.hours ?? [],
    signals: (data?.signals ?? []).slice(0, 8), // top 8 signals get rings
    max: data?.max ?? 0,
    total: data?.total ?? 0,
    peakHour: data?.peakHour ?? null,
  }), [data])

  // Ring band per signal (innermost = most frequent).
  const ringBand = useMemo(() => {
    const n = Math.max(1, signals.length)
    const band = (OUTER - INNER) / n
    return signals.map((sig, i) => ({ signal: sig, r0: INNER + i * band, r1: INNER + (i + 1) * band }))
  }, [signals])

  const arc = useMemo(() => d3.arc<{ r0: number; r1: number; a0: number; a1: number }>()
    .innerRadius((d) => d.r0)
    .outerRadius((d) => d.r1)
    .startAngle((d) => d.a0)
    .endAngle((d) => d.a1)
    .padAngle(0.012)
    .cornerRadius(1), [])

  const wedges = useMemo(() => {
    const out: Array<{ key: string; path: string; fill: string; opacity: number; hour: number; signal: string; cell: ClockCell }> = []
    for (const band of ringBand) {
      for (let h = 0; h < 24; h++) {
        const cell = hours[h]?.cells[band.signal]
        // Angle: hour 0 at top (12 o'clock), clockwise.
        const a0 = h * HOUR_ANGLE
        const a1 = (h + 1) * HOUR_ANGLE
        const path = arc({ r0: band.r0, r1: band.r1, a0, a1 }) ?? ''
        const count = cell?.count ?? 0
        const sev = cell?.severity ?? 'ok'
        const opacity = count > 0 ? 0.22 + (max > 0 ? (count / max) * 0.78 : 0.5) : 0.05
        out.push({
          key: `${band.signal}:${h}`,
          path,
          fill: SEV_COLOR[sev] ?? SEV_COLOR.ok,
          opacity,
          hour: h,
          signal: band.signal,
          cell: cell ?? { signal: band.signal, count: 0, severity: 'ok', slugs: [] },
        })
      }
    }
    return out
  }, [ringBand, hours, arc, max])

  // Hour tick labels around the dial (every 3h).
  const hourTicks = useMemo(() => {
    return [0, 3, 6, 9, 12, 15, 18, 21].map((h) => {
      const ang = (h + 0.5) * HOUR_ANGLE - Math.PI / 2
      const r = OUTER + 16
      return { h, x: CENTER + Math.cos(ang) * r, y: CENTER + Math.sin(ang) * r }
    })
  }, [])

  if (loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center" style={{ background: '#060d1a' }}>
        <div className="text-xs font-mono text-slate-600 animate-pulse">Loading attention clock…</div>
      </div>
    )
  }

  const empty = total === 0

  return (
    <div className="min-h-dvh flex flex-col" style={{ background: '#060d1a' }}>
      <SubPageHeader title="Attention Radial Clock">
        <span className="text-[0.6rem] font-mono text-slate-500 border border-slate-700 px-2 py-0.5 rounded hidden sm:inline">when does the fleet need attention?</span>
        <FreshnessBadge isStale={isStale} lastError={lastError} lastSuccessAt={lastSuccessAt} />
        <div className="flex items-center gap-1.5">
          <span className="text-[0.55rem] font-mono text-slate-500 uppercase tracking-wider">peak</span>
          <span className="text-xs font-black tabular-nums" style={{ fontFamily: 'Orbitron, monospace', color: peakHour !== null ? '#A78BFA' : '#475569' }}>
            {peakHour !== null ? `${String(peakHour).padStart(2, '0')}:00` : '—'}
          </span>
        </div>
      </SubPageHeader>

      <main className="flex-1 p-6 max-w-6xl mx-auto w-full flex flex-col">
        {empty ? (
          <div className="flex-1 min-h-[24rem] flex flex-col items-center justify-center gap-2 text-center px-6">
            <div className="text-4xl opacity-20">◷</div>
            <p className="text-xs text-slate-600 font-mono">
              No <code>attention_event</code> history yet. Findings are recorded each time the Fleet Brief computes — open
              <Link href="/brief" className="text-cyber-cyan underline mx-1">Fleet Brief</Link> to start populating the clock.
            </p>
          </div>
        ) : (
          <div className="flex flex-col lg:flex-row gap-6 items-center lg:items-start justify-center">
            {/* The dial */}
            <div className="relative shrink-0" style={{ width: SIZE, maxWidth: '100%' }}>
              <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="w-full h-auto" onMouseLeave={() => setHover(null)}>
                <defs>
                  <filter id="clock-glow" x="-50%" y="-50%" width="200%" height="200%">
                    <feGaussianBlur stdDeviation="2.5" result="blur" />
                    <feMerge>
                      <feMergeNode in="blur" />
                      <feMergeNode in="SourceGraphic" />
                    </feMerge>
                  </filter>
                </defs>

                {/* rotate so hour 0 sits at top (12 o'clock) */}
                <g transform={`rotate(-90 ${CENTER} ${CENTER})`}>
                  <g transform={`translate(${CENTER} ${CENTER})`}>
                    {wedges.map((w) => (
                      <path
                        key={w.key}
                        d={w.path}
                        fill={w.fill}
                        fillOpacity={w.opacity}
                        stroke={hover?.hour === w.hour && hover?.signal === w.signal ? '#fff' : 'none'}
                        strokeWidth={1}
                        style={{ cursor: w.cell.count > 0 ? 'pointer' : 'default', filter: w.cell.count > 0 ? 'url(#clock-glow)' : undefined }}
                        onMouseEnter={() => w.cell.count > 0 && setHover({ hour: w.hour, signal: w.signal, cell: w.cell })}
                      />
                    ))}
                  </g>
                </g>

                {/* hour tick labels (unrotated) */}
                {hourTicks.map((t) => (
                  <text key={t.h} x={t.x} y={t.y} textAnchor="middle" dominantBaseline="middle"
                    fill="#64748b" fontSize={10} fontFamily="JetBrains Mono, monospace">
                    {String(t.h).padStart(2, '0')}
                  </text>
                ))}

                {/* center readout */}
                <text x={CENTER} y={CENTER - 8} textAnchor="middle" fill="#A78BFA" fontSize={22} fontWeight="bold"
                  fontFamily="Orbitron, monospace">{total}</text>
                <text x={CENTER} y={CENTER + 12} textAnchor="middle" fill="#64748b" fontSize={9}
                  fontFamily="JetBrains Mono, monospace" letterSpacing="0.1em">SIGNALS / {data?.windowDays ?? 30}d</text>
              </svg>
            </div>

            {/* legend + signal rings */}
            <div className="w-full lg:w-72 flex flex-col gap-4">
              <div className="rounded-lg border border-white/8 bg-cyber-surface/40 p-3">
                <div className="text-[0.6rem] font-mono text-slate-500 uppercase tracking-wider mb-2">Signal rings (inner → outer)</div>
                <div className="flex flex-col gap-1.5">
                  {ringBand.map((b, i) => (
                    <div key={b.signal} className="flex items-center gap-2 text-[0.65rem] font-mono">
                      <span className="text-slate-600 w-4 text-right">{i + 1}</span>
                      <span className="text-slate-300 truncate">{b.signal}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-lg border border-white/8 bg-cyber-surface/40 p-3">
                <div className="text-[0.6rem] font-mono text-slate-500 uppercase tracking-wider mb-2">Severity</div>
                <div className="flex flex-col gap-1.5">
                  {(['critical', 'warn', 'info'] as const).map((s) => (
                    <div key={s} className="flex items-center gap-2 text-[0.65rem] font-mono">
                      <span className="w-3 h-3 rounded-sm" style={{ background: SEV_COLOR[s] }} />
                      <span className="text-slate-400">{s}</span>
                    </div>
                  ))}
                </div>
              </div>

              {hover && (
                <div className="rounded-lg border border-white/10 bg-cyber-surface/95 backdrop-blur-md p-3 shadow-xl"
                  style={{ boxShadow: `0 0 20px ${SEV_COLOR[hover.cell.severity] ?? SEV_COLOR.ok}30` }}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="px-1.5 py-0.5 rounded text-[0.6rem] font-mono font-bold uppercase tracking-wider"
                      style={{ color: SEV_COLOR[hover.cell.severity] ?? SEV_COLOR.ok, border: `1px solid ${(SEV_COLOR[hover.cell.severity] ?? SEV_COLOR.ok)}40` }}>
                      {hover.signal}
                    </span>
                    <span className="text-[0.6rem] font-mono text-slate-400 tabular-nums">{String(hover.hour).padStart(2, '0')}:00–{String((hover.hour + 1) % 24).padStart(2, '0')}:00 UTC</span>
                  </div>
                  <div className="text-[0.6rem] font-mono text-slate-500 mb-2">
                    {hover.cell.count} project{hover.cell.count === 1 ? '' : 's'} firing
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {hover.cell.slugs.map((slug) => (
                      <Link key={slug} href={`/brief?slug=${encodeURIComponent(slug)}`}
                        className="text-[0.55rem] font-mono text-slate-400 border border-slate-800 px-1.5 py-0.5 rounded hover:text-cyber-cyan hover:border-cyber-cyan/40 transition-colors">
                        {slug}
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        <p className="text-[0.5rem] font-mono text-slate-700 mt-6 max-w-3xl">
          Circadian view of fleet attention (P214). 24 spokes = hour-of-day (UTC, 00 at top, clockwise);
          concentric rings = the top 8 attention signals (innermost = most frequent). Each wedge is one
          (signal, hour) cell — color = worst severity reached, brightness ∝ distinct projects firing.
          Built from the <code>attention_event</code> table (P209), bucketed by each row&apos;s last-recorded hour.
          Hover a lit wedge to list the affected projects. Refreshes every 60s.
        </p>
      </main>
    </div>
  )
}
