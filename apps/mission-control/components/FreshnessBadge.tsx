'use client'

import { useEffect, useState } from 'react'

interface Props {
  isStale: boolean
  lastError: string | null
  lastSuccessAt: number | null
}

/**
 * P161 Stale Data Sentinel — compact live / stale / offline indicator.
 * Drop into a page header beside the title; feed it a `useFreshness` result.
 */
export default function FreshnessBadge({ isStale, lastError, lastSuccessAt }: Props) {
  // Re-render once a second so the "stale Ns" age ticks up.
  const [, setTick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [])

  let state: 'live' | 'stale' | 'offline'
  if (lastError && lastSuccessAt === null) state = 'offline'
  else if (lastError) state = 'offline'
  else if (isStale) state = 'stale'
  else state = 'live'

  const ageSecs = lastSuccessAt ? Math.round((Date.now() - lastSuccessAt) / 1000) : null

  const cfg = {
    live: { color: '#4ADE80', label: 'live', pulse: false },
    stale: { color: '#F59E0B', label: ageSecs !== null ? `stale ${ageSecs}s` : 'stale', pulse: true },
    offline: { color: '#EF4444', label: 'offline', pulse: true },
  }[state]

  return (
    <span
      className="flex items-center gap-1.5 text-[0.55rem] font-mono uppercase tracking-wider px-2 py-0.5 rounded border"
      style={{ color: cfg.color, borderColor: `${cfg.color}40`, background: `${cfg.color}10` }}
      title={lastError ? `Last error: ${lastError}` : lastSuccessAt ? `Last update ${ageSecs}s ago` : 'Awaiting first fetch'}
    >
      <span
        style={{
          width: 7, height: 7, borderRadius: 999, background: cfg.color, display: 'inline-block',
          boxShadow: `0 0 5px ${cfg.color}`,
          animation: cfg.pulse ? 'mc-fresh-pulse 1.4s ease-in-out infinite' : undefined,
        }}
      />
      {cfg.label}
      <style>{`@keyframes mc-fresh-pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }`}</style>
    </span>
  )
}
