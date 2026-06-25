'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import SubPageHeader from '../../components/SubPageHeader'
import type { InboxResponse, InboxAlert, AlertSeverity, AlertType } from '../api/inbox/route'

const TYPE_LABEL: Record<AlertType, string> = {
  'context-pressure': 'Context Pressure',
  'circuit-open': 'Circuit Open',
  'watchdog-kill': 'Watchdog Kill',
  'low-health': 'Low Health',
}

const TYPE_DRILL: Record<AlertType, string> = {
  'context-pressure': '/context-pressure',
  'circuit-open': '/circuit-timeline',
  'watchdog-kill': '/watchdog-kills',
  'low-health': '/health-score',
}

function severityColor(s: AlertSeverity): string {
  return s === 'critical' ? '#EF4444' : '#F59E0B'
}

function typeIcon(t: AlertType): string {
  switch (t) {
    case 'context-pressure': return '◑'
    case 'circuit-open': return '⊘'
    case 'watchdog-kill': return '☠'
    case 'low-health': return '◈'
  }
}

function fmtTs(ts: string): string {
  return ts.slice(0, 16).replace('T', ' ')
}

const DISMISS_KEY = 'mcd_inbox_dismissed'
const DISMISS_TTL_MS = 10 * 60 * 1000

function loadDismissed(): Record<string, number> {
  if (typeof localStorage === 'undefined') return {}
  try { return JSON.parse(localStorage.getItem(DISMISS_KEY) ?? '{}') } catch { return {} }
}

function saveDismissed(d: Record<string, number>) {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(DISMISS_KEY, JSON.stringify(d))
}

function isDismissed(id: string, dismissed: Record<string, number>): boolean {
  const exp = dismissed[id]
  if (!exp) return false
  if (Date.now() > exp) return false
  return true
}

export default function InboxPage() {
  const [data, setData] = useState<InboxResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [dismissed, setDismissed] = useState<Record<string, number>>({})

  const load = useCallback(() => {
    fetch('/api/inbox')
      .then((r) => r.json())
      .then((d: InboxResponse) => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  useEffect(() => {
    setDismissed(loadDismissed())
    load()
    const t = setInterval(load, 30_000)
    return () => clearInterval(t)
  }, [load])

  function dismiss(id: string) {
    const next = { ...dismissed, [id]: Date.now() + DISMISS_TTL_MS }
    // prune expired
    for (const k of Object.keys(next)) {
      if (next[k] < Date.now()) delete next[k]
    }
    setDismissed(next)
    saveDismissed(next)
  }

  const visible = (data?.alerts ?? []).filter((a) => !isDismissed(a.id, dismissed))
  const critCount = visible.filter((a) => a.severity === 'critical').length
  const warnCount = visible.filter((a) => a.severity === 'warning').length

  return (
    <div className="min-h-screen p-4 md:p-6" style={{ background: '#080f1c', color: '#E2E8F0' }}>
      <SubPageHeader title="Operator Inbox">
        <span className="text-[0.6rem] font-mono text-slate-500">
          Unified alert triage · context · circuit · watchdog · health
        </span>
      </SubPageHeader>

      {!loading && (
        <div className="max-w-3xl mx-auto">
          {/* Summary chips */}
          <div className="flex flex-wrap gap-3 mb-5">
            {[
              { label: 'Critical', value: critCount, color: '#EF4444' },
              { label: 'Warning', value: warnCount, color: '#F59E0B' },
              { label: 'Total active', value: visible.length, color: '#94A3B8' },
            ].map(({ label, value, color }) => (
              <div
                key={label}
                className="rounded border border-white/5 px-4 py-2 text-center min-w-[90px]"
                style={{ background: 'rgba(255,255,255,0.02)' }}
              >
                <div className="text-base font-mono font-bold" style={{ color }}>{value}</div>
                <div className="text-[0.5rem] font-mono text-slate-600">{label}</div>
              </div>
            ))}
          </div>

          {visible.length === 0 ? (
            <div className="text-center py-20 text-slate-600 font-mono text-sm">
              ✓ All clear
              <div className="text-[0.5rem] mt-2 text-slate-700">No active alerts — all projects healthy</div>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {visible.map((alert: InboxAlert) => (
                <AlertCard
                  key={alert.id}
                  alert={alert}
                  onDismiss={() => dismiss(alert.id)}
                />
              ))}
            </div>
          )}

          {data && (
            <div className="text-[0.5rem] font-mono text-slate-700 text-right mt-6">
              Refreshes every 30s · last: {fmtTs(data.generatedAt)}
            </div>
          )}
        </div>
      )}

      {loading && (
        <div className="text-center py-20 text-slate-600 font-mono text-sm">Loading…</div>
      )}
    </div>
  )
}

function AlertCard({ alert, onDismiss }: { alert: InboxAlert; onDismiss: () => void }) {
  const color = severityColor(alert.severity)
  const drillHref = `${TYPE_DRILL[alert.type]}?slug=${alert.slug}`

  return (
    <div
      className="rounded-lg border px-4 py-3 flex flex-col gap-2"
      style={{ borderColor: `${color}33`, background: `${color}08` }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-base" style={{ color }}>{typeIcon(alert.type)}</span>
          <div className="flex flex-col min-w-0">
            <div className="flex items-center gap-2">
              <span
                className="text-[0.55rem] font-mono font-bold px-1.5 py-0.5 rounded uppercase"
                style={{ background: `${color}22`, color }}
              >
                {alert.severity}
              </span>
              <span className="text-[0.6rem] font-mono text-slate-400">{TYPE_LABEL[alert.type]}</span>
            </div>
            <span className="text-[0.7rem] font-mono text-slate-200 mt-0.5 truncate">
              {alert.message}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-[0.5rem] font-mono text-slate-600">{fmtTs(alert.ts)}</span>
        </div>
      </div>

      <div className="flex items-center gap-2 pt-1">
        {/* Project link */}
        <Link
          href={`/projects?slug=${alert.slug}`}
          className="text-[0.55rem] font-mono px-2 py-1 rounded border border-white/10 text-cyan-400 hover:text-cyan-300 transition-colors"
          style={{ background: 'rgba(34,211,238,0.06)' }}
        >
          {alert.slug}
        </Link>

        {/* Spotlight */}
        <Link
          href={drillHref}
          className="text-[0.55rem] font-mono px-2 py-1 rounded border border-white/10 text-slate-400 hover:text-slate-200 transition-colors"
          style={{ background: 'rgba(255,255,255,0.02)' }}
        >
          Spotlight →
        </Link>

        {/* Dismiss */}
        <button
          onClick={onDismiss}
          className="text-[0.55rem] font-mono px-2 py-1 rounded border border-white/10 text-slate-500 hover:text-slate-300 transition-colors ml-auto"
          style={{ background: 'rgba(255,255,255,0.02)' }}
        >
          Dismiss 10m
        </button>
      </div>
    </div>
  )
}
