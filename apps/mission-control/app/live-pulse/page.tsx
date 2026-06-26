'use client'

import { useEffect, useState, useCallback } from 'react'
import SubPageHeader from '../../components/SubPageHeader'
import type { LivePulseResponse, PulseProject } from '../api/live-pulse/route'

const POLL_MS = 3_000
const MIN_R = 18
const MAX_R = 48

function relTime(mtimeMs: number | null): string {
  if (!mtimeMs) return '—'
  const diff = Date.now() - mtimeMs
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return `${Math.floor(diff / 86_400_000)}d ago`
}

function circleRadius(avgTurnsPerDay: number, maxAvg: number): number {
  if (maxAvg <= 0) return MIN_R
  const ratio = Math.min(avgTurnsPerDay / maxAvg, 1)
  return MIN_R + ratio * (MAX_R - MIN_R)
}

function ProjectCircle({
  project,
  maxAvg,
}: {
  project: PulseProject
  maxAvg: number
}) {
  const [hover, setHover] = useState(false)
  const r = circleRadius(project.avgTurnsPerDay, maxAvg)
  const dia = r * 2
  const active = project.active

  return (
    <div
      className="relative flex flex-col items-center gap-1 cursor-default"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{ width: MAX_R * 2 + 8 }}
    >
      <svg
        width={dia + 8}
        height={dia + 8}
        style={{ overflow: 'visible' }}
      >
        <circle
          cx={r + 4}
          cy={r + 4}
          r={r}
          fill={active ? 'rgba(34,211,238,0.12)' : 'rgba(100,116,139,0.08)'}
          stroke={active ? '#22D3EE' : '#334155'}
          strokeWidth={active ? 1.5 : 1}
          style={active ? {
            filter: 'drop-shadow(0 0 8px rgba(34,211,238,0.6))',
            animation: 'pulse-ring 1.8s ease-in-out infinite',
          } : undefined}
        />
        {active && (
          <circle
            cx={r + 4}
            cy={r + 4}
            r={r * 0.35}
            fill="rgba(34,211,238,0.6)"
            style={{ animation: 'pulse-core 1.8s ease-in-out infinite' }}
          />
        )}
      </svg>
      <span
        className="font-mono text-center leading-tight truncate max-w-full px-1"
        style={{
          fontSize: '0.5rem',
          color: active ? '#22D3EE' : '#475569',
          maxWidth: MAX_R * 2 + 8,
        }}
        title={project.slug}
      >
        {project.slug}
      </span>

      {hover && (
        <div
          className="absolute z-50 rounded-xl border p-3 pointer-events-none shadow-2xl"
          style={{
            top: -4,
            left: '50%',
            transform: 'translateX(-50%) translateY(-100%) translateY(-8px)',
            background: 'rgba(15,23,42,0.97)',
            border: '1px solid rgba(255,255,255,0.1)',
            minWidth: 160,
          }}
        >
          <div className="font-mono text-xs text-white mb-1 font-semibold">{project.slug}</div>
          <div className="font-mono text-[0.55rem] text-slate-400 space-y-0.5">
            <div>
              Status:{' '}
              <span style={{ color: active ? '#22D3EE' : '#64748B' }}>
                {active ? '● active' : '○ idle'}
              </span>
            </div>
            <div>Last active: <span className="text-white">{relTime(project.lastTranscriptMtimeMs)}</span></div>
            <div>Avg turns/day: <span className="text-white">{project.avgTurnsPerDay}</span></div>
            <div>Sessions: <span className="text-white">{project.sessionCount}</span></div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function LivePulsePage() {
  const [data, setData] = useState<LivePulseResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [connected, setConnected] = useState(true)
  const [lastFetch, setLastFetch] = useState<number | null>(null)

  const load = useCallback(() => {
    fetch('/api/live-pulse')
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then((d) => {
        setData(d as LivePulseResponse)
        setConnected(true)
        setLastFetch(Date.now())
        setError(null)
      })
      .catch((e) => {
        setConnected(false)
        setError(String(e))
      })
  }, [])

  useEffect(() => {
    load()
    const t = setInterval(load, POLL_MS)
    return () => clearInterval(t)
  }, [load])

  const maxAvg = data
    ? Math.max(...data.projects.map((p) => p.avgTurnsPerDay), 0.1)
    : 0.1

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <style>{`
        @keyframes pulse-ring {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.6; }
        }
        @keyframes pulse-core {
          0%, 100% { opacity: 0.6; r: ${MIN_R * 0.35}px; }
          50% { opacity: 1; r: ${MIN_R * 0.5}px; }
        }
      `}</style>

      <div className="sticky top-0 z-40 bg-slate-950/90 backdrop-blur border-b border-white/5">
        <SubPageHeader title="Fleet Live Pulse">
          <div className="flex gap-4 items-center font-mono text-[0.6rem] text-slate-400">
            {data && (
              <>
                <span>
                  Active: <span className="text-cyan-400">{data.activeCount}</span>
                  {' / '}{data.projects.length}
                </span>
                {lastFetch && (
                  <span className="text-slate-600">updated {Math.round((Date.now() - lastFetch) / 1000)}s ago</span>
                )}
              </>
            )}
            <span
              className="flex items-center gap-1"
              style={{ color: connected ? '#10B981' : '#EF4444' }}
            >
              <span
                className="inline-block rounded-full"
                style={{
                  width: 6,
                  height: 6,
                  background: connected ? '#10B981' : '#EF4444',
                }}
              />
              {connected ? 'connected' : 'reconnecting'}
            </span>
          </div>
        </SubPageHeader>
      </div>

      <div className="p-6">
        {error && <p className="font-mono text-red-400 text-xs mb-4">{error}</p>}
        {!data && !error && <p className="font-mono text-slate-500 text-xs">Loading…</p>}

        {data && data.projects.length === 0 && (
          <p className="font-mono text-slate-500 text-xs">No projects found.</p>
        )}

        {data && data.projects.length > 0 && (
          <>
            <div className="mb-4 flex gap-4 font-mono text-[0.55rem] text-slate-500">
              <span>
                <span className="inline-block rounded-full mr-1" style={{ width: 6, height: 6, background: '#22D3EE', display: 'inline-block', verticalAlign: 'middle' }} />
                active (written in last 10s)
              </span>
              <span>
                <span className="inline-block rounded-full mr-1" style={{ width: 6, height: 6, background: '#334155', display: 'inline-block', verticalAlign: 'middle' }} />
                idle
              </span>
              <span>circle size ∝ avg turns/day (7d)</span>
            </div>

            <div
              className="flex flex-wrap gap-6"
              style={{ alignItems: 'center' }}
            >
              {data.projects
                .sort((a, b) => (b.active ? 1 : 0) - (a.active ? 1 : 0) || b.avgTurnsPerDay - a.avgTurnsPerDay)
                .map((p) => (
                  <ProjectCircle key={p.slug} project={p} maxAvg={maxAvg} />
                ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
