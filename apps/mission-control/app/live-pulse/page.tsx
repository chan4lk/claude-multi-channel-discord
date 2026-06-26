'use client'

import { useEffect, useState, useRef } from 'react'
import SubPageHeader from '../../components/SubPageHeader'
import type { LivePulseSnapshot, PulseProject } from '../api/live-pulse/route'

const MIN_RADIUS = 20
const MAX_RADIUS = 56

function relTime(ms: number): string {
  if (ms === 0) return 'never'
  const diff = Date.now() - ms
  if (diff < 10_000) return 'now'
  if (diff < 60_000) return `${Math.round(diff / 1000)}s ago`
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h ago`
  return `${Math.round(diff / 86_400_000)}d ago`
}

function clampRadius(turnsPerDay: number, maxTpd: number): number {
  if (maxTpd === 0) return MIN_RADIUS
  const frac = Math.min(turnsPerDay / maxTpd, 1)
  return MIN_RADIUS + frac * (MAX_RADIUS - MIN_RADIUS)
}

function ProjectCircle({
  project,
  radius,
}: {
  project: PulseProject
  radius: number
}) {
  const [hover, setHover] = useState(false)
  const dim = radius * 2 + 24

  return (
    <div
      className="relative flex items-center justify-center"
      style={{ width: dim, height: dim }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {/* Pulse ring for active projects */}
      {project.active && (
        <div
          className="absolute rounded-full animate-ping"
          style={{
            width: radius * 2,
            height: radius * 2,
            background: 'rgba(34,211,238,0.15)',
          }}
        />
      )}
      {/* Main circle */}
      <div
        className="rounded-full flex items-center justify-center transition-all duration-500"
        style={{
          width: radius * 2,
          height: radius * 2,
          background: project.active
            ? 'radial-gradient(circle at 40% 35%, rgba(34,211,238,0.35), rgba(34,211,238,0.08))'
            : 'radial-gradient(circle at 40% 35%, rgba(100,116,139,0.25), rgba(100,116,139,0.06))',
          border: `1.5px solid ${project.active ? 'rgba(34,211,238,0.5)' : 'rgba(100,116,139,0.2)'}`,
          boxShadow: project.active
            ? '0 0 16px rgba(34,211,238,0.25), inset 0 0 8px rgba(34,211,238,0.1)'
            : 'none',
        }}
      >
        <span
          className="font-mono font-bold text-center leading-tight select-none"
          style={{
            fontSize: Math.max(8, Math.min(11, radius * 0.4)),
            color: project.active ? '#22D3EE' : '#475569',
            maxWidth: radius * 1.6,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {project.slug}
        </span>
      </div>

      {/* Hover tooltip */}
      {hover && (
        <div className="absolute z-20 bottom-full mb-2 left-1/2 -translate-x-1/2 w-52 rounded-lg border border-white/10 bg-slate-900 p-3 shadow-xl font-mono text-xs pointer-events-none">
          <div className="text-white font-bold mb-1">{project.slug}</div>
          <div className="text-slate-400 text-[0.6rem]">
            Last active: <span className="text-slate-300">{relTime(project.lastActiveMs)}</span>
          </div>
          <div className="text-slate-400 text-[0.6rem]">
            Sessions: <span className="text-slate-300">{project.sessionCount}</span>
          </div>
          <div className="text-slate-400 text-[0.6rem]">
            7d avg turns/day: <span className="text-slate-300">{project.turnsPerDay7.toFixed(1)}</span>
          </div>
          <div
            className="mt-1.5 text-[0.6rem] font-bold"
            style={{ color: project.active ? '#22D3EE' : '#475569' }}
          >
            {project.active ? '● ACTIVE' : '○ IDLE'}
          </div>
        </div>
      )}
    </div>
  )
}

export default function LivePulsePage() {
  const [data, setData] = useState<LivePulseSnapshot | null>(null)
  const [connStatus, setConnStatus] = useState<'connecting' | 'connected' | 'reconnecting'>('connecting')
  const esRef = useRef<EventSource | null>(null)

  useEffect(() => {
    function connect() {
      setConnStatus('connecting')
      const es = new EventSource('/api/live-pulse?stream=1')
      esRef.current = es

      es.onopen = () => setConnStatus('connected')

      es.onmessage = (e) => {
        try {
          const snap = JSON.parse(e.data) as LivePulseSnapshot
          setData(snap)
          setConnStatus('connected')
        } catch { /* ignore */ }
      }

      es.onerror = () => {
        setConnStatus('reconnecting')
        es.close()
        setTimeout(connect, 3000)
      }
    }

    connect()
    return () => {
      esRef.current?.close()
    }
  }, [])

  const maxTpd = data
    ? Math.max(...data.projects.map((p) => p.turnsPerDay7), 1)
    : 1

  const sorted = data
    ? [...data.projects].sort((a, b) => {
        if (a.active !== b.active) return a.active ? -1 : 1
        return b.turnsPerDay7 - a.turnsPerDay7
      })
    : []

  const connColor =
    connStatus === 'connected'
      ? '#34D399'
      : connStatus === 'reconnecting'
      ? '#F59E0B'
      : '#94A3B8'

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <div className="sticky top-0 z-40 bg-slate-950/90 backdrop-blur border-b border-white/5">
        <SubPageHeader title="Fleet Live Pulse Board">
          <div className="flex gap-4 items-center font-mono text-[0.6rem] text-slate-400">
            {data && (
              <>
                <span>
                  Active: <span className="text-cyan-400">{data.activeCount}</span>
                  {' / '}
                  {data.projects.length}
                </span>
              </>
            )}
            <span className="flex items-center gap-1.5">
              <span
                className="w-1.5 h-1.5 rounded-full inline-block"
                style={{ background: connColor }}
              />
              <span style={{ color: connColor }}>{connStatus}</span>
            </span>
          </div>
        </SubPageHeader>
      </div>

      <div className="p-6">
        {!data && connStatus === 'connecting' && (
          <p className="font-mono text-slate-500 text-xs">Connecting…</p>
        )}
        {connStatus === 'reconnecting' && (
          <p className="font-mono text-amber-400 text-xs mb-4">Connection lost — reconnecting…</p>
        )}

        {sorted.length === 0 && data && (
          <div className="text-center py-16">
            <div className="font-mono text-2xl mb-2">◌</div>
            <p className="font-mono text-slate-400 text-sm">No projects found.</p>
          </div>
        )}

        {sorted.length > 0 && (
          <div className="flex flex-wrap gap-4 items-center justify-start">
            {sorted.map((p) => (
              <ProjectCircle
                key={p.slug}
                project={p}
                radius={clampRadius(p.turnsPerDay7, maxTpd)}
              />
            ))}
          </div>
        )}

        {data && (
          <div className="mt-8 flex gap-6 font-mono text-[0.55rem] text-slate-600">
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-cyan-400/50 inline-block" />
              active (written in last 10s)
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-slate-600/50 inline-block" />
              idle
            </span>
            <span className="flex items-center gap-1.5">
              circle size ∝ turns/day (7d avg)
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
