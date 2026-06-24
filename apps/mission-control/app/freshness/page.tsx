'use client'

import Link from 'next/link'
import type { FreshnessResponse, FeedRow, FeedStatus } from '../api/freshness/route'
import { useFreshness } from '../../lib/useFreshness'
import FreshnessBadge from '../../components/FreshnessBadge'

const STATUS_COLOR: Record<FeedStatus, string> = {
  healthy: '#34d399',
  late: '#f59e0b',
  silent: '#ef4444',
}

function relAge(sec: number | null): string {
  if (sec == null) return 'never'
  if (sec < 60) return `${sec}s ago`
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`
  return `${Math.floor(sec / 86400)}d ago`
}

function cadenceLabel(sec: number): string {
  if (sec % 86400 === 0) return `${sec / 86400}d`
  return `${Math.round(sec / 3600)}h`
}

function Row({ f }: { f: FeedRow }) {
  const color = STATUS_COLOR[f.status]
  const pulse = f.status === 'silent' || f.status === 'late'
  return (
    <div className="flex items-center gap-4 px-4 py-3 border-b border-slate-800/60 hover:bg-[#0a1424]/40 transition-colors">
      <span className="relative flex h-2.5 w-2.5 shrink-0">
        {pulse && <span className="absolute inline-flex h-full w-full rounded-full opacity-60 animate-ping" style={{ background: color }} />}
        <span className="relative inline-flex rounded-full h-2.5 w-2.5" style={{ background: color }} />
      </span>
      <span className="w-44 shrink-0 text-xs font-bold text-slate-200">{f.label}</span>
      <span className="w-32 shrink-0 text-[0.6rem] font-mono text-slate-500">{f.feed}</span>
      <span className="w-24 shrink-0 text-[0.7rem] font-mono tabular-nums text-right" style={{ color }}>{relAge(f.ageSec)}</span>
      <span className="w-20 shrink-0 text-[0.6rem] font-mono text-slate-500 text-right">≤{cadenceLabel(f.cadenceSec)}</span>
      <div className="flex-1" />
      <span className="text-[0.65rem] font-mono tabular-nums text-slate-400">
        <span className="text-slate-200 font-bold">{f.count24h}</span> <span className="text-slate-600">/24h</span>
      </span>
      <span className="w-14 shrink-0 text-[0.5rem] font-mono uppercase tracking-wider text-right" style={{ color }}>{f.status}</span>
    </div>
  )
}

export default function FreshnessPage() {
  const { data, isStale, lastError, lastSuccessAt } = useFreshness<FreshnessResponse>('/api/freshness', 60_000)
  const loading = data === null && lastError === null

  if (loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center" style={{ background: '#060d1a' }}>
        <div className="text-xs font-mono text-slate-600 animate-pulse">Probing data feeds…</div>
      </div>
    )
  }

  const feeds = data?.feeds ?? []
  const healthy = data?.healthy ?? 0
  const late = data?.late ?? 0
  const silent = data?.silent ?? 0

  return (
    <div className="min-h-dvh flex flex-col" style={{ background: '#060d1a' }}>
      <header className="sticky top-0 z-30 border-b border-cyber-cyan/12 bg-[#060d1a]/90 backdrop-blur-md px-6 py-3">
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-cyber-cyan/40 to-transparent" />
        <div className="flex items-center gap-3 flex-wrap">
          <Link href="/" className="text-[0.6rem] font-mono text-slate-500 hover:text-cyber-cyan transition-colors uppercase tracking-wider">← Dashboard</Link>
          <h1 className="text-sm font-black tracking-[0.18em] text-cyber-cyan" style={{ fontFamily: 'Orbitron, JetBrains Mono, monospace' }}>
            Feed Freshness Wall
          </h1>
          <span className="text-[0.6rem] font-mono text-slate-500 border border-slate-700 px-2 py-0.5 rounded">data-plane health</span>
          <FreshnessBadge isStale={isStale} lastError={lastError} lastSuccessAt={lastSuccessAt} />
          <div className="flex-1" />
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5">
              <span className="text-[0.55rem] font-mono uppercase tracking-wider" style={{ color: STATUS_COLOR.healthy }}>healthy</span>
              <span className="text-lg font-black tabular-nums" style={{ fontFamily: 'Orbitron, monospace', color: STATUS_COLOR.healthy }}>{healthy}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[0.55rem] font-mono uppercase tracking-wider" style={{ color: STATUS_COLOR.late }}>late</span>
              <span className="text-lg font-black tabular-nums" style={{ fontFamily: 'Orbitron, monospace', color: late > 0 ? STATUS_COLOR.late : '#475569' }}>{late}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[0.55rem] font-mono uppercase tracking-wider" style={{ color: STATUS_COLOR.silent }}>silent</span>
              <span className="text-lg font-black tabular-nums" style={{ fontFamily: 'Orbitron, monospace', color: silent > 0 ? STATUS_COLOR.silent : '#475569' }}>{silent}</span>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 p-6 w-full">
        {feeds.length === 0 ? (
          <div className="h-64 flex items-center justify-center text-slate-600 text-xs font-mono">No feeds to probe.</div>
        ) : (
          <div className="rounded-lg border border-cyber-cyan/10 bg-[#0a1424]/30 overflow-hidden max-w-4xl">
            {feeds.map((f) => <Row key={f.feed} f={f} />)}
          </div>
        )}

        <p className="text-[0.5rem] font-mono text-slate-700 mt-6 max-w-3xl">
          Fleet-wide data-plane health. Probes the key data-producing tables for newest-row timestamp and 24h row count,
          comparing each feed's age against an expected cadence: <span style={{ color: STATUS_COLOR.healthy }}>healthy</span>{' '}
          (fresh within cadence), <span style={{ color: STATUS_COLOR.late }}>late</span> (overdue), {' '}
          <span style={{ color: STATUS_COLOR.silent }}>silent</span> (never populated). Sorted most-stale-first so dead
          pipelines surface at the top. Reuses <code>/api/freshness</code>. Refreshes every 60s.
        </p>
      </main>
    </div>
  )
}
