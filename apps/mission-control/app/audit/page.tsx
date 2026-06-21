'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'

interface EventRow {
  id: number
  instance_id: string
  host: string
  user: string
  ts: string
  type: string
  payload: string
  created_at: number
}

interface EventsResponse {
  events: EventRow[]
  nextCursor: number | null
  total?: number
}

const EVENT_TYPES = [
  'session_start',
  'session_stop',
  'session_killed_watchdog',
  'circuit_open',
  'circuit_reset',
  'scheduler_fired',
  'budget_alert',
  'context_warning',
  'command_executed',
  'respawn_scheduled',
]

const TYPE_COLOR: Record<string, { bg: string; text: string; dot: string }> = {
  session_start:           { bg: '#00F5FF18', text: '#00F5FF', dot: '#00F5FF' },
  session_stop:            { bg: '#F9731618', text: '#F97316', dot: '#F97316' },
  session_killed_watchdog: { bg: '#EF444420', text: '#EF4444', dot: '#EF4444' },
  circuit_open:            { bg: '#EF444420', text: '#EF4444', dot: '#EF4444' },
  circuit_reset:           { bg: '#4ADE8018', text: '#4ADE80', dot: '#4ADE80' },
  scheduler_fired:         { bg: '#FCD34D18', text: '#FCD34D', dot: '#FCD34D' },
  budget_alert:            { bg: '#F59E0B18', text: '#F59E0B', dot: '#F59E0B' },
  context_warning:         { bg: '#A78BFA18', text: '#A78BFA', dot: '#A78BFA' },
  command_executed:        { bg: '#38BDF818', text: '#38BDF8', dot: '#38BDF8' },
  respawn_scheduled:       { bg: '#FB923C18', text: '#FB923C', dot: '#FB923C' },
}

function typeStyle(type: string) {
  return TYPE_COLOR[type] ?? { bg: '#64748b18', text: '#94a3b8', dot: '#64748b' }
}

function slugFromPayload(payload: string): string {
  try {
    const p = JSON.parse(payload) as Record<string, unknown>
    return typeof p.slug === 'string' ? p.slug : ''
  } catch { return '' }
}

function payloadSummary(payload: string): string {
  try {
    const p = JSON.parse(payload) as Record<string, unknown>
    const parts: string[] = []
    if (p.slug) parts.push(`slug=${p.slug}`)
    if (p.stuckMs) parts.push(`stuckMs=${p.stuckMs}`)
    if (p.threshold) parts.push(`threshold=${p.threshold}%`)
    if (p.failureCount) parts.push(`failures=${p.failureCount}`)
    if (p.reason) parts.push(`reason=${p.reason}`)
    if (p.scheduledTime) parts.push(`at=${p.scheduledTime}`)
    if (p.backoffMs) parts.push(`backoff=${p.backoffMs}ms`)
    return parts.length > 0 ? parts.join(' · ') : JSON.stringify(p).slice(0, 80)
  } catch { return payload.slice(0, 80) }
}

function formatTs(ts: string): string {
  const d = new Date(ts)
  return d.toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}

export default function AuditPage() {
  const searchParams = useSearchParams()
  const initialSlug = searchParams.get('slug') ?? ''
  const [events, setEvents] = useState<EventRow[]>([])
  const [nextCursor, setNextCursor] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [typeFilter, setTypeFilter] = useState<string>('')
  const [slugFilter, setSlugFilter] = useState<string>(initialSlug)
  const [slugInput, setSlugInput] = useState<string>(initialSlug)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const fetchEvents = useCallback(async (
    type: string, slug: string, cursor?: number, append = false
  ) => {
    if (!append) setLoading(true)
    else setLoadingMore(true)
    const params = new URLSearchParams({ limit: '100', total: '0' })
    if (type) params.set('type', type)
    if (slug) params.set('slug', slug)
    if (cursor != null) params.set('cursor', String(cursor))
    try {
      const res = await fetch(`/api/events?${params}`)
      if (!res.ok) return
      const data = await res.json() as EventsResponse
      setEvents(prev => append ? [...prev, ...data.events] : data.events)
      setNextCursor(data.nextCursor)
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [])

  useEffect(() => {
    void fetchEvents(typeFilter, slugFilter)
  }, [typeFilter, slugFilter, fetchEvents])

  // Debounce slug input
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setSlugFilter(slugInput.trim())
    }, 300)
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
          style={{ fontFamily: 'Orbitron, monospace', color: '#00F5FF', textShadow: '0 0 20px #00F5FF50' }}
        >
          Fleet Audit Log
        </h1>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-5">
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="text-xs font-mono bg-slate-900 border border-cyber-cyan/20 rounded px-3 py-1.5 text-slate-300 focus:outline-none focus:border-cyber-cyan/50"
        >
          <option value="">All event types</option>
          {EVENT_TYPES.map((t) => (
            <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>
          ))}
        </select>
        <input
          type="text"
          value={slugInput}
          onChange={(e) => setSlugInput(e.target.value)}
          placeholder="Filter by slug…"
          className="text-xs font-mono bg-slate-900 border border-cyber-cyan/20 rounded px-3 py-1.5 text-slate-300 placeholder-slate-600 focus:outline-none focus:border-cyber-cyan/50 w-44"
        />
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
              <th className="text-left px-3 py-2 text-slate-500 font-semibold uppercase tracking-wider whitespace-nowrap">Event</th>
              <th className="text-left px-3 py-2 text-slate-500 font-semibold uppercase tracking-wider whitespace-nowrap">Slug</th>
              <th className="text-left px-3 py-2 text-slate-500 font-semibold uppercase tracking-wider">Details</th>
              <th className="text-left px-3 py-2 text-slate-500 font-semibold uppercase tracking-wider whitespace-nowrap hidden sm:table-cell">Host</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} className="text-center py-12 text-slate-600">Loading…</td>
              </tr>
            ) : events.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-center py-12 text-slate-600">No events found.</td>
              </tr>
            ) : (
              events.map((ev) => {
                const style = typeStyle(ev.type)
                const slug = slugFromPayload(ev.payload)
                return (
                  <tr
                    key={ev.id}
                    className="border-b border-slate-800/50 hover:bg-slate-900/40 transition-colors"
                  >
                    <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{formatTs(ev.ts)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <span
                        className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[0.65rem] font-semibold"
                        style={{ background: style.bg, color: style.text, border: `1px solid ${style.dot}30` }}
                      >
                        <span
                          className="w-1.5 h-1.5 rounded-full shrink-0"
                          style={{ background: style.dot, boxShadow: `0 0 4px ${style.dot}` }}
                        />
                        {ev.type.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {slug ? (
                        <button
                          onClick={() => { setSlugInput(slug); setSlugFilter(slug) }}
                          className="text-cyber-cyan/70 hover:text-cyber-cyan transition-colors underline-offset-2 hover:underline"
                        >
                          {slug}
                        </button>
                      ) : (
                        <span className="text-slate-700">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-slate-500 max-w-xs truncate" title={ev.payload}>
                      {payloadSummary(ev.payload)}
                    </td>
                    <td className="px-3 py-2 text-slate-600 whitespace-nowrap hidden sm:table-cell">{ev.host || '—'}</td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Load more */}
      {nextCursor != null && (
        <div className="mt-4 text-center">
          <button
            onClick={() => void fetchEvents(typeFilter, slugFilter, nextCursor, true)}
            disabled={loadingMore}
            className="text-xs font-mono text-slate-500 hover:text-cyber-cyan transition-colors px-4 py-2 rounded border border-slate-700 hover:border-cyber-cyan/30 disabled:opacity-50"
          >
            {loadingMore ? 'Loading…' : 'Load older events →'}
          </button>
        </div>
      )}

      <p className="mt-6 text-center text-[0.6rem] text-slate-700 font-mono">
        Fleet events from mc.db · 100/page · newest first
      </p>
    </div>
  )
}
