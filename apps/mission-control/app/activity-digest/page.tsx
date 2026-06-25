'use client'

import { Suspense, useState } from 'react'
import Link from 'next/link'
import { useSearchParams, useRouter } from 'next/navigation'
import type { ActivityDigestResponse } from '../api/activity-digest/route'
import { useFreshness } from '../../lib/useFreshness'
import FreshnessBadge from '../../components/FreshnessBadge'

const HOUR_OPTIONS = [6, 12, 24, 48, 72] as const
type HourOption = typeof HOUR_OPTIONS[number]

function deltaColor(delta: number | null): string {
  if (delta === null) return '#475569'
  if (delta > 20) return '#4ade80'
  if (delta > 0) return '#86efac'
  if (delta > -20) return '#f59e0b'
  return '#ef4444'
}

function deltaLabel(delta: number | null): string {
  if (delta === null) return '—'
  const sign = delta > 0 ? '+' : ''
  return `${sign}${delta}%`
}

function ActivityDigestInner() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const [hours, setHours] = useState<HourOption>(() => {
    const raw = Number(searchParams.get('hours') ?? '24')
    return (HOUR_OPTIONS.includes(raw as HourOption) ? raw : 24) as HourOption
  })

  const { data, isStale, lastError, lastSuccessAt } = useFreshness<ActivityDigestResponse>(
    `/api/activity-digest?hours=${hours}`,
    60_000,
  )

  function handleHoursChange(h: HourOption) {
    setHours(h)
    const params = new URLSearchParams(searchParams.toString())
    params.set('hours', String(h))
    router.replace(`?${params.toString()}`)
  }

  const loading = data === null && lastError === null

  if (loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center" style={{ background: '#060d1a' }}>
        <div className="text-xs font-mono text-slate-600 animate-pulse">Building activity digest…</div>
      </div>
    )
  }

  const projects = data?.projects ?? []
  const hasAlerts = (data?.watchdogKills ?? 0) > 0 || (data?.circuitTrips ?? 0) > 0

  return (
    <div className="min-h-dvh flex flex-col" style={{ background: '#060d1a' }}>
      <header className="sticky top-0 z-30 border-b border-cyber-cyan/12 bg-[#060d1a]/90 backdrop-blur-md px-6 py-3">
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-cyber-cyan/40 to-transparent" />
        <div className="flex items-center gap-3 flex-wrap">
          <Link href="/" className="text-[0.6rem] font-mono text-slate-500 hover:text-cyber-cyan transition-colors uppercase tracking-wider">← Dashboard</Link>
          <h1 className="text-sm font-black tracking-[0.18em] text-cyber-cyan" style={{ fontFamily: 'Orbitron, JetBrains Mono, monospace' }}>
            Activity Digest
          </h1>
          <FreshnessBadge isStale={isStale} lastError={lastError} lastSuccessAt={lastSuccessAt} />
          <div className="flex gap-1 ml-2">
            {HOUR_OPTIONS.map((h) => (
              <button
                key={h}
                onClick={() => handleHoursChange(h)}
                className="px-2 py-0.5 text-[0.5rem] rounded border transition-colors font-mono"
                style={{
                  background: hours === h ? 'rgba(0,245,255,0.15)' : 'transparent',
                  borderColor: hours === h ? 'rgba(0,245,255,0.5)' : 'rgba(100,116,139,0.3)',
                  color: hours === h ? '#00f5ff' : '#64748b',
                }}
              >
                {h}h
              </button>
            ))}
          </div>
          <div className="flex-1" />
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1">
              <span className="text-[0.5rem] font-mono text-slate-600">msgs</span>
              <span className="text-sm font-black tabular-nums text-cyber-cyan" style={{ fontFamily: 'Orbitron, monospace' }}>{data?.totalMessages ?? 0}</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-[0.5rem] font-mono text-slate-600">tools</span>
              <span className="text-sm font-black tabular-nums text-cyber-cyan" style={{ fontFamily: 'Orbitron, monospace' }}>{data?.totalToolCalls ?? 0}</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-[0.5rem] font-mono text-slate-600">memory</span>
              <span className="text-sm font-black tabular-nums text-cyber-cyan" style={{ fontFamily: 'Orbitron, monospace' }}>{data?.totalMemoryWrites ?? 0}</span>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 p-6 max-w-5xl mx-auto w-full flex flex-col gap-6">
        {/* Alert banner */}
        {hasAlerts && (
          <div
            className="rounded-xl border px-4 py-3"
            style={{ background: 'rgba(239,68,68,0.08)', borderColor: 'rgba(239,68,68,0.3)' }}
          >
            <div className="text-[0.6rem] font-mono font-bold text-red-400 mb-1 uppercase tracking-wider">Fleet Alerts</div>
            <div className="flex gap-6">
              {(data?.watchdogKills ?? 0) > 0 && (
                <div className="text-[0.55rem] font-mono">
                  <span className="text-red-400 font-bold">{data?.watchdogKills}</span>
                  <span className="text-slate-500 ml-1">watchdog kill{(data?.watchdogKills ?? 0) !== 1 ? 's' : ''}</span>
                </div>
              )}
              {(data?.circuitTrips ?? 0) > 0 && (
                <div className="text-[0.55rem] font-mono">
                  <span className="text-orange-400 font-bold">{data?.circuitTrips}</span>
                  <span className="text-slate-500 ml-1">circuit trip{(data?.circuitTrips ?? 0) !== 1 ? 's' : ''}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {projects.length === 0 ? (
          <div className="h-64 flex items-center justify-center text-slate-600 text-xs font-mono text-center px-6">
            No project activity in the last {hours}h.
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="grid grid-cols-[1fr_6rem_6rem_6rem_5rem_5rem_6rem] gap-2 px-3 text-[0.45rem] font-mono text-slate-600 uppercase tracking-wider">
              <span>Project</span>
              <span className="text-right">Messages</span>
              <span className="text-right">Tool Calls</span>
              <span className="text-right">Mem Writes</span>
              <span className="text-center">Watchdog</span>
              <span className="text-center">Circuit</span>
              <span className="text-right">Activity Δ</span>
            </div>

            {projects.map((p) => (
              <div
                key={p.slug}
                className="grid grid-cols-[1fr_6rem_6rem_6rem_5rem_5rem_6rem] gap-2 items-center px-3 py-2 rounded-lg"
                style={{
                  background: p.hadWatchdogKill || p.hadCircuitTrip
                    ? 'rgba(239,68,68,0.05)'
                    : 'rgba(255,255,255,0.02)',
                  border: `1px solid ${p.hadWatchdogKill || p.hadCircuitTrip ? 'rgba(239,68,68,0.15)' : 'rgba(255,255,255,0.04)'}`,
                }}
              >
                <span className="text-[0.6rem] font-mono text-slate-300 truncate" title={p.slug}>{p.slug}</span>

                {/* Message count with bar */}
                <div className="flex items-center gap-1 justify-end">
                  <span className="text-[0.6rem] font-mono text-slate-300 tabular-nums">{p.messageCount}</span>
                  <div className="w-8 h-1.5 rounded-sm overflow-hidden" style={{ background: '#0a1628' }}>
                    <div
                      className="h-full rounded-sm"
                      style={{
                        width: `${Math.min(100, (p.messageCount / Math.max(...projects.map(x => x.messageCount), 1)) * 100)}%`,
                        background: '#22d3ee',
                      }}
                    />
                  </div>
                </div>

                {/* Tool calls */}
                <div className="flex items-center gap-1 justify-end">
                  <span className="text-[0.6rem] font-mono text-slate-300 tabular-nums">{p.toolCallCount}</span>
                  <div className="w-8 h-1.5 rounded-sm overflow-hidden" style={{ background: '#0a1628' }}>
                    <div
                      className="h-full rounded-sm"
                      style={{
                        width: `${Math.min(100, (p.toolCallCount / Math.max(...projects.map(x => x.toolCallCount), 1)) * 100)}%`,
                        background: '#a78bfa',
                      }}
                    />
                  </div>
                </div>

                {/* Memory writes */}
                <div className="flex items-center gap-1 justify-end">
                  <span className="text-[0.6rem] font-mono text-slate-300 tabular-nums">{p.memoryWrites}</span>
                  <div className="w-8 h-1.5 rounded-sm overflow-hidden" style={{ background: '#0a1628' }}>
                    <div
                      className="h-full rounded-sm"
                      style={{
                        width: `${Math.min(100, (p.memoryWrites / Math.max(...projects.map(x => x.memoryWrites), 1)) * 100)}%`,
                        background: '#4ade80',
                      }}
                    />
                  </div>
                </div>

                {/* Watchdog */}
                <div className="text-center">
                  {p.hadWatchdogKill ? (
                    <span className="text-[0.55rem] font-mono text-red-400 font-bold">KILL</span>
                  ) : (
                    <span className="text-[0.5rem] font-mono text-slate-700">—</span>
                  )}
                </div>

                {/* Circuit */}
                <div className="text-center">
                  {p.hadCircuitTrip ? (
                    <span className="text-[0.55rem] font-mono text-orange-400 font-bold">TRIP</span>
                  ) : (
                    <span className="text-[0.5rem] font-mono text-slate-700">—</span>
                  )}
                </div>

                {/* Health delta */}
                <div className="text-right">
                  <span
                    className="text-[0.6rem] font-mono tabular-nums font-bold"
                    style={{ color: deltaColor(p.healthDelta) }}
                  >
                    {deltaLabel(p.healthDelta)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}

        <p className="text-[0.5rem] font-mono text-slate-700">
          Activity Δ compares token usage in second half of window vs first half (positive = accelerating).
          Memory writes = files modified in <code>memory/</code> dir within window.
          Watchdog/Circuit detected from project event log files. Refreshes every 60s.
        </p>
      </main>
    </div>
  )
}

export default function ActivityDigestPage() {
  return (
    <Suspense>
      <ActivityDigestInner />
    </Suspense>
  )
}
