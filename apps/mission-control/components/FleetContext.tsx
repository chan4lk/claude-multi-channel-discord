'use client'

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import type { FleetResponse } from '../app/api/fleet/route'
import type { StallEntry } from '../app/api/stalls/route'

export type SseStatus = 'connected' | 'reconnecting' | 'disconnected'

export interface FleetContextValue {
  fleet: FleetResponse | null
  stalls: StallEntry[]
  stalledAt: string | null
  sseStatus: SseStatus
}

const FleetContext = createContext<FleetContextValue>({
  fleet: null,
  stalls: [],
  stalledAt: null,
  sseStatus: 'disconnected',
})

export function useFleet(): FleetContextValue {
  return useContext(FleetContext)
}

const MIN_BACKOFF = 1_000
const MAX_BACKOFF = 30_000

export function FleetContextProvider({ children }: { children: React.ReactNode }) {
  const [fleet, setFleet] = useState<FleetResponse | null>(null)
  const [stalls, setStalls] = useState<StallEntry[]>([])
  const [stalledAt, setStalledAt] = useState<string | null>(null)
  const [sseStatus, setSseStatus] = useState<SseStatus>('disconnected')
  const esRef = useRef<EventSource | null>(null)
  const backoffRef = useRef(MIN_BACKOFF)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cancelledRef = useRef(false)

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

  return (
    <FleetContext.Provider value={{ fleet, stalls, stalledAt, sseStatus }}>
      {children}
    </FleetContext.Provider>
  )
}
