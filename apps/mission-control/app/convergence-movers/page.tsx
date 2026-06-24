'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import type { ConvergenceMoversResponse, ConvergenceMover } from '../api/convergence-movers/route'
import { useFreshness } from '../../lib/useFreshness'
import FreshnessBadge from '../../components/FreshnessBadge'

function fmtScore(s: number): string {
  return (s / 100).toFixed(2)
}

function MoverRow({ m, sign }: { m: ConvergenceMover; sign: 1 | -1 }) {
  const color = sign > 0 ? '#34d399' : '#ef4444'
  const delta = m.delta ?? 0
  const mag = Math.min(1, Math.abs(delta) / 100)
  return (
    <Link
      href={`/focus/${encodeURIComponent(m.slug)}`}
      className="flex items-center gap-3 px-3 py-2 rounded-lg border border-slate-800 hover:border-cyber-cyan/40 transition-colors"
      style={{ background: 'rgba(255,255,255,0.01)' }}
    >
      <span className="text-[0.7rem] font-mono text-slate-200 flex-1 truncate">{m.slug}</span>
      <span className="text-[0.55rem] font-mono text-slate-500 tabular-nums">
        {m.prev == null ? '—' : fmtScore(m.prev)} → {fmtScore(m.curr)}
      </span>
      {/* delta sparkbar */}
      <div className="w-16 h-1.5 rounded-full bg-slate-800 overflow-hidden">
        <div style={{ width: `${mag * 100}%`, background: color, height: '100%' }} />
      </div>
      <span className="text-[0.7rem] font-black tabular-nums w-14 text-right" style={{ color, fontFamily: 'Orbitron, monospace' }}>
        {sign > 0 ? '+' : '−'}{fmtScore(Math.abs(delta))}
      </span>
    </Link>
  )
}

export default function ConvergenceMoversPage() {
  const { data, isStale, lastError, lastSuccessAt } = useFreshness<ConvergenceMoversResponse>('/api/convergence-movers', 60_000)
  const loading = data === null && lastError === null

  const { climbers, fallers, fresh, netDelta } = useMemo(() => {
    const movers = data?.movers ?? []
    const withDelta = movers.filter((m) => m.delta != null) as Required<ConvergenceMover>[]
    const climbers = withDelta.filter((m) => (m.delta ?? 0) > 0).sort((a, b) => (b.delta ?? 0) - (a.delta ?? 0))
    const fallers = withDelta.filter((m) => (m.delta ?? 0) < 0).sort((a, b) => (a.delta ?? 0) - (b.delta ?? 0))
    const fresh = movers.filter((m) => m.delta == null)
    return { climbers, fallers, fresh, netDelta: data?.netDelta ?? 0 }
  }, [data])

  if (loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center" style={{ background: '#060d1a' }}>
        <div className="text-xs font-mono text-slate-600 animate-pulse">Computing convergence movers…</div>
      </div>
    )
  }

  const total = climbers.length + fallers.length + fresh.length

  return (
    <div className="min-h-dvh flex flex-col" style={{ background: '#060d1a' }}>
      <header className="sticky top-0 z-30 border-b border-cyber-cyan/12 bg-[#060d1a]/90 backdrop-blur-md px-6 py-3">
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-cyber-cyan/40 to-transparent" />
        <div className="flex items-center gap-3 flex-wrap">
          <Link href="/" className="text-[0.6rem] font-mono text-slate-500 hover:text-cyber-cyan transition-colors uppercase tracking-wider">← Dashboard</Link>
          <h1 className="text-sm font-black tracking-[0.18em] text-cyber-cyan" style={{ fontFamily: 'Orbitron, JetBrains Mono, monospace' }}>
            Convergence Movers
          </h1>
          <span className="text-[0.6rem] font-mono text-slate-500 border border-slate-700 px-2 py-0.5 rounded">who moved since yesterday?</span>
          <FreshnessBadge isStale={isStale} lastError={lastError} lastSuccessAt={lastSuccessAt} />
          <div className="flex-1" />
          <div className="flex items-center gap-1.5">
            <span className="text-[0.55rem] font-mono text-slate-500 uppercase tracking-wider">net Δ</span>
            <span className="text-lg font-black tabular-nums" style={{ fontFamily: 'Orbitron, monospace', color: netDelta > 0 ? '#34d399' : netDelta < 0 ? '#ef4444' : '#475569' }}>
              {netDelta > 0 ? '▲' : netDelta < 0 ? '▼' : '·'} {fmtScore(Math.abs(netDelta))}
            </span>
          </div>
        </div>
      </header>

      <main className="flex-1 p-6 max-w-4xl mx-auto w-full">
        {total === 0 ? (
          <div className="h-64 flex items-center justify-center text-slate-600 text-xs font-mono">No convergence history recorded yet.</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <section>
              <h2 className="text-[0.6rem] font-mono uppercase tracking-wider mb-2" style={{ color: '#34d399' }}>▲ Climbers · {climbers.length}</h2>
              <div className="flex flex-col gap-1.5">
                {climbers.length === 0 ? (
                  <span className="text-[0.55rem] font-mono text-slate-600">No projects gained today.</span>
                ) : climbers.map((m) => <MoverRow key={m.slug} m={m} sign={1} />)}
              </div>
            </section>
            <section>
              <h2 className="text-[0.6rem] font-mono uppercase tracking-wider mb-2" style={{ color: '#ef4444' }}>▼ Fallers · {fallers.length}</h2>
              <div className="flex flex-col gap-1.5">
                {fallers.length === 0 ? (
                  <span className="text-[0.55rem] font-mono text-slate-600">No projects fell today.</span>
                ) : fallers.map((m) => <MoverRow key={m.slug} m={m} sign={-1} />)}
              </div>
            </section>
          </div>
        )}

        {fresh.length > 0 && (
          <section className="mt-5">
            <h2 className="text-[0.6rem] font-mono uppercase tracking-wider mb-2 text-slate-500">◦ New (no prior day) · {fresh.length}</h2>
            <div className="flex flex-wrap items-center gap-1.5">
              {fresh.map((m) => (
                <Link key={m.slug} href={`/focus/${encodeURIComponent(m.slug)}`} className="text-[0.55rem] font-mono text-slate-400 border border-slate-800 hover:border-cyber-cyan/40 px-1.5 py-0.5 rounded transition-colors">
                  {m.slug} · {fmtScore(m.curr)}
                </Link>
              ))}
            </div>
          </section>
        )}

        <p className="text-[0.5rem] font-mono text-slate-700 mt-4">
          Day-over-day <code>convergenceScore</code> movement (0.0–1.0) per project, from the latest two
          <code>convergence_history</code> entries. Climbers (green) and Fallers (red) are ranked by delta magnitude;
          each row shows yesterday→today and a delta sparkbar. Projects with only one entry are grouped as New. Header
          shows the net fleet delta. Reuses <code>/api/convergence-movers</code>. Refreshes every 60s.
        </p>
      </main>
    </div>
  )
}
