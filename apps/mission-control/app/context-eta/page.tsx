'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import type { FleetResponse, FleetProject } from '../api/fleet/route'
import { useFreshness } from '../../lib/useFreshness'
import FreshnessBadge from '../../components/FreshnessBadge'

interface Row {
  slug: string
  eta: number // minutes
  usagePct: number
}

// ETA band: red <15m, amber <60m, green otherwise.
function etaColor(mins: number): string {
  if (mins < 15) return '#ef4444'
  if (mins < 60) return '#f59e0b'
  return '#34d399'
}

function fmtEta(mins: number): string {
  if (mins >= 60) return `${(mins / 60).toFixed(1)}h`
  return `${Math.round(mins)}m`
}

const TRACK_W = 100
const TRACK_H = 12

function EtaRow({ r }: { r: Row }) {
  const c = etaColor(r.eta)
  const fillW = Math.min(1, Math.max(0, r.usagePct / 100)) * TRACK_W
  return (
    <Link href={`/focus/${encodeURIComponent(r.slug)}`} className="group block">
      <div className="flex items-center gap-3 py-1.5 px-2 rounded-lg transition-colors group-hover:bg-cyber-cyan/[0.04]">
        <div className="w-32 shrink-0 text-[0.7rem] font-bold text-slate-200 truncate" style={{ fontFamily: 'Orbitron, monospace' }}>{r.slug}</div>
        <div className="flex-1 min-w-0">
          <svg viewBox={`0 0 ${TRACK_W} ${TRACK_H}`} width="100%" height={TRACK_H} preserveAspectRatio="none">
            <rect x={0} y={TRACK_H / 2 - 3} width={TRACK_W} height={6} rx={2} fill="#1e293b" />
            <rect x={0} y={TRACK_H / 2 - 3} width={fillW} height={6} rx={2} fill={c} />
          </svg>
        </div>
        <div className="w-14 shrink-0 text-right text-[0.55rem] font-mono text-slate-500 tabular-nums">{Math.round(r.usagePct)}%</div>
        <div className="w-16 shrink-0 text-right text-[0.75rem] font-black tabular-nums" style={{ fontFamily: 'Orbitron, monospace', color: c }}>{fmtEta(r.eta)}</div>
      </div>
    </Link>
  )
}

export default function ContextEtaPage() {
  const { data, isStale, lastError, lastSuccessAt } = useFreshness<FleetResponse>('/api/fleet', 60_000)
  const loading = data === null && lastError === null

  const { rows, stable } = useMemo(() => {
    const projects = (data?.projects ?? []) as FleetProject[]
    const rows: Row[] = []
    const stable: string[] = []
    for (const p of projects) {
      const eta = p.contextFillEtaMinutes
      if (eta != null && Number.isFinite(eta)) {
        rows.push({ slug: p.slug, eta, usagePct: p.contextUsagePct ?? 0 })
      } else if (p.contextUsagePct != null) {
        // Has a context reading but no finite fill ETA → plenty of headroom.
        stable.push(p.slug)
      }
    }
    rows.sort((a, b) => a.eta - b.eta) // soonest-to-fill first
    return { rows, stable }
  }, [data])

  const soonest = rows[0]

  if (loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center" style={{ background: '#060d1a' }}>
        <div className="text-xs font-mono text-slate-600 animate-pulse">Projecting context fill…</div>
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
            Context Fill ETA Countdown
          </h1>
          <span className="text-[0.6rem] font-mono text-slate-500 border border-slate-700 px-2 py-0.5 rounded">time until each session forces a compaction</span>
          <FreshnessBadge isStale={isStale} lastError={lastError} lastSuccessAt={lastSuccessAt} />
          <div className="flex-1" />
          {soonest && (
            <div className="flex items-center gap-2">
              <span className="text-[0.55rem] font-mono text-slate-500 uppercase tracking-wider">soonest</span>
              <span className="text-xs font-black" style={{ fontFamily: 'Orbitron, monospace', color: etaColor(soonest.eta) }}>{soonest.slug} {fmtEta(soonest.eta)}</span>
            </div>
          )}
        </div>
      </header>

      <main className="flex-1 p-6 max-w-4xl mx-auto w-full">
        {rows.length === 0 ? (
          <div className="h-48 flex items-center justify-center text-slate-600 text-xs font-mono">No projects with a projected context-fill ETA.</div>
        ) : (
          <>
            <div className="rounded-xl border border-cyber-cyan/12 p-3" style={{ background: 'rgba(0,245,255,0.02)' }}>
              {rows.map((r) => <EtaRow key={r.slug} r={r} />)}
            </div>

            <div className="mt-6 flex items-center gap-4 text-[0.55rem] font-mono text-slate-500 flex-wrap">
              <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded-sm" style={{ background: '#ef4444' }} />imminent &lt;15m</span>
              <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded-sm" style={{ background: '#f59e0b' }} />soon &lt;60m</span>
              <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded-sm" style={{ background: '#34d399' }} />distant ≥60m</span>
              <span className="text-slate-600">· bar = current context usage %</span>
            </div>
          </>
        )}

        {stable.length > 0 && (
          <div className="mt-6">
            <div className="text-[0.55rem] font-mono text-slate-600 uppercase tracking-wider mb-2">stable — no projected fill ({stable.length})</div>
            <div className="flex flex-wrap gap-1.5">
              {stable.map((s) => (
                <Link key={s} href={`/focus/${encodeURIComponent(s)}`} className="text-[0.55rem] font-mono text-slate-500 border border-slate-800 hover:border-cyber-cyan/40 px-2 py-0.5 rounded transition-colors">{s}</Link>
              ))}
            </div>
          </div>
        )}

        <p className="text-[0.5rem] font-mono text-slate-700 mt-4">
          One row per project with a finite <code>contextFillEtaMinutes</code>, sorted soonest-first. Bar shows current
          <code>contextUsagePct</code>; the countdown is the projected time until the context window fills and the
          session must compact. ETA &lt;15m flags red, &lt;60m amber. Projects with a context reading but no finite ETA
          are listed as &ldquo;stable.&rdquo; Click a row to open its Focus view. Reuses <code>/api/fleet</code>. Refreshes every 60s.
        </p>
      </main>
    </div>
  )
}
