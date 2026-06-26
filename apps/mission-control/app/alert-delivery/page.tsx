'use client'

import { useCallback, useEffect, useState, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import SubPageHeader from '../../components/SubPageHeader'
import type { AlertDeliveryResponse, AlertDeliveryRow } from '../api/alert-delivery/route'

type DeliveryStatus = 'delivered' | 'failed' | 'pending'

const TYPE_STYLE: Record<string, { bg: string; color: string }> = {
  stall:    { bg: '#EF444420', color: '#EF4444' },
  budget:   { bg: '#F59E0B18', color: '#F59E0B' },
  watchdog: { bg: '#A78BFA18', color: '#A78BFA' },
  inject:   { bg: '#38BDF818', color: '#38BDF8' },
}
function typeStyle(t: string) { return TYPE_STYLE[t] ?? { bg: '#64748b18', color: '#94a3b8' } }

const STATUS_ICON: Record<DeliveryStatus, string> = {
  delivered: '✓',
  failed:    '✗',
  pending:   '○',
}
const STATUS_COLOR: Record<DeliveryStatus, string> = {
  delivered: '#10B981',
  failed:    '#EF4444',
  pending:   '#F59E0B',
}

function fmtTs(unix: number): string {
  return new Date(unix * 1000).toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}

function fmtLatency(ts: number, deliveredTs: number | null): string {
  if (deliveredTs === null) return '—'
  const s = deliveredTs - ts
  if (s < 0) return '—'
  if (s < 60) return `${s}s`
  return `${Math.round(s / 60)}m`
}

function AlertDeliveryInner() {
  const searchParams = useSearchParams()
  const router = useRouter()

  const [data, setData] = useState<AlertDeliveryResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [filterStatus, setFilterStatus] = useState(searchParams.get('status') ?? '')
  const [filterType, setFilterType] = useState(searchParams.get('type') ?? '')

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (filterStatus) params.set('status', filterStatus)
      if (filterType) params.set('type', filterType)
      const res = await fetch(`/api/alert-delivery?${params}`)
      if (res.ok) setData(await res.json() as AlertDeliveryResponse)
    } catch { /* skip */ } finally {
      setLoading(false)
    }
  }, [filterStatus, filterType])

  useEffect(() => { fetchData() }, [fetchData])

  useEffect(() => {
    const params = new URLSearchParams()
    if (filterStatus) params.set('status', filterStatus)
    if (filterType) params.set('type', filterType)
    router.replace(`/alert-delivery${params.toString() ? '?' + params.toString() : ''}`, { scroll: false })
  }, [filterStatus, filterType, router])

  const undelivered = data?.alerts.filter((a) => a.status === 'pending') ?? []
  const failed = data?.alerts.filter((a) => a.status === 'failed') ?? []

  return (
    <div className="min-h-dvh flex flex-col" style={{ background: '#020811', fontFamily: 'JetBrains Mono, monospace' }}>
      <SubPageHeader title="ALERT DELIVERY AUDIT LOG" />

      {/* Stats bar */}
      {data && (
        <div className="flex flex-wrap items-center gap-4 px-4 py-2 border-b border-white/5 text-[0.6rem] font-mono" style={{ background: '#060d1a' }}>
          <div
            className="px-2 py-0.5 rounded"
            style={{
              background: data.stats.successRate >= 90 ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)',
              border: `1px solid ${data.stats.successRate >= 90 ? '#10B98130' : '#EF444430'}`,
              color: data.stats.successRate >= 90 ? '#10B981' : '#EF4444',
            }}
          >
            {data.stats.successRate}% delivery success
          </div>
          {data.stats.avgLatencyS !== null && (
            <span className="text-slate-500">avg latency: <span className="text-slate-300">{data.stats.avgLatencyS}s</span></span>
          )}
          {data.stats.undelivered24h > 0 && (
            <span
              className="px-2 py-0.5 rounded"
              style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', color: '#F59E0B' }}
            >
              {data.stats.undelivered24h} undelivered in last 24h
            </span>
          )}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 px-4 py-2 border-b border-white/5" style={{ background: '#060d1a' }}>
        <div className="flex items-center gap-2">
          <span className="text-[0.6rem] font-mono text-slate-500 uppercase">Status</span>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="text-xs font-mono bg-slate-900 border border-slate-700 rounded px-2 py-0.5 text-slate-300 focus:outline-none"
          >
            <option value="">All</option>
            <option value="pending">Pending</option>
            <option value="delivered">Delivered</option>
            <option value="failed">Failed</option>
          </select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[0.6rem] font-mono text-slate-500 uppercase">Type</span>
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="text-xs font-mono bg-slate-900 border border-slate-700 rounded px-2 py-0.5 text-slate-300 focus:outline-none"
          >
            <option value="">All</option>
            <option value="stall">Stall</option>
            <option value="budget">Budget</option>
            <option value="watchdog">Watchdog</option>
            <option value="inject">Inject</option>
          </select>
        </div>
        <button
          onClick={fetchData}
          className="text-[0.6rem] font-mono px-2 py-0.5 rounded border border-slate-700 text-slate-500 hover:text-slate-300 transition-colors ml-auto"
        >
          ↻ Refresh
        </button>
      </div>

      {loading && <div className="p-8 text-slate-500 text-xs font-mono">Loading…</div>}

      {data && (
        <div className="p-4 flex flex-col gap-4" style={{ maxWidth: 960 }}>
          {/* Failed/pending surfaced first */}
          {(failed.length > 0 || (filterStatus === '' && undelivered.length > 0)) && (
            <div className="rounded border p-3" style={{ background: '#060d1a', borderColor: '#EF444430' }}>
              <div className="text-[0.6rem] font-mono uppercase tracking-widest mb-2" style={{ color: '#EF4444' }}>
                Attention — {failed.length} failed · {undelivered.length} pending delivery
              </div>
              <div className="flex flex-col gap-1.5">
                {[...failed, ...undelivered.slice(0, 5)].map((a) => (
                  <AlertRow key={a.id} alert={a} onRefresh={fetchData} />
                ))}
                {undelivered.length > 5 && (
                  <div className="text-[0.55rem] font-mono text-slate-600">…and {undelivered.length - 5} more pending</div>
                )}
              </div>
            </div>
          )}

          {/* Full list */}
          <div className="rounded border p-3" style={{ background: '#060d1a', borderColor: '#1e3a5f' }}>
            <div className="text-[0.6rem] font-mono text-slate-400 uppercase tracking-widest mb-2">
              All Alerts ({data.alerts.length})
            </div>
            {data.alerts.length === 0 ? (
              <div className="text-slate-600 text-xs font-mono py-2">No alerts found.</div>
            ) : (
              <div className="flex flex-col gap-1">
                {data.alerts.map((a) => (
                  <AlertRow key={a.id} alert={a} onRefresh={fetchData} />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function AlertRow({ alert: a, onRefresh }: { alert: AlertDeliveryRow; onRefresh: () => void }) {
  const [marking, setMarking] = useState(false)
  const ts = typeStyle(a.alert_type)
  const statusColor = STATUS_COLOR[a.status]

  async function markDelivered() {
    setMarking(true)
    try {
      await fetch('/api/alert-delivery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: a.id, channel: 'manual', messageId: '', error: '' }),
      })
      onRefresh()
    } catch { /* skip */ } finally {
      setMarking(false)
    }
  }

  return (
    <div
      className="flex items-start gap-3 px-3 py-2 rounded text-[0.6rem] font-mono"
      style={{ background: a.status === 'failed' ? 'rgba(239,68,68,0.05)' : 'rgba(255,255,255,0.02)' }}
    >
      {/* Status icon */}
      <span
        className="shrink-0 w-4 text-center font-bold mt-0.5"
        style={{ color: statusColor }}
        title={a.status}
      >
        {STATUS_ICON[a.status]}
      </span>

      {/* Type badge */}
      <span
        className="shrink-0 px-1.5 py-0.5 rounded text-[0.55rem] font-bold uppercase"
        style={{ background: ts.bg, color: ts.color }}
      >
        {a.alert_type}
      </span>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="text-slate-300 truncate">{a.description}</div>
        <div className="text-slate-600 text-[0.5rem] mt-0.5">
          <span>{a.slug || '—'}</span>
          <span className="mx-1.5">·</span>
          <span>{new Date(a.ts * 1000).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
          {a.ack_ts && <span className="ml-1.5 text-emerald-600/60">acked</span>}
        </div>
      </div>

      {/* Delivery info */}
      <div className="shrink-0 text-right text-[0.5rem]">
        {a.status === 'delivered' ? (
          <>
            <div style={{ color: '#10B981' }}>delivered</div>
            {a.delivery_channel && <div className="text-slate-600">{a.delivery_channel}</div>}
            <div className="text-slate-700">+{fmtLatency(a.ts, a.delivered_ts)}</div>
          </>
        ) : a.status === 'failed' ? (
          <>
            <div style={{ color: '#EF4444' }}>failed</div>
            <div className="text-slate-600 max-w-[120px] truncate" title={a.delivery_error}>{a.delivery_error || 'unknown error'}</div>
          </>
        ) : (
          <button
            onClick={markDelivered}
            disabled={marking}
            className="px-1.5 py-0.5 rounded border transition-colors text-[0.5rem]"
            style={{ borderColor: '#1e3a5f', color: '#475569' }}
            title="Mark as manually delivered"
          >
            {marking ? '…' : 'mark sent'}
          </button>
        )}
      </div>
    </div>
  )
}

export default function AlertDeliveryPage() {
  return (
    <Suspense fallback={<div className="p-8 text-slate-500 font-mono text-sm">Loading…</div>}>
      <AlertDeliveryInner />
    </Suspense>
  )
}
