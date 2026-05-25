'use client'

import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import GlassCard from './ui/GlassCard'

interface EventEntry {
  id: string
  ts: number
  type: string
  instance_id: string
  payload: Record<string, unknown>
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
  error:       'border-l-cyber-crimson',
  error_event: 'border-l-cyber-crimson',
  watchdog:    'border-l-cyber-crimson',
  spawn:       'border-l-cyber-cyan',
  reply:       'border-l-green-400',
  progress:    'border-l-cyber-amber',
}

function badgeClass(type: string): string {
  return TYPE_BADGE[type] ?? 'text-slate-300 bg-slate-700/40 border-slate-600/30'
}

function isUrgent(type: string): boolean {
  return type === 'error' || type === 'error_event' || type === 'watchdog'
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

export default function EventFeed({ onEvent }: Props = {}) {
  const [events, setEvents] = useState<EventEntry[]>([])
  const [filter, setFilter] = useState<string>('all')
  const [types, setTypes] = useState<string[]>([])
  const [compact, setCompact] = useState(false)
  const esRef = useRef<EventSource | null>(null)
  const seenIds = useRef<Set<string>>(new Set())

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
        setEvents(historical)
        setTypes((prev) => {
          const all = new Set([...prev, ...historical.map((e) => e.type)])
          return [...all].sort()
        })
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    const es = new EventSource('/api/events/stream')
    esRef.current = es

    function handleMsg(e: MessageEvent) {
      let parsed: Record<string, unknown>
      try {
        parsed = JSON.parse(e.data)
      } catch {
        parsed = { raw: e.data }
      }

      const entry: EventEntry = {
        id: nextId(),
        ts: typeof parsed['ts'] === 'number' ? parsed['ts'] : Date.now(),
        type: typeof parsed['type'] === 'string' ? parsed['type'] : (e.type || 'unknown'),
        instance_id: typeof parsed['instance_id'] === 'string' ? parsed['instance_id'] : '',
        payload: parsed,
      }

      onEvent?.(entry)

      setEvents((prev) => {
        const urgent = prev.filter((ev) => isUrgent(ev.type))
        const normal = prev.filter((ev) => !isUrgent(ev.type))
        const next = isUrgent(entry.type)
          ? [entry, ...urgent, ...normal]
          : [...urgent, entry, ...normal]
        return next.slice(0, 200)
      })

      setTypes((prev) => prev.includes(entry.type) ? prev : [...prev, entry.type].sort())
    }

    es.onmessage = handleMsg
    for (const t of ['spawn','stop','reply','error_event','progress','watchdog','specclaw_status_changed','scheduler_fired']) {
      es.addEventListener(t, (e) => handleMsg(e as MessageEvent))
    }

    return () => es.close()
  }, [])

  const visible = filter === 'all' ? events : events.filter((ev) => ev.type === filter)

  return (
    <GlassCard className="flex flex-col gap-3 p-4 h-full">
      {/* Controls row */}
      <div className="flex items-center gap-2 flex-wrap">
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="cyber-input px-2 py-1 text-xs cursor-pointer"
          aria-label="Filter by event type"
        >
          <option value="all">All types</option>
          {types.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <button
          onClick={() => setCompact((c) => !c)}
          className="text-xs px-2.5 py-1 rounded border border-cyber-cyan/20 text-slate-400 hover:text-cyber-cyan hover:border-cyber-cyan/45 transition-colors cursor-pointer"
          aria-pressed={compact}
        >
          {compact ? 'Expanded' : 'Compact'}
        </button>
        <span className="ml-auto text-xs text-slate-600 tabular-nums font-mono">
          {visible.length} events
        </span>
      </div>

      {/* Event list */}
      <div className="flex flex-col gap-0.5 font-mono text-xs overflow-y-auto max-h-[580px] pr-1">
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
                  hover:bg-white/4 transition-colors
                  border-l-2
                  ${leftBorder ?? 'border-l-transparent'}
                `}
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
