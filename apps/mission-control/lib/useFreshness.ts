'use client'

import { useEffect, useRef, useState } from 'react'

export interface Freshness<T> {
  data: T | null
  isStale: boolean
  lastError: string | null
  lastSuccessAt: number | null
}

/**
 * P161 Stale Data Sentinel — shared fetch+interval wrapper for polling views.
 *
 * Polls `url` every `intervalMs`. Surfaces whether the feed is live, stale
 * (no successful fetch within `staleMultiplier`× the interval), or offline
 * (the most recent fetch errored or returned non-2xx). Pure client-side
 * derivation — no new server route.
 */
export function useFreshness<T = unknown>(
  url: string,
  intervalMs: number,
  staleMultiplier = 2.5,
): Freshness<T> {
  const [data, setData] = useState<T | null>(null)
  const [lastError, setLastError] = useState<string | null>(null)
  const [lastSuccessAt, setLastSuccessAt] = useState<number | null>(null)
  // Tick forces a re-render so `isStale` recomputes between fetches.
  const [, setTick] = useState(0)
  const aliveRef = useRef(true)

  useEffect(() => {
    aliveRef.current = true

    async function load() {
      try {
        const res = await fetch(url)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const json = (await res.json()) as T
        if (!aliveRef.current) return
        setData(json)
        setLastError(null)
        setLastSuccessAt(Date.now())
      } catch (err) {
        if (!aliveRef.current) return
        setLastError(err instanceof Error ? err.message : 'fetch failed')
      }
    }

    load()
    const poll = setInterval(load, intervalMs)
    // Half-interval heartbeat so the stale countdown advances without a fetch.
    const heartbeat = setInterval(() => setTick((t) => t + 1), Math.max(1000, intervalMs / 2))
    return () => {
      aliveRef.current = false
      clearInterval(poll)
      clearInterval(heartbeat)
    }
  }, [url, intervalMs])

  const staleThreshold = intervalMs * staleMultiplier
  const isStale =
    lastSuccessAt === null ? false : Date.now() - lastSuccessAt > staleThreshold

  return { data, isStale, lastError, lastSuccessAt }
}
