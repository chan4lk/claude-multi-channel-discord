'use client'

import { useEffect, useRef, useState } from 'react'

interface EventEntry {
  id: string
  ts: number
  type: string
  instance_id: string
  payload: unknown
}

const TYPE_COLORS: Record<string, string> = {
  message: 'bg-blue-700 text-blue-100',
  reply: 'bg-green-700 text-green-100',
  error: 'bg-red-700 text-red-100',
  spawn: 'bg-purple-700 text-purple-100',
  stop: 'bg-orange-700 text-orange-100',
  progress: 'bg-yellow-700 text-yellow-100',
  watchdog: 'bg-pink-700 text-pink-100',
}

function badgeClass(type: string): string {
  return TYPE_COLORS[type] ?? 'bg-gray-700 text-gray-100'
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

export default function EventFeed() {
  const [events, setEvents] = useState<EventEntry[]>([])
  const [filter, setFilter] = useState<string>('all')
  const [types, setTypes] = useState<string[]>([])
  const esRef = useRef<EventSource | null>(null)

  useEffect(() => {
    const es = new EventSource('/api/events')
    esRef.current = es

    es.onmessage = (e) => {
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

      setEvents((prev) => {
        const next = [entry, ...prev].slice(0, 100)
        return next
      })

      setTypes((prev) => {
        if (!prev.includes(entry.type)) return [...prev, entry.type].sort()
        return prev
      })
    }

    es.addEventListener('spawn', (e) => es.onmessage?.(e as MessageEvent))
    es.addEventListener('stop', (e) => es.onmessage?.(e as MessageEvent))
    es.addEventListener('reply', (e) => es.onmessage?.(e as MessageEvent))
    es.addEventListener('error_event', (e) => es.onmessage?.(e as MessageEvent))
    es.addEventListener('progress', (e) => es.onmessage?.(e as MessageEvent))
    es.addEventListener('watchdog', (e) => es.onmessage?.(e as MessageEvent))

    return () => {
      es.close()
    }
  }, [])

  const visible = filter === 'all' ? events : events.filter((ev) => ev.type === filter)

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <label htmlFor="type-filter" className="text-sm text-gray-400 shrink-0">
          Filter by type:
        </label>
        <select
          id="type-filter"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="bg-gray-800 border border-gray-600 rounded px-2 py-1 text-sm text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          <option value="all">all</option>
          {types.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <span className="ml-auto text-xs text-gray-500">{visible.length} event(s)</span>
      </div>

      <div className="flex flex-col gap-1 font-mono text-xs">
        {visible.length === 0 && (
          <div className="text-gray-500 py-4 text-center">Waiting for events…</div>
        )}
        {visible.map((ev) => (
          <div
            key={ev.id}
            className="flex items-baseline gap-2 rounded bg-gray-900 px-3 py-1.5 hover:bg-gray-800 transition-colors"
          >
            <span className="text-gray-400 shrink-0 w-20">{formatTime(ev.ts)}</span>
            <span
              className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-semibold ${badgeClass(ev.type)}`}
            >
              {ev.type}
            </span>
            <span className="text-gray-400 shrink-0 w-20 truncate" title={ev.instance_id}>
              {ev.instance_id ? ev.instance_id.slice(0, 8) : '—'}
            </span>
            <span className="text-gray-300 truncate">{summarize(ev.payload)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
