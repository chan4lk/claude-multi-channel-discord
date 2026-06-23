'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import type { ForecastResponse, ForecastScenario } from '../api/metrics/forecast/route'

const SCENARIO_COLOR: Record<ForecastScenario['name'], string> = {
  pessimistic: '#EF4444',
  expected: '#22D3EE',
  optimistic: '#4ADE80',
}

export default function ForecastPage() {
  const [data, setData] = useState<ForecastResponse | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    function load() {
      fetch('/api/metrics/forecast')
        .then((r) => r.json() as Promise<ForecastResponse>)
        .then((d) => { setData(d); setLoading(false) })
        .catch(() => setLoading(false))
    }
    load()
    const t = setInterval(load, 60_000)
    return () => clearInterval(t)
  }, [])

  const W = 920, H = 420, padL = 40, padR = 16, padT = 20, padB = 30
  const innerW = W - padL - padR
  const innerH = H - padT - padB

  const geom = useMemo(() => {
    if (!data) return null
    const hist = data.history ?? []
    const band = data.band ?? []
    if (hist.length === 0) return null

    const allDates = [...hist.map((p) => p.date), ...band.map((b) => b.date)]
    const minDate = allDates[0]
    const maxDate = allDates[allDates.length - 1]
    const t0 = new Date(minDate + 'T00:00:00Z').getTime()
    const t1 = new Date(maxDate + 'T00:00:00Z').getTime()
    const span = Math.max(1, t1 - t0)

    const maxRemaining = Math.max(
      1,
      ...hist.map((p) => p.remaining),
      ...band.map((b) => b.high),
    )

    const x = (date: string) => padL + ((new Date(date + 'T00:00:00Z').getTime() - t0) / span) * innerW
    const y = (v: number) => padT + innerH - (v / maxRemaining) * innerH

    return { hist, band, x, y, minDate, maxDate, maxRemaining }
  }, [data, innerW, innerH])

  if (loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center" style={{ background: '#060d1a' }}>
        <div className="text-xs font-mono text-slate-600 animate-pulse">Forecasting backlog velocity…</div>
      </div>
    )
  }

  const scenarios = data?.scenarios ?? []

  return (
    <div className="min-h-dvh flex flex-col" style={{ background: '#060d1a' }}>
      <header className="sticky top-0 z-30 border-b border-cyber-cyan/12 bg-[#060d1a]/90 backdrop-blur-md px-6 py-3">
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-cyber-cyan/40 to-transparent" />
        <div className="flex items-center gap-3 flex-wrap">
          <Link href="/" className="text-[0.6rem] font-mono text-slate-500 hover:text-cyber-cyan transition-colors uppercase tracking-wider">← Dashboard</Link>
          <h1 className="text-sm font-black tracking-[0.18em] text-cyber-cyan" style={{ fontFamily: 'Orbitron, JetBrains Mono, monospace' }}>
            Backlog Velocity Forecast
          </h1>
          <span className="text-[0.6rem] font-mono text-slate-500 border border-slate-700 px-2 py-0.5 rounded">3-scenario fan chart</span>
          <div className="flex-1" />
          <Link href="/burndown" className="text-[0.6rem] font-mono text-slate-500 hover:text-cyber-cyan transition-colors border border-slate-700 hover:border-cyber-cyan/30 px-2 py-1 rounded">Burndown →</Link>
        </div>
      </header>

      <main className="flex-1 p-6 max-w-5xl mx-auto w-full">
        {/* summary cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          {scenarios.map((s) => (
            <div key={s.name} className="rounded-lg border p-3" style={{ borderColor: `${SCENARIO_COLOR[s.name]}33`, background: `${SCENARIO_COLOR[s.name]}08` }}>
              <div className="text-[0.55rem] font-mono uppercase tracking-wider" style={{ color: SCENARIO_COLOR[s.name] }}>{s.name}</div>
              <div className="text-sm font-mono text-slate-100 mt-1">{s.projectedDone ?? '—'}</div>
              <div className="text-[0.55rem] font-mono text-slate-500 mt-0.5">{s.rate}/day</div>
            </div>
          ))}
          <div className="rounded-lg border p-3" style={{ borderColor: '#A78BFA33', background: '#A78BFA08' }}>
            <div className="text-[0.55rem] font-mono uppercase tracking-wider text-cyber-purple" style={{ color: '#A78BFA' }}>velocity</div>
            <div className="text-sm font-mono text-slate-100 mt-1">{data?.velocityPerWeek ?? 0}/wk</div>
            <div className="text-[0.55rem] font-mono text-slate-500 mt-0.5">{data?.remaining ?? 0} remaining</div>
          </div>
        </div>

        {!geom ? (
          <div className="h-64 flex items-center justify-center text-slate-600 text-xs font-mono">Not enough history to forecast.</div>
        ) : (
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full rounded-lg border border-cyber-cyan/10" style={{ background: 'rgba(0,245,255,0.015)' }}>
            {/* y gridlines */}
            {[0, 0.25, 0.5, 0.75, 1].map((f) => {
              const yy = padT + innerH - f * innerH
              return (
                <g key={f}>
                  <line x1={padL} y1={yy} x2={W - padR} y2={yy} stroke="#1e293b" strokeWidth={0.5} />
                  <text x={padL - 6} y={yy + 3} textAnchor="end" fontSize={8} fill="#475569" fontFamily="JetBrains Mono, monospace">{Math.round(f * geom.maxRemaining)}</text>
                </g>
              )
            })}

            {/* forecast band (pessimistic high ↔ optimistic low) */}
            {geom.band.length > 1 && (
              <path
                d={`${geom.band.map((b, i) => `${i === 0 ? 'M' : 'L'} ${geom.x(b.date).toFixed(1)} ${geom.y(b.high).toFixed(1)}`).join(' ')} ${[...geom.band].reverse().map((b) => `L ${geom.x(b.date).toFixed(1)} ${geom.y(b.low).toFixed(1)}`).join(' ')} Z`}
                fill="#22D3EE14" stroke="none"
              />
            )}

            {/* scenario rays: from today's remaining down to zero at projected date */}
            {(() => {
              const last = geom.hist[geom.hist.length - 1]
              const startX = geom.x(last.date), startY = geom.y(last.remaining)
              return scenarios.map((s) => {
                if (!s.projectedDone || s.rate <= 0) return null
                const ex = geom.x(s.projectedDone), ey = geom.y(0)
                const c = SCENARIO_COLOR[s.name]
                return <line key={s.name} x1={startX} y1={startY} x2={ex} y2={ey} stroke={c} strokeWidth={1.5} strokeDasharray="5 4" strokeOpacity={0.85} />
              })
            })()}

            {/* historical remaining line */}
            <path
              d={geom.hist.map((p, i) => `${i === 0 ? 'M' : 'L'} ${geom.x(p.date).toFixed(1)} ${geom.y(p.remaining).toFixed(1)}`).join(' ')}
              fill="none" stroke="#22D3EE" strokeWidth={2}
            />
            {/* "today" marker */}
            {(() => {
              const last = geom.hist[geom.hist.length - 1]
              return <circle cx={geom.x(last.date)} cy={geom.y(last.remaining)} r={3} fill="#22D3EE" />
            })()}

            {/* x date ticks */}
            <text x={padL} y={H - 8} textAnchor="start" fontSize={8} fill="#475569" fontFamily="JetBrains Mono, monospace">{geom.minDate.slice(5)}</text>
            <text x={W - padR} y={H - 8} textAnchor="end" fontSize={8} fill="#475569" fontFamily="JetBrains Mono, monospace">{geom.maxDate.slice(5)}</text>
          </svg>
        )}

        {/* legend */}
        <div className="mt-3 flex flex-wrap gap-3">
          <span className="flex items-center gap-1.5 text-[0.6rem] font-mono text-slate-400"><span style={{ width: 16, height: 2, background: '#22D3EE', display: 'inline-block' }} /> historical remaining</span>
          {scenarios.map((s) => (
            <span key={s.name} className="flex items-center gap-1.5 text-[0.6rem] font-mono text-slate-400">
              <span style={{ width: 16, height: 0, borderTop: `2px dashed ${SCENARIO_COLOR[s.name]}`, display: 'inline-block' }} /> {s.name}
            </span>
          ))}
        </div>

        <p className="text-[0.5rem] font-mono text-slate-700 mt-4">
          Historical remaining (solid) continues into three forward rays. Pessimistic = slowest historical 7-day completion rate; optimistic = fastest; expected = trailing 14-day mean.
          Shaded band spans pessimistic↔optimistic remaining over time. Reuses the burndown series. Refreshes every 60s.
        </p>
      </main>
    </div>
  )
}
