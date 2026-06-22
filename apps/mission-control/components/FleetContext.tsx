'use client'

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import type { FleetResponse } from '../app/api/fleet/route'
import type { StallEntry } from '../app/api/stalls/route'

export type SseStatus = 'connected' | 'reconnecting' | 'disconnected'

export interface ToolEvent {
  slug: string
  toolName: string
  id: number
}

export type NotificationType = 'stall' | 'budget' | 'circuit-open' | 'watchdog'

export interface Notification {
  id: number
  ts: string
  type: NotificationType
  slug: string
  description: string
  read: boolean
}

export interface FleetContextValue {
  fleet: FleetResponse | null
  stalls: StallEntry[]
  stalledAt: string | null
  sseStatus: SseStatus
  toolEvents: ToolEvent[]
  notifications: Notification[]
  unreadCount: number
  markRead: (id: number) => void
  markAllRead: () => void
}

const FleetContext = createContext<FleetContextValue>({
  fleet: null,
  stalls: [],
  stalledAt: null,
  sseStatus: 'disconnected',
  toolEvents: [],
  notifications: [],
  unreadCount: 0,
  markRead: () => {},
  markAllRead: () => {},
})

export function useFleet(): FleetContextValue {
  return useContext(FleetContext)
}

const MIN_BACKOFF = 1_000
const MAX_BACKOFF = 30_000

const MAX_TOOL_EVENTS = 200
const MAX_NOTIFICATIONS = 50
let toolEventIdCounter = 0
let notifIdCounter = 0

const NOTIF_STORAGE_KEY = 'mc_notif_read'

function loadReadSet(): Set<number> {
  try {
    const raw = sessionStorage.getItem(NOTIF_STORAGE_KEY)
    if (!raw) return new Set()
    return new Set(JSON.parse(raw) as number[])
  } catch {
    return new Set()
  }
}

function saveReadSet(ids: Set<number>): void {
  try {
    sessionStorage.setItem(NOTIF_STORAGE_KEY, JSON.stringify([...ids]))
  } catch {}
}

export function FleetContextProvider({ children }: { children: React.ReactNode }) {
  const [fleet, setFleet] = useState<FleetResponse | null>(null)
  const [stalls, setStalls] = useState<StallEntry[]>([])
  const [stalledAt, setStalledAt] = useState<string | null>(null)
  const [sseStatus, setSseStatus] = useState<SseStatus>('disconnected')
  const [toolEvents, setToolEvents] = useState<ToolEvent[]>([])
  const [notifications, setNotifications] = useState<Notification[]>([])
  const readSetRef = useRef<Set<number>>(new Set())
  const esRef = useRef<EventSource | null>(null)
  const backoffRef = useRef(MIN_BACKOFF)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cancelledRef = useRef(false)

  useEffect(() => {
    readSetRef.current = loadReadSet()
  }, [])

  const addNotification = useCallback((type: NotificationType, slug: string, description: string) => {
    const id = ++notifIdCounter
    const notif: Notification = { id, ts: new Date().toISOString(), type, slug, description, read: false }
    setNotifications((prev) => {
      const next = [notif, ...prev].slice(0, MAX_NOTIFICATIONS)
      return next.map((n) => ({ ...n, read: readSetRef.current.has(n.id) }))
    })
  }, [])

  const markRead = useCallback((id: number) => {
    readSetRef.current.add(id)
    saveReadSet(readSetRef.current)
    setNotifications((prev) => prev.map((n) => n.id === id ? { ...n, read: true } : n))
  }, [])

  const markAllRead = useCallback(() => {
    setNotifications((prev) => {
      const next = prev.map((n) => ({ ...n, read: true }))
      for (const n of next) readSetRef.current.add(n.id)
      saveReadSet(readSetRef.current)
      return next
    })
  }, [])

  // Fetch initial data via REST as fallback
  useEffect(() => {
    fetch('/api/fleet')
      .then((r) => r.json())
      .then((data) => setFleet(data as FleetResponse))
      .catch(() => {})
    fetch('/api/stalls')
      .then((r) => r.json())
      .then((data: { stalls: StallEntry[]; checkedAt: string }) => {
        setStalls(data.stalls ?? [])
        setStalledAt(data.checkedAt ?? null)
      })
      .catch(() => {})
  }, [])

  const connect = useCallback(() => {
    if (cancelledRef.current) return
    const es = new EventSource('/api/events/stream')
    esRef.current = es

    es.onopen = () => {
      setSseStatus('connected')
      backoffRef.current = MIN_BACKOFF
    }

    es.onerror = () => {
      setSseStatus('reconnecting')
      es.close()
      esRef.current = null
      if (!cancelledRef.current) {
        timerRef.current = setTimeout(() => {
          backoffRef.current = Math.min(backoffRef.current * 2, MAX_BACKOFF)
          connect()
        }, backoffRef.current)
      }
    }

    es.onmessage = (e: MessageEvent) => {
      let parsed: { type?: string; data?: unknown }
      try {
        parsed = JSON.parse(e.data)
      } catch {
        return
      }
      if (parsed.type === 'fleet-update') {
        setFleet(parsed.data as FleetResponse)
      } else if (parsed.type === 'stall-alert') {
        const d = parsed.data as { stalls: StallEntry[]; checkedAt: string }
        setStalls(d.stalls ?? [])
        setStalledAt(d.checkedAt ?? null)
        for (const s of d.stalls ?? []) {
          addNotification('stall', (s as { slug?: string }).slug ?? '', `Stall detected`)
        }
      } else if (parsed.type === 'budget-alert') {
        const d = parsed.data as { slug: string; thresholdLabel: string; pct: number }
        addNotification('budget', d.slug ?? '', `Budget threshold hit: ${d.thresholdLabel} (${d.pct}% used)`)
      } else if (parsed.type === 'circuit-open') {
        const d = parsed.data as { slug?: string; reason?: string }
        addNotification('circuit-open', d.slug ?? '', `Circuit breaker opened${d.reason ? ': ' + d.reason : ''}`)
      } else if (parsed.type === 'tool-event') {
        const d = parsed.data as { slug: string; toolName: string }
        const ev: ToolEvent = { slug: d.slug, toolName: d.toolName, id: ++toolEventIdCounter }
        setToolEvents((prev) => [...prev.slice(-MAX_TOOL_EVENTS + 1), ev])
      }
    }
  }, [])

  useEffect(() => {
    cancelledRef.current = false
    connect()
    return () => {
      cancelledRef.current = true
      if (timerRef.current) clearTimeout(timerRef.current)
      esRef.current?.close()
      esRef.current = null
    }
  }, [connect])

  const unreadCount = notifications.filter((n) => !n.read).length

  return (
    <FleetContext.Provider value={{ fleet, stalls, stalledAt, sseStatus, toolEvents, notifications, unreadCount, markRead, markAllRead }}>
      {children}
    </FleetContext.Provider>
  )
}
