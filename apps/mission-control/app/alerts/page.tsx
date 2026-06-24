'use client'

import { useCallback, useEffect, useRef, useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'

interface AlertRow {
  id: number
  ts: number
  slug: string
  alert_type: string
  description: string
  payload: string
  ack_ts: number | null
  ack_by: string
}

const ALERT_TYPES = ['stall', 'budget', 'watchdog', 'inject']

const TYPE_STYLE: Record<string, { bg: string; text: string; dot: string }> = {
  stall:   { bg: '#EF444420', text: '#EF4444', dot: '#EF4444' },
  budget:  { bg: '#F59E0B18', text: '#F59E0B', dot: '#F59E0B' },
  watchdog:{ bg: '#A78BFA18', text: '#A78BFA', dot: '#A78BFA' },
  inject:  { bg: '#38BDF818', text: '#38BDF8', dot: '#38BDF8' },
}

function typeStyle(t: string) {
  return TYPE_STYLE[t] ?? { bg: '#64748b18', text: '#94a3b8', dot: '#64748b' }
}

function formatTs(unix: number): string {
  return new Date(unix * 1000).toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}

export default function AlertsPage() {
  return (
    <Suspense fallback={<div className="p-8 text-slate-500 font-mono text-sm">Loading…</div>}>
      <AlertsPageInner />
    </Suspense>
  )
}

function AlertsPageInner() {
  const searchParams = useSearchParams()
  const initialSlug = searchParams.get('slug') ?? ''

  const [alerts, setAlerts] = useState<AlertRow[]>([])
  const [nextCursor, setNextCursor] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [typeFilter, setTypeFilter] = useState('')
  const [slugFilter, setSlugFilter] = useState(initialSlug)
  const [slugInput, setSlugInput] = useState(initialSlug)
  const [showAcked, setShowAcked] = useState(false)
  const [busyId, setBusyId] = useState<number | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const fetchAlerts = useCallback(async (
    type: string, slug: string, includeAcked: boolean, cursor?: number, append = false
  ) => {
    if (!append) setLoading(true)
    else setLoadingMore(true)
    const params = new URLSearchParams({ limit: '100' })
    if (type) params.set('type', type)
    if (slug) params.set('slug', slug)
    if (includeAcked) params.set('includeAcked', '1')
    if (cursor != null) params.set('cursor', String(cursor))
    try {
      const res = await fetch(`/api/alerts?${params}`)
      if (!res.ok) return
      const data = await res.json() as { alerts: AlertRow[]; nextCursor: number | null }
      setAlerts(prev => append ? [...prev, ...data.alerts] : data.alerts)
      setNextCursor(data.nextCursor)
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [])

  // Toggle ack state for one alert, then reconcile the row locally.
  const toggleAck = useCallback(async (alert: AlertRow) => {
    const acking = alert.ack_ts == null
    setBusyId(alert.id)
    try {
      const res = await fetch(`/api/alerts/${alert.id}/ack`, { method: acking ? 'POST' : 'DELETE' })
      if (!res.ok) return
      const data = await res.json() as { alert: AlertRow | null }
      if (!data.alert) return
      // In open-only view an acknowledged row drops out; otherwise update in place.
      setAlerts(prev => (acking && !showAcked)
        ? prev.filter(a => a.id !== alert.id)
        : prev.map(a => a.id === alert.id ? data.alert! : a))
    } finally {
      setBusyId(null)
    }
  }, [showAcked])

  useEffect(() => { void fetchAlerts(typeFilter, slugFilter, showAcked) }, [typeFilter, slugFilter, showAcked, fetchAlerts])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => setSlugFilter(slugInput.trim()), 300)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [slugInput])

  return (
    <div className="min-h-dvh bg-[#050b14] text-slate-200 p-4 sm:p-6">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <Link href="/" className="text-slate-500 hover:text-cyber-cyan transition-colors text-sm font-mono">
          ← Mission Control
        </Link>
        <h1
          className="text-lg font-bold tracking-wider uppercase"
          style={{ fontFamily: 'Orbitron, monospace', color: '#EF4444', textShadow: '0 0 20px #EF444440' }}
        >
          Alert History
        </h1>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-5">
        <div className="flex gap-1.5 flex-wrap">
          <button
            onClick={() => setTypeFilter('')}
            className="text-xs font-mono px-3 py-1.5 rounded border transition-all"
            style={typeFilter === ''
              ? { background: '#00F5FF18', color: '#00F5FF', borderColor: '#00F5FF40' }
              : { background: 'transparent', color: '#475569', borderColor: '#1e293b' }
            }
          >
            All
          </button>
          {ALERT_TYPES.map(t => {
            const s = typeStyle(t)
            return (
              <button
                key={t}
                onClick={() => setTypeFilter(typeFilter === t ? '' : t)}
                className="text-xs font-mono px-3 py-1.5 rounded border transition-all"
                style={typeFilter === t
                  ? { background: s.bg, color: s.text, borderColor: `${s.dot}60` }
                  : { background: 'transparent', color: '#475569', borderColor: '#1e293b' }
                }
              >
                {t}
              </button>
            )
          })}
        </div>
        <input
          type="text"
          value={slugInput}
          onChange={e => setSlugInput(e.target.value)}
          placeholder="Filter by slug…"
          className="text-xs font-mono bg-slate-900 border border-cyber-cyan/20 rounded px-3 py-1.5 text-slate-300 placeholder-slate-600 focus:outline-none focus:border-cyber-cyan/50 w-44"
        />
        <button
          onClick={() => setShowAcked(v => !v)}
          className="text-xs font-mono px-3 py-1.5 rounded border transition-all"
          style={showAcked
            ? { background: '#00F5FF18', color: '#00F5FF', borderColor: '#00F5FF40' }
            : { background: 'transparent', color: '#475569', borderColor: '#1e293b' }
          }
          title={showAcked ? 'Showing all alerts including acknowledged' : 'Showing open (unacknowledged) alerts only'}
        >
          {showAcked ? '◉ All' : '○ Open only'}
        </button>
        {(typeFilter || slugFilter) && (
          <button
            onClick={() => { setTypeFilter(''); setSlugInput(''); setSlugFilter('') }}
            className="text-xs font-mono text-slate-500 hover:text-cyber-cyan transition-colors px-2 py-1.5 rounded border border-slate-700 hover:border-cyber-cyan/30"
          >
            ✕ Clear
          </button>
        )}
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-slate-800">
        <table className="w-full text-xs font-mono border-collapse">
          <thead>
            <tr className="bg-slate-900/80 border-b border-slate-800">
              <th className="text-left px-3 py-2 text-slate-500 font-semibold uppercase tracking-wider whitespace-nowrap">Time</th>
              <th className="text-left px-3 py-2 text-slate-500 font-semibold uppercase tracking-wider whitespace-nowrap">Type</th>
              <th className="text-left px-3 py-2 text-slate-500 font-semibold uppercase tracking-wider whitespace-nowrap">Project</th>
              <th className="text-left px-3 py-2 text-slate-500 font-semibold uppercase tracking-wider">Description</th>
              <th className="text-right px-3 py-2 text-slate-500 font-semibold uppercase tracking-wider whitespace-nowrap">Status</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} className="text-center py-12 text-slate-600">Loading…</td>
              </tr>
            ) : alerts.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-center py-12">
                  <div className="text-2xl mb-2" style={{ color: '#4ADE80' }}>✓</div>
                  <div className="text-slate-500">No stalled channels</div>
                  <div className="text-slate-700 text-[0.65rem] mt-1">Alert events appear here as they fire</div>
                </td>
              </tr>
            ) : (
              alerts.map(alert => {
                const s = typeStyle(alert.alert_type)
                const acked = alert.ack_ts != null
                return (
                  <tr
                    key={alert.id}
                    className="border-b border-slate-800/50 hover:bg-slate-900/40 transition-colors"
                    style={acked ? { opacity: 0.45 } : undefined}
                  >
                    <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{formatTs(alert.ts)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <span
                        className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[0.65rem] font-semibold"
                        style={{ background: s.bg, color: s.text, border: `1px solid ${s.dot}30` }}
                      >
                        <span
                          className="w-1.5 h-1.5 rounded-full shrink-0"
                          style={{ background: s.dot, boxShadow: `0 0 4px ${s.dot}` }}
                        />
                        {alert.alert_type}
                      </span>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {alert.slug ? (
                        <Link
                          href={`/?project=${alert.slug}`}
                          className="text-cyber-cyan/70 hover:text-cyber-cyan transition-colors"
                        >
                          {alert.slug}
                        </Link>
                      ) : <span className="text-slate-700">—</span>}
                    </td>
                    <td className="px-3 py-2 text-slate-400 max-w-sm truncate" title={alert.description}>
                      {alert.description}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-right">
                      <div className="flex items-center justify-end gap-2">
                        {acked && (
                          <span className="text-[0.6rem] text-slate-500" title={`Acknowledged ${formatTs(alert.ack_ts!)}`}>
                            ✓ {alert.ack_by || 'acked'}
                          </span>
                        )}
                        <button
                          onClick={() => void toggleAck(alert)}
                          disabled={busyId === alert.id}
                          className="text-[0.65rem] font-mono px-2 py-0.5 rounded border transition-all disabled:opacity-40"
                          style={acked
                            ? { background: 'transparent', color: '#64748b', borderColor: '#1e293b' }
                            : { background: '#4ADE8018', color: '#4ADE80', borderColor: '#4ADE8040' }
                          }
                        >
                          {busyId === alert.id ? '…' : acked ? 'Unack' : 'Ack'}
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {nextCursor != null && (
        <div className="mt-4 text-center">
          <button
            onClick={() => void fetchAlerts(typeFilter, slugFilter, showAcked, nextCursor, true)}
            disabled={loadingMore}
            className="text-xs font-mono text-slate-500 hover:text-cyber-cyan transition-colors px-4 py-2 rounded border border-slate-700 hover:border-cyber-cyan/30 disabled:opacity-50"
          >
            {loadingMore ? 'Loading…' : 'Load older alerts →'}
          </button>
        </div>
      )}

      <p className="mt-6 text-center text-[0.6rem] text-slate-700 font-mono">
        Alert events from mc.db · 30-day retention · newest first
      </p>
    </div>
  )
}
