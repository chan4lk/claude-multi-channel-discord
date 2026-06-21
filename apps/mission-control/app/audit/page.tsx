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

// State color mapping for replay mini-grid
const STATE_COLOR: Record<string, { bg: string; text: string; pulse?: boolean }> = {
  active:  { bg: '#4ADE8020', text: '#4ADE80' },
  idle:    { bg: '#00F5FF18', text: '#00F5FF' },
  stalled: { bg: '#EF444420', text: '#EF4444', pulse: true },
}

// Maps audit event type → project state transition
function eventToState(type: string): string | null {
  switch (type) {
    case 'session_start':           return 'active'
    case 'session_stop':            return 'idle'
    case 'session_killed_watchdog': return 'stalled'
    case 'circuit_open':            return 'stalled'
    case 'circuit_reset':           return 'idle'
    default:                        return null
  }
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

// Format a Date as value for datetime-local input
function toDatetimeLocal(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
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

  // ── Replay state ──────────────────────────────────────────────────────────
  const [replayEnabled, setReplayEnabled] = useState(false)
  const [replayStart, setReplayStart] = useState<string>('')
  const [replayEnd, setReplayEnd] = useState<string>('')
  const [replayCursor, setReplayCursor] = useState(0)
  const [playing, setPlaying] = useState(false)
  const playIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  // ─────────────────────────────────────────────────────────────────────────

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

  // When replay is enabled and events are loaded, set default time range
  useEffect(() => {
    if (replayEnabled && events.length > 0 && !replayStart && !replayEnd) {
      // Events are newest-first; oldest is last
      const oldest = new Date(events[events.length - 1].ts)
      const newest = new Date(events[0].ts)
      setReplayStart(toDatetimeLocal(oldest))
      setReplayEnd(toDatetimeLocal(newest))
      setReplayCursor(0)
    }
  }, [replayEnabled, events, replayStart, replayEnd])

  // Reset cursor when time range changes
  useEffect(() => {
    setReplayCursor(0)
    setPlaying(false)
  }, [replayStart, replayEnd])

  // Play loop: step through events at ~10x speed (100ms per event)
  useEffect(() => {
    if (playing) {
      playIntervalRef.current = setInterval(() => {
        setReplayCursor(prev => {
          const rangeEventsLen = rangeEventsForEffect.current
          if (prev >= rangeEventsLen) {
            setPlaying(false)
            return prev
          }
          return prev + 1
        })
      }, 100)
    } else {
      if (playIntervalRef.current) {
        clearInterval(playIntervalRef.current)
        playIntervalRef.current = null
      }
    }
    return () => {
      if (playIntervalRef.current) {
        clearInterval(playIntervalRef.current)
        playIntervalRef.current = null
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing])

  // We need rangeEvents length inside the interval without stale closure
  const rangeEventsForEffect = useRef(0)

  // ── Derived replay data ───────────────────────────────────────────────────
  // Filter events to the selected time range and reverse to oldest-first
  const rangeEvents: EventRow[] = (() => {
    if (!replayStart && !replayEnd) return []
    const start = replayStart ? new Date(replayStart).getTime() : 0
    const end = replayEnd ? new Date(replayEnd).getTime() : Infinity
    return [...events]
      .filter(ev => {
        const t = new Date(ev.ts).getTime()
        return t >= start && t <= end
      })
      .reverse() // oldest first for replay
  })()

  // Keep ref in sync for the play loop
  rangeEventsForEffect.current = rangeEvents.length

  // Clamp cursor to valid range
  const clampedCursor = Math.min(replayCursor, rangeEvents.length)

  // Reconstruct project states at cursor position
  const reconstructedState: Record<string, string> = {}
  for (let i = 0; i < clampedCursor; i++) {
    const ev = rangeEvents[i]
    const slug = slugFromPayload(ev.payload)
    const newState = eventToState(ev.type)
    if (slug && newState) {
      reconstructedState[slug] = newState
    }
  }

  // Current display timestamp
  const currentReplayTs =
    clampedCursor > 0
      ? rangeEvents[clampedCursor - 1]?.ts ?? replayStart
      : replayStart

  const slugsInRange = Array.from(new Set(
    rangeEvents.map(ev => slugFromPayload(ev.payload)).filter(Boolean)
  ))
  // ─────────────────────────────────────────────────────────────────────────

  function handleJumpToIncident() {
    const incidentIdx = rangeEvents.findIndex(
      ev => ev.type === 'session_killed_watchdog' || ev.type === 'circuit_open'
    )
    if (incidentIdx === -1) return
    setReplayCursor(incidentIdx + 1)
    // Scroll the main table to the event row
    const evId = rangeEvents[incidentIdx].id
    const row = document.querySelector(`[data-event-id="${evId}"]`)
    if (row) {
      row.scrollIntoView({ behavior: 'smooth', block: 'center' })
      // Brief highlight flash
      ;(row as HTMLElement).style.transition = 'background 0.2s'
      ;(row as HTMLElement).style.background = '#EF444430'
      setTimeout(() => {
        ;(row as HTMLElement).style.background = ''
      }, 1500)
    }
  }

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
        <div className="ml-auto">
          <button
            onClick={() => {
              setReplayEnabled(v => !v)
              setPlaying(false)
              if (replayEnabled) {
                // Reset when disabling
                setReplayStart('')
                setReplayEnd('')
                setReplayCursor(0)
              }
            }}
            className="text-xs font-mono px-3 py-1.5 rounded border transition-all"
            style={replayEnabled
              ? { background: '#00F5FF18', color: '#00F5FF', borderColor: '#00F5FF60', boxShadow: '0 0 12px #00F5FF30' }
              : { background: 'transparent', color: '#64748b', borderColor: '#334155' }
            }
          >
            {replayEnabled ? '⏹ Exit Replay' : '▶ Replay'}
          </button>
        </div>
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

      {/* ── Replay Panel ─────────────────────────────────────────────────────── */}
      {replayEnabled && (
        <div
          className="mb-5 rounded-xl border p-4"
          style={{ background: '#0a1628', borderColor: '#00F5FF30', boxShadow: '0 0 24px #00F5FF08' }}
        >
          {/* Panel header */}
          <div className="flex items-center gap-2 mb-4">
            <span
              className="text-xs font-bold tracking-widest uppercase"
              style={{ fontFamily: 'Orbitron, monospace', color: '#00F5FF', textShadow: '0 0 10px #00F5FF50' }}
            >
              ▶ Replay Mode
            </span>
            <span className="text-[0.6rem] font-mono text-slate-600 ml-auto">
              Replaying from loaded events (newest 100)
            </span>
          </div>

          {/* Time range pickers */}
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <label className="text-[0.65rem] font-mono text-slate-500 shrink-0">From</label>
            <input
              type="datetime-local"
              value={replayStart}
              onChange={e => setReplayStart(e.target.value)}
              className="text-xs font-mono bg-slate-900 border border-slate-700 rounded px-2 py-1 text-slate-300 focus:outline-none focus:border-cyber-cyan/50"
              style={{ colorScheme: 'dark' }}
            />
            <label className="text-[0.65rem] font-mono text-slate-500 shrink-0">To</label>
            <input
              type="datetime-local"
              value={replayEnd}
              onChange={e => setReplayEnd(e.target.value)}
              className="text-xs font-mono bg-slate-900 border border-slate-700 rounded px-2 py-1 text-slate-300 focus:outline-none focus:border-cyber-cyan/50"
              style={{ colorScheme: 'dark' }}
            />
            <span className="text-[0.65rem] font-mono text-slate-600 ml-auto">
              {rangeEvents.length} event{rangeEvents.length !== 1 ? 's' : ''} in range
            </span>
          </div>

          {/* Scrubber */}
          <div className="mb-3">
            <input
              type="range"
              min={0}
              max={rangeEvents.length}
              value={clampedCursor}
              onChange={e => {
                setPlaying(false)
                setReplayCursor(Number(e.target.value))
              }}
              disabled={rangeEvents.length === 0}
              className="w-full h-1.5 rounded appearance-none cursor-pointer disabled:opacity-40"
              style={{
                background: rangeEvents.length === 0
                  ? '#1e293b'
                  : `linear-gradient(to right, #00F5FF ${(clampedCursor / Math.max(1, rangeEvents.length)) * 100}%, #1e293b ${(clampedCursor / Math.max(1, rangeEvents.length)) * 100}%)`,
                accentColor: '#00F5FF',
              }}
            />
            <div className="flex justify-between mt-1">
              <span className="text-[0.6rem] font-mono text-slate-600">
                {replayStart ? new Date(replayStart).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}
              </span>
              <span className="text-[0.65rem] font-mono" style={{ color: '#00F5FF80' }}>
                {clampedCursor > 0 ? formatTs(currentReplayTs) : 'Scrub to start'}
              </span>
              <span className="text-[0.6rem] font-mono text-slate-600">
                {replayEnd ? new Date(replayEnd).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}
              </span>
            </div>
          </div>

          {/* Controls */}
          <div className="flex flex-wrap gap-2 mb-4">
            <button
              onClick={() => setPlaying(true)}
              disabled={playing || rangeEvents.length === 0 || clampedCursor >= rangeEvents.length}
              className="text-xs font-mono px-3 py-1.5 rounded border transition-all disabled:opacity-40"
              style={{ background: '#4ADE8018', color: '#4ADE80', borderColor: '#4ADE8040' }}
            >
              ▶ Play
            </button>
            <button
              onClick={() => setPlaying(false)}
              disabled={!playing}
              className="text-xs font-mono px-3 py-1.5 rounded border transition-all disabled:opacity-40"
              style={{ background: '#1e293b', color: '#94a3b8', borderColor: '#334155' }}
            >
              ⏹ Stop
            </button>
            <button
              onClick={() => { setReplayCursor(0); setPlaying(false) }}
              disabled={clampedCursor === 0}
              className="text-xs font-mono px-3 py-1.5 rounded border transition-all disabled:opacity-40"
              style={{ background: '#1e293b', color: '#94a3b8', borderColor: '#334155' }}
            >
              ↩ Reset
            </button>
            <button
              onClick={handleJumpToIncident}
              disabled={rangeEvents.length === 0}
              className="text-xs font-mono px-3 py-1.5 rounded border transition-all disabled:opacity-40"
              style={{ background: '#EF444418', color: '#EF4444', borderColor: '#EF444440' }}
            >
              ⚡ Jump to Incident
            </button>
            <span className="text-[0.65rem] font-mono text-slate-600 self-center ml-1">
              {clampedCursor} / {rangeEvents.length}
            </span>
          </div>

          {/* Mini instance grid */}
          {slugsInRange.length > 0 ? (
            <div>
              <div className="text-[0.6rem] font-mono text-slate-600 uppercase tracking-wider mb-2">
                Reconstructed State at cursor
              </div>
              <div className="flex flex-wrap gap-2">
                {slugsInRange.map(slug => {
                  const state = reconstructedState[slug] ?? 'unknown'
                  const sc = STATE_COLOR[state] ?? { bg: '#64748b18', text: '#64748b' }
                  return (
                    <div
                      key={slug}
                      className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[0.65rem] font-mono border"
                      style={{
                        background: sc.bg,
                        color: sc.text,
                        borderColor: `${sc.text}30`,
                        boxShadow: sc.pulse ? `0 0 8px ${sc.text}40` : undefined,
                        animation: sc.pulse ? 'pulse 1.5s ease-in-out infinite' : undefined,
                      }}
                    >
                      <span
                        className="w-1.5 h-1.5 rounded-full shrink-0"
                        style={{ background: sc.text, boxShadow: `0 0 4px ${sc.text}` }}
                      />
                      <span className="text-slate-400">{slug}</span>
                      <span style={{ color: sc.text }}>{state}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          ) : (
            <div className="text-[0.65rem] font-mono text-slate-700 text-center py-2">
              {rangeEvents.length === 0 ? 'No events in selected range.' : 'No project-state events in range.'}
            </div>
          )}
        </div>
      )}
      {/* ───────────────────────────────────────────────────────────────────── */}

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
                // Highlight rows that are in the current replay range and at/before cursor
                const inReplayRange = replayEnabled && rangeEvents.some(r => r.id === ev.id)
                const atOrBeforeCursor = inReplayRange && rangeEvents.findIndex(r => r.id === ev.id) < clampedCursor
                return (
                  <tr
                    key={ev.id}
                    data-event-id={ev.id}
                    className="border-b border-slate-800/50 hover:bg-slate-900/40 transition-colors"
                    style={atOrBeforeCursor ? { background: '#00F5FF08' } : undefined}
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
