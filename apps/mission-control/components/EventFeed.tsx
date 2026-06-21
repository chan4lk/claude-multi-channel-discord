'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import GlassCard from './ui/GlassCard'

interface EventEntry {
  id: string
  ts: number
  type: string
  instance_id: string
  payload: Record<string, unknown>
}

// Category → event types that belong to it
const CATEGORY_TYPES: Record<string, string[]> = {
  error:     ['error', 'error_event', 'watchdog'],
  spawn:     ['spawn', 'stop'],
  reply:     ['reply'],
  progress:  ['progress'],
  specclaw:  ['specclaw_status_changed'],
  scheduler: ['scheduler_fired'],
}

const CATEGORY_LABELS: Record<string, string> = {
  all:       'All',
  error:     'Stall',
  spawn:     'Spawn',
  reply:     'Reply',
  progress:  'Progress',
  specclaw:  'Specclaw',
  scheduler: 'Scheduler',
}

const CATEGORY_COLORS: Record<string, string> = {
  all:       '#00F5FF',
  error:     '#EF4444',
  spawn:     '#00F5FF',
  reply:     '#4ADE80',
  progress:  '#F59E0B',
  specclaw:  '#A855F7',
  scheduler: '#FCD34D',
}

const TYPE_BADGE: Record<string, string> = {
  spawn:                   'text-cyber-cyan   bg-cyber-cyan/12   border-cyber-cyan/25',
  reply:                   'text-green-400    bg-green-400/10    border-green-400/20',
  stop:                    'text-orange-400   bg-orange-400/10   border-orange-400/20',
  progress:                'text-cyber-amber  bg-cyber-amber/10  border-cyber-amber/20',
  error:                   'text-cyber-crimson bg-cyber-crimson/12 border-cyber-crimson/30',
  error_event:             'text-cyber-crimson bg-cyber-crimson/12 border-cyber-crimson/30',
  watchdog:                'text-cyber-crimson bg-cyber-crimson/12 border-cyber-crimson/30',
  specclaw_status_changed: 'text-purple-400   bg-purple-400/10   border-purple-400/20',
  scheduler_fired:         'text-yellow-300   bg-yellow-300/10   border-yellow-300/20',
}

const TYPE_LEFT_BORDER: Record<string, string> = {
  error:                   'border-l-cyber-crimson',
  error_event:             'border-l-cyber-crimson',
  watchdog:                'border-l-cyber-crimson',
  spawn:                   'border-l-cyber-cyan',
  reply:                   'border-l-green-400',
  progress:                'border-l-cyber-amber',
  specclaw_status_changed: 'border-l-purple-400',
  scheduler_fired:         'border-l-yellow-300',
}

const STORAGE_KEY = 'mc_event_filter'
const MAX_EVENTS = 500

function badgeClass(type: string): string {
  return TYPE_BADGE[type] ?? 'text-slate-300 bg-slate-700/40 border-slate-600/30'
}

function isUrgent(type: string): boolean {
  return type === 'error' || type === 'error_event' || type === 'watchdog'
}

function typeToCategory(type: string): string {
  for (const [cat, types] of Object.entries(CATEGORY_TYPES)) {
    if (types.includes(type)) return cat
  }
  return 'other'
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  return `${hh}:${mm}:${ss}`
}

function summarize(payload: unknown): string {
  try {
    const s = typeof payload === 'string' ? payload : JSON.stringify(payload)
    return s.length > 80 ? s.slice(0, 77) + '...' : s
  } catch {
    return String(payload)
  }
}

let counter = 0
function nextId(): string {
  return String(++counter)
}

interface Props {
  onEvent?: (e: EventEntry) => void
}

const ALL_CATEGORIES = ['all', 'error', 'spawn', 'reply', 'progress', 'specclaw', 'scheduler']

export default function EventFeed({ onEvent }: Props = {}) {
  const [events, setEvents] = useState<EventEntry[]>([])
  const [filter, setFilter] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem(STORAGE_KEY) ?? 'all'
    }
    return 'all'
  })
  const [compact, setCompact] = useState(false)
  const [paused, setPaused] = useState(false)
  const [connStatus, setConnStatus] = useState<'connected' | 'reconnecting' | 'disconnected'>('disconnected')
  const esRef = useRef<EventSource | null>(null)
  const seenIds = useRef<Set<string>>(new Set())
  const pendingRef = useRef<EventEntry[]>([])
  const pausedRef = useRef(false)

  // Keep pausedRef in sync
  useEffect(() => {
    pausedRef.current = paused
    if (!paused && pendingRef.current.length > 0) {
      const batch = pendingRef.current
      pendingRef.current = []
      setEvents((prev) => {
        let next = [...prev]
        for (const entry of batch) {
          const urgent = next.filter((ev) => isUrgent(ev.type))
          const normal = next.filter((ev) => !isUrgent(ev.type))
          next = isUrgent(entry.type)
            ? [entry, ...urgent, ...normal]
            : [...urgent, entry, ...normal]
        }
        return next.slice(0, MAX_EVENTS)
      })
    }
  }, [paused])

  // Persist filter
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, filter)
    }
  }, [filter])

  const addEvent = useCallback((entry: EventEntry) => {
    onEvent?.(entry)
    if (pausedRef.current) {
      pendingRef.current = [...pendingRef.current, entry].slice(-50)
      return
    }
    setEvents((prev) => {
      const urgent = prev.filter((ev) => isUrgent(ev.type))
      const normal = prev.filter((ev) => !isUrgent(ev.type))
      const next = isUrgent(entry.type)
        ? [entry, ...urgent, ...normal]
        : [...urgent, entry, ...normal]
      return next.slice(0, MAX_EVENTS)
    })
  }, [onEvent])

  useEffect(() => {
    fetch('/api/events?limit=200')
      .then((r) => r.json())
      .then((rows: Array<Record<string, unknown>>) => {
        const historical: EventEntry[] = rows.map((row) => {
          const dbId = String(row['id'] ?? '')
          seenIds.current.add(dbId)
          return {
            id: dbId || nextId(),
            ts: typeof row['created_at'] === 'number' ? row['created_at'] * 1000 : Date.now(),
            type: typeof row['type'] === 'string' ? row['type'] : 'unknown',
            instance_id: typeof row['instance_id'] === 'string' ? row['instance_id'] : '',
            payload: typeof row['payload'] === 'string' ? JSON.parse(row['payload']) : row,
          }
        })
        setEvents(historical.slice(0, MAX_EVENTS))
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    let cancelled = false
    let timeoutId: ReturnType<typeof setTimeout> | null = null
    let backoff = 1_000
    const MAX_BACKOFF = 30_000

    function connectSSE() {
      if (cancelled) return
      const es = new EventSource('/api/events/stream')
      esRef.current = es

      function handleMsg(e: MessageEvent) {
        let parsed: Record<string, unknown>
        try {
          parsed = JSON.parse(e.data)
        } catch {
          parsed = { raw: e.data }
        }

        // Skip fleet-update and stall-alert events — handled by FleetContext
        const msgType = typeof parsed['type'] === 'string' ? parsed['type'] : (e.type || 'unknown')
        if (msgType === 'fleet-update' || msgType === 'stall-alert') return

        const entry: EventEntry = {
          id: nextId(),
          ts: typeof parsed['ts'] === 'number' ? parsed['ts'] : Date.now(),
          type: msgType,
          instance_id: typeof parsed['instance_id'] === 'string' ? parsed['instance_id'] : '',
          payload: parsed,
        }

        addEvent(entry)
      }

      es.onopen = () => {
        setConnStatus('connected')
        backoff = 1_000
      }
      es.onerror = () => {
        setConnStatus('reconnecting')
        es.close()
        if (!cancelled) {
          timeoutId = setTimeout(() => {
            backoff = Math.min(backoff * 2, MAX_BACKOFF)
            connectSSE()
          }, backoff)
        }
      }
      es.onmessage = handleMsg
      for (const t of ['spawn','stop','reply','error_event','progress','watchdog','specclaw_status_changed','scheduler_fired']) {
        es.addEventListener(t, (e) => handleMsg(e as MessageEvent))
      }
    }

    connectSSE()

    return () => {
      cancelled = true
      if (timeoutId) clearTimeout(timeoutId)
      esRef.current?.close()
    }
  }, [addEvent])

  function handleClickEvent(ev: EventEntry) {
    if (!ev.instance_id) return
    const url = new URL(window.location.href)
    const current = url.searchParams.get('instance')
    if (current === ev.instance_id) {
      url.searchParams.delete('instance')
    } else {
      url.searchParams.set('instance', ev.instance_id)
    }
    window.history.pushState({}, '', url.toString())
    window.dispatchEvent(new PopStateEvent('popstate'))
  }

  const visible = filter === 'all'
    ? events
    : events.filter((ev) => typeToCategory(ev.type) === filter)

  return (
    <GlassCard className="flex flex-col gap-3 p-4 h-full">
      {/* Filter chips */}
      <div className="flex flex-wrap gap-1.5">
        {ALL_CATEGORIES.map((cat) => {
          const active = filter === cat
          const color = CATEGORY_COLORS[cat] ?? '#94a3b8'
          const count = cat === 'all' ? events.length : events.filter((ev) => typeToCategory(ev.type) === cat).length
          return (
            <button
              key={cat}
              onClick={() => setFilter(cat)}
              className="text-[0.6rem] px-2 py-0.5 rounded font-mono font-bold uppercase tracking-wider transition-all"
              style={{
                color: active ? color : '#64748b',
                border: `1px solid ${active ? color + '60' : '#334155'}`,
                background: active ? `${color}18` : 'transparent',
              }}
            >
              {CATEGORY_LABELS[cat] ?? cat}
              {count > 0 && <span className="ml-1 opacity-60">{count}</span>}
            </button>
          )
        })}
        <div className="flex-1" />
        <button
          onClick={() => setCompact((c) => !c)}
          className="text-[0.6rem] px-2 py-0.5 rounded border border-cyber-cyan/20 text-slate-500 hover:text-cyber-cyan hover:border-cyber-cyan/40 transition-colors font-mono"
        >
          {compact ? 'Expanded' : 'Compact'}
        </button>
      </div>

      {/* Status row */}
      <div className="flex items-center gap-2">
        <span
          className={`shrink-0 w-2 h-2 rounded-full ${
            connStatus === 'connected'
              ? 'bg-cyber-cyan'
              : connStatus === 'reconnecting'
              ? 'bg-cyber-amber animate-pulse'
              : 'bg-slate-600'
          }`}
          title={connStatus}
        />
        {connStatus === 'reconnecting' && (
          <span className="text-xs text-cyber-amber">reconnecting…</span>
        )}
        {paused && (
          <span className="text-[0.6rem] font-mono font-bold px-1.5 py-0.5 rounded animate-pulse"
            style={{ color: '#F59E0B', background: '#F59E0B18', border: '1px solid #F59E0B40' }}>
            PAUSED {pendingRef.current.length > 0 ? `+${pendingRef.current.length}` : ''}
          </span>
        )}
        <span className="ml-auto text-xs text-slate-600 tabular-nums font-mono">
          {visible.length}/{MAX_EVENTS}
        </span>
      </div>

      {/* Event list — pause on hover */}
      <div
        className="flex flex-col gap-0.5 font-mono text-xs overflow-y-auto max-h-[540px] pr-1"
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
      >
        {visible.length === 0 && (
          <div className="text-slate-600 py-12 text-center">
            <div className="text-2xl mb-2 opacity-20">◈</div>
            <span>Awaiting events…</span>
          </div>
        )}
        <AnimatePresence initial={false}>
          {visible.map((ev) => {
            const leftBorder = TYPE_LEFT_BORDER[ev.type]
            return (
              <motion.div
                key={ev.id}
                initial={{ x: -12, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.12, ease: 'easeOut' }}
                className={`
                  flex items-baseline gap-2 rounded px-2.5 py-1.5
                  hover:bg-white/4 transition-colors cursor-pointer
                  border-l-2
                  ${leftBorder ?? 'border-l-transparent'}
                `}
                onClick={() => handleClickEvent(ev)}
                title={ev.instance_id ? `Click to highlight ${ev.instance_id}` : undefined}
              >
                <span className="text-slate-600 shrink-0 w-[52px] tabular-nums">{formatTime(ev.ts)}</span>
                <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[0.6rem] font-bold tracking-wide uppercase ${badgeClass(ev.type)}`}>
                  {ev.type.replace(/_/g, ' ')}
                </span>
                {!compact && (
                  <>
                    <span className="text-slate-700 shrink-0 w-16 truncate" title={ev.instance_id}>
                      {ev.instance_id ? ev.instance_id.slice(0, 8) : '—'}
                    </span>
                    <span className="text-slate-400 truncate">{summarize(ev.payload)}</span>
                  </>
                )}
              </motion.div>
            )
          })}
        </AnimatePresence>
      </div>
    </GlassCard>
  )
}
