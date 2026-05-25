'use client'

import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import GlassCard from './ui/GlassCard'

interface EventEntry {
  id: string
  ts: number
  type: string
  instance_id: string
  payload: unknown
}

const TYPE_COLORS: Record<string, string> = {
  spawn:                  'text-cyber-cyan   bg-cyber-cyan/10',
  reply:                  'text-green-400    bg-green-400/10',
  stop:                   'text-orange-400   bg-orange-400/10',
  progress:               'text-cyber-amber  bg-cyber-amber/10',
  error:                  'text-cyber-crimson bg-cyber-crimson/10',
  error_event:            'text-cyber-crimson bg-cyber-crimson/10',
  watchdog:               'text-cyber-crimson bg-cyber-crimson/10',
  specclaw_status_changed:'text-purple-400   bg-purple-400/10',
  scheduler_fired:        'text-yellow-300   bg-yellow-300/10',
}

function badgeClass(type: string): string {
  return TYPE_COLORS[type] ?? 'text-slate-300 bg-slate-700/50'
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

  // Fetch historical events on mount
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
      {/* Controls */}
      <div className="flex items-center gap-3 flex-wrap">
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="bg-cyber-panel border border-cyber-cyan/20 rounded px-2 py-1 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-cyber-cyan/50"
        >
          <option value="all">all types</option>
          {types.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <button
          onClick={() => setCompact((c) => !c)}
          className="text-xs px-2 py-1 rounded border border-cyber-cyan/20 text-slate-400 hover:text-cyber-cyan hover:border-cyber-cyan/50 transition-colors"
        >
          {compact ? 'expanded' : 'compact'}
        </button>
        <span className="ml-auto text-xs text-slate-600">{visible.length} events</span>
      </div>

      {/* Event list */}
      <div className="flex flex-col gap-1 font-mono text-xs overflow-y-auto max-h-[600px]">
        {visible.length === 0 && (
          <div className="text-slate-500 py-8 text-center">Waiting for events…</div>
        )}
        <AnimatePresence initial={false}>
          {visible.map((ev) => (
            <motion.div
              key={ev.id}
              initial={{ x: -16, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className={`flex items-baseline gap-2 rounded px-3 py-1.5 hover:bg-white/5 transition-colors ${
                isUrgent(ev.type) ? 'border-l-2 border-cyber-crimson' : ''
              }`}
            >
              <span className="text-slate-500 shrink-0 w-20">{formatTime(ev.ts)}</span>
              <span className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-semibold ${badgeClass(ev.type)}`}>
                {ev.type}
              </span>
              {!compact && (
                <>
                  <span className="text-slate-600 shrink-0 w-20 truncate font-mono" title={ev.instance_id}>
                    {ev.instance_id ? ev.instance_id.slice(0, 8) : '—'}
                  </span>
                  <span className="text-slate-400 truncate">{summarize(ev.payload)}</span>
                </>
              )}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </GlassCard>
  )
}
