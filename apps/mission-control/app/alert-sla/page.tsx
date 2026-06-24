'use client'

import Link from 'next/link'
import type { AlertSlaResponse, AlertSlaType } from '../api/alert-sla/route'
import { useFreshness } from '../../lib/useFreshness'
import FreshnessBadge from '../../components/FreshnessBadge'

// Latency thresholds: green < 1h / amber < 6h / red beyond.
function latColor(sec: number | null): string {
  if (sec == null) return '#475569'
  if (sec < 3600) return '#34d399'
  if (sec < 6 * 3600) return '#f59e0b'
  return '#ef4444'
}

function dur(sec: number | null): string {
  if (sec == null) return '—'
  if (sec < 60) return `${Math.round(sec)}s`
  if (sec < 3600) return `${Math.round(sec / 60)}m`
  if (sec < 86400) return `${(sec / 3600).toFixed(1)}h`
  return `${(sec / 86400).toFixed(1)}d`
}

function rateColor(rate: number): string {
  if (rate >= 90) return '#34d399'
  if (rate >= 50) return '#f59e0b'
  return '#ef4444'
}

function Chip({ label, sec }: { label: string; sec: number | null }) {
  const c = latColor(sec)
  return (
    <span className="inline-flex items-center gap-1 text-[0.6rem] font-mono px-2 py-0.5 rounded tabular-nums" style={{ background: `${c}18`, color: c, border: `1px solid ${c}40` }}>
      <span className="text-slate-500">{label}</span>{dur(sec)}
    </span>
  )
}

function Row({ t }: { t: AlertSlaType }) {
  const rc = rateColor(t.ackRate)
  return (
    <div className="flex items-center gap-4 px-4 py-3 border-b border-slate-800/60 hover:bg-[#0a1424]/40 transition-colors flex-wrap">
      <span className="w-24 shrink-0 text-xs font-bold text-slate-200">{t.alert_type}</span>
      <span className="w-20 shrink-0 text-[0.6rem] font-mono tabular-nums text-slate-400">{t.count} total</span>
      <div className="w-28 shrink-0 flex items-center gap-2">
        <div className="flex-1 h-1.5 rounded-full bg-slate-800 overflow-hidden">
          <div className="h-full rounded-full" style={{ width: `${t.ackRate}%`, background: rc }} />
        </div>
        <span className="text-[0.6rem] font-mono tabular-nums" style={{ color: rc }}>{Math.round(t.ackRate)}%</span>
      </div>
      <div className="flex items-center gap-1.5">
        <Chip label="med " sec={t.medianSec} />
        <Chip label="p90 " sec={t.p90Sec} />
      </div>
      <div className="flex-1" />
      {t.openBacklog > 0 ? (
        <span className="text-[0.6rem] font-mono px-2 py-0.5 rounded tabular-nums" style={{ background: '#ef444418', color: '#f87171', border: '1px solid #ef444440' }} title={`oldest open ${dur(t.oldestOpenSec)}`}>
          {t.openBacklog} open · {dur(t.oldestOpenSec)} oldest
        </span>
      ) : (
        <span className="text-[0.6rem] font-mono text-emerald-500/70">all clear</span>
      )}
    </div>
  )
}

export default function AlertSlaPage() {
  const { data, isStale, lastError, lastSuccessAt } = useFreshness<AlertSlaResponse>('/api/alert-sla', 60_000)
  const loading = data === null && lastError === null

  if (loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center" style={{ background: '#060d1a' }}>
        <div className="text-xs font-mono text-slate-600 animate-pulse">Loading alert SLA…</div>
      </div>
    )
  }

  const types = data?.types ?? []
  const fleetMedian = data?.fleetMedianSec ?? null
  const totalOpen = data?.totalOpen ?? 0
  const total = data?.total ?? 0

  return (
    <div className="min-h-dvh flex flex-col" style={{ background: '#060d1a' }}>
      <header className="sticky top-0 z-30 border-b border-cyber-cyan/12 bg-[#060d1a]/90 backdrop-blur-md px-6 py-3">
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-cyber-cyan/40 to-transparent" />
        <div className="flex items-center gap-3 flex-wrap">
          <Link href="/" className="text-[0.6rem] font-mono text-slate-500 hover:text-cyber-cyan transition-colors uppercase tracking-wider">← Dashboard</Link>
          <h1 className="text-sm font-black tracking-[0.18em] text-cyber-cyan" style={{ fontFamily: 'Orbitron, JetBrains Mono, monospace' }}>
            Alert Response Time
          </h1>
          <span className="text-[0.6rem] font-mono text-slate-500 border border-slate-700 px-2 py-0.5 rounded">triage SLA · {data?.windowDays ?? 30}d</span>
          <FreshnessBadge isStale={isStale} lastError={lastError} lastSuccessAt={lastSuccessAt} />
          <div className="flex-1" />
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5">
              <span className="text-[0.55rem] font-mono text-slate-500 uppercase tracking-wider">median ack</span>
              <span className="text-lg font-black tabular-nums" style={{ fontFamily: 'Orbitron, monospace', color: latColor(fleetMedian) }}>{dur(fleetMedian)}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[0.55rem] font-mono text-slate-500 uppercase tracking-wider">open</span>
              <span className="text-lg font-black tabular-nums" style={{ fontFamily: 'Orbitron, monospace', color: totalOpen > 0 ? '#ef4444' : '#34d399' }}>{totalOpen}</span>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 p-6 w-full">
        {total === 0 ? (
          <div className="h-64 flex items-center justify-center text-slate-600 text-xs font-mono">No alert events in the last {data?.windowDays ?? 30} days.</div>
        ) : (
          <div className="rounded-lg border border-cyber-cyan/10 bg-[#0a1424]/30 overflow-hidden max-w-4xl">
            {types.map((t) => <Row key={t.alert_type} t={t} />)}
          </div>
        )}

        <p className="text-[0.5rem] font-mono text-slate-700 mt-6 max-w-3xl">
          Triage SLA on the alert pipeline. Over the last {data?.windowDays ?? 30} days, computes time-to-acknowledge
          (<code>ack_ts − ts</code>, from P196) per alert type: ack-rate gauge, median + p90 latency chips (green &lt;1h /
          amber &lt;6h / red beyond), and current open backlog with oldest-open age. Rows sorted by largest open backlog
          first. Reuses <code>/api/alert-sla</code>. Refreshes every 60s.
        </p>
      </main>
    </div>
  )
}
