'use client'

import Link from 'next/link'
import type { WebhookHealthResponse, WebhookHealthCard } from '../api/webhook-health/route'
import { useFreshness } from '../../lib/useFreshness'
import FreshnessBadge from '../../components/FreshnessBadge'

// Success-rate → color. green ≥99 / amber ≥90 / red below.
function rateColor(rate: number, hasTraffic: boolean): string {
  if (!hasTraffic) return '#64748b'
  if (rate >= 99) return '#34d399'
  if (rate >= 90) return '#f59e0b'
  return '#ef4444'
}

function relTime(ts: number | null): string {
  if (ts == null) return '—'
  const sec = Math.floor(Date.now() / 1000) - ts
  if (sec < 60) return `${sec}s ago`
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`
  return `${Math.floor(sec / 86400)}d ago`
}

function Spark({ daily, color }: { daily: number[]; color: string }) {
  const max = Math.max(1, ...daily)
  const W = 120
  const H = 24
  const bw = W / daily.length
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="block" preserveAspectRatio="none">
      {daily.map((v, i) => {
        const h = (v / max) * (H - 2)
        return <rect key={i} x={i * bw + 0.5} y={H - h} width={Math.max(1, bw - 1)} height={h} fill={color} fillOpacity={0.55} rx={1} />
      })}
    </svg>
  )
}

function Gauge({ rate, color, hasTraffic }: { rate: number; color: string; hasTraffic: boolean }) {
  const R = 26
  const C = 2 * Math.PI * R
  const frac = hasTraffic ? rate / 100 : 0
  return (
    <div className="relative w-16 h-16 shrink-0">
      <svg width={64} height={64} viewBox="0 0 64 64" className="-rotate-90">
        <circle cx={32} cy={32} r={R} fill="none" stroke="#1e293b" strokeWidth={5} />
        <circle cx={32} cy={32} r={R} fill="none" stroke={color} strokeWidth={5} strokeLinecap="round"
          strokeDasharray={`${C * frac} ${C}`} style={{ transition: 'stroke-dasharray 0.4s' }} />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-[0.7rem] font-black tabular-nums" style={{ fontFamily: 'Orbitron, monospace', color }}>
          {hasTraffic ? `${Math.round(rate)}%` : '—'}
        </span>
      </div>
    </div>
  )
}

function Card({ c }: { c: WebhookHealthCard }) {
  const hasTraffic = c.total > 0
  const color = rateColor(c.successRate, hasTraffic)
  return (
    <div className="rounded-lg border border-cyber-cyan/10 bg-[#0a1424]/50 p-4 flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <Gauge rate={c.successRate} color={color} hasTraffic={hasTraffic} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-slate-200 truncate">{c.name}</span>
            {!c.enabled && <span className="text-[0.5rem] font-mono text-slate-500 border border-slate-700 px-1 rounded">disabled</span>}
          </div>
          <div className="text-[0.55rem] font-mono text-slate-600 truncate">{c.url}</div>
          <div className="mt-1 flex items-center gap-3 text-[0.6rem] font-mono tabular-nums">
            <span className="text-slate-400">{c.total} sent</span>
            <span style={{ color: c.failed > 0 ? '#ef4444' : '#475569' }}>{c.failed} failed</span>
          </div>
        </div>
      </div>

      <Spark daily={c.daily} color={color} />

      {c.codes.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {c.codes.map((cd) => {
            const ok = cd.code.startsWith('2')
            return (
              <span key={cd.code} className="text-[0.5rem] font-mono px-1.5 py-0.5 rounded tabular-nums"
                style={{ background: ok ? '#0f2e22' : '#2e1414', color: ok ? '#34d399' : '#f87171' }}>
                {cd.code}·{cd.count}
              </span>
            )
          })}
        </div>
      )}

      {c.lastError && (
        <div className="text-[0.55rem] font-mono text-red-400/80 truncate" title={c.lastError}>
          ⚠ {relTime(c.lastFailureTs)}: {c.lastError}
        </div>
      )}
    </div>
  )
}

export default function WebhookHealthPage() {
  const { data, isStale, lastError, lastSuccessAt } = useFreshness<WebhookHealthResponse>('/api/webhook-health', 60_000)
  const loading = data === null && lastError === null

  if (loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center" style={{ background: '#060d1a' }}>
        <div className="text-xs font-mono text-slate-600 animate-pulse">Loading webhook health…</div>
      </div>
    )
  }

  const cards = data?.cards ?? []
  const overallRate = data?.overallRate ?? 100
  const degraded = data?.degraded ?? 0
  const total = data?.totalDeliveries ?? 0

  return (
    <div className="min-h-dvh flex flex-col" style={{ background: '#060d1a' }}>
      <header className="sticky top-0 z-30 border-b border-cyber-cyan/12 bg-[#060d1a]/90 backdrop-blur-md px-6 py-3">
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-cyber-cyan/40 to-transparent" />
        <div className="flex items-center gap-3 flex-wrap">
          <Link href="/" className="text-[0.6rem] font-mono text-slate-500 hover:text-cyber-cyan transition-colors uppercase tracking-wider">← Dashboard</Link>
          <h1 className="text-sm font-black tracking-[0.18em] text-cyber-cyan" style={{ fontFamily: 'Orbitron, JetBrains Mono, monospace' }}>
            Webhook Delivery Health
          </h1>
          <span className="text-[0.6rem] font-mono text-slate-500 border border-slate-700 px-2 py-0.5 rounded">outbound alert pipeline · {data?.windowDays ?? 7}d</span>
          <FreshnessBadge isStale={isStale} lastError={lastError} lastSuccessAt={lastSuccessAt} />
          <div className="flex-1" />
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5">
              <span className="text-[0.55rem] font-mono text-slate-500 uppercase tracking-wider">success</span>
              <span className="text-lg font-black tabular-nums" style={{ fontFamily: 'Orbitron, monospace', color: overallRate >= 99 ? '#34d399' : overallRate >= 90 ? '#f59e0b' : '#ef4444' }}>
                {total === 0 ? '—' : `${Math.round(overallRate)}%`}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[0.55rem] font-mono text-slate-500 uppercase tracking-wider">degraded</span>
              <span className="text-lg font-black tabular-nums" style={{ fontFamily: 'Orbitron, monospace', color: degraded > 0 ? '#ef4444' : '#34d399' }}>
                {degraded}
              </span>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 p-6 w-full">
        {cards.length === 0 ? (
          <div className="h-64 flex items-center justify-center text-slate-600 text-xs font-mono">No webhooks configured.</div>
        ) : total === 0 ? (
          <div className="h-64 flex items-center justify-center text-slate-600 text-xs font-mono">No deliveries recorded in the last {data?.windowDays ?? 7} days.</div>
        ) : (
          <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
            {cards.map((c) => <Card key={c.id} c={c} />)}
          </div>
        )}

        <p className="text-[0.5rem] font-mono text-slate-700 mt-6 max-w-3xl">
          Fleet-wide reliability of the outbound alert pipeline. Aggregates <code>webhook_deliveries</code> over the last
          {' '}{data?.windowDays ?? 7} days per webhook: success-rate gauge (green ≥99% / amber ≥90% / red below), daily
          volume spark, HTTP response-code distribution, and the most-recent error. Cards sorted worst-health-first so
          silently failing webhooks surface at the top. Reuses <code>/api/webhook-health</code>. Refreshes every 60s.
        </p>
      </main>
    </div>
  )
}
