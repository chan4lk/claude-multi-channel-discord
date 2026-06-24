'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useFreshness } from '../../lib/useFreshness'
import FreshnessBadge from '../../components/FreshnessBadge'
import type { LiveTurnsResponse, LiveTurnProject } from '../api/live-turns/route'

function relTime(iso: string | null): string {
  if (!iso) return '—'
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  return `${Math.floor(diff / 3_600_000)}h ago`
}

function turnDuration(start: string | null, now: number): string {
  if (!start) return '—'
  const diff = now - new Date(start).getTime()
  if (diff < 0) return '—'
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s`
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ${Math.floor((diff % 60_000) / 1000)}s`
  return `${Math.floor(diff / 3_600_000)}h ${Math.floor((diff % 3_600_000) / 60_000)}m`
}

function ProjectRow({ project, now }: { project: LiveTurnProject; now: number }) {
  const isActive = project.state === 'active'
  return (
    <div
      className="flex items-center gap-4 rounded-xl border px-4 py-3"
      style={{
        background: isActive ? 'rgba(34,211,238,0.04)' : 'rgba(255,255,255,0.02)',
        borderColor: isActive ? 'rgba(34,211,238,0.25)' : 'rgba(255,255,255,0.06)',
        boxShadow: isActive ? '0 0 16px rgba(34,211,238,0.06)' : 'none',
      }}
    >
      {/* Status dot */}
      <span
        className="shrink-0 rounded-full"
        style={{
          width: 10,
          height: 10,
          background: isActive ? '#22d3ee' : '#334155',
          boxShadow: isActive ? '0 0 8px #22d3ee' : 'none',
          animation: isActive ? 'pulse 1.5s ease-in-out infinite' : 'none',
        }}
      />

      {/* Slug */}
      <span
        className="font-mono text-sm shrink-0 w-36 truncate"
        style={{ color: isActive ? '#22d3ee' : '#64748b' }}
        title={project.slug}
      >
        {project.slug}
      </span>

      {/* State badge */}
      <span
        className="shrink-0 text-[0.55rem] font-mono uppercase tracking-wider px-2 py-0.5 rounded border"
        style={
          isActive
            ? { background: '#22d3ee22', color: '#22d3ee', borderColor: '#22d3ee44' }
            : { background: '#33415522', color: '#64748b', borderColor: '#33415544' }
        }
      >
        {isActive ? 'ACTIVE' : 'IDLE'}
      </span>

      {/* Turn duration */}
      <span className="font-mono text-xs text-slate-500 w-20 shrink-0 tabular-nums">
        {isActive ? turnDuration(project.currentTurnStart, now) : '—'}
      </span>

      {/* Last tool */}
      <span
        className="font-mono text-xs truncate flex-1 min-w-0"
        style={{ color: isActive ? '#22d3ee99' : '#334155' }}
        title={project.lastToolName ?? undefined}
      >
        {project.lastToolName ?? '—'}
      </span>

      {/* Tool count */}
      <span className="font-mono text-xs text-slate-600 w-16 shrink-0 text-right tabular-nums">
        {project.toolCountThisTurn > 0 ? `${project.toolCountThisTurn} tools` : '—'}
      </span>

      {/* Last output */}
      <span className="font-mono text-xs text-slate-600 w-20 shrink-0 text-right tabular-nums">
        {relTime(project.lastOutputAt)}
      </span>
    </div>
  )
}

export default function LiveTurnsPage() {
  const { data, isStale, lastError, lastSuccessAt } = useFreshness<LiveTurnsResponse>(
    '/api/live-turns',
    5_000,
  )
  // Tick every second so turn durations + relative times update live
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(t)
  }, [])

  const loading = data === null && lastError === null
  const projects = data?.projects ?? []
  const activeCount = projects.filter((p) => p.state === 'active').length

  return (
    <div className="min-h-dvh flex flex-col" style={{ background: '#060d1a' }}>
      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-cyber-cyan/12 bg-[#060d1a]/90 backdrop-blur-md px-6 py-3">
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-cyber-cyan/40 to-transparent" />
        <div className="flex items-center gap-3 flex-wrap">
          <Link href="/" className="text-[0.6rem] font-mono text-slate-500 hover:text-cyber-cyan transition-colors uppercase tracking-wider">
            &larr; Dashboard
          </Link>
          <h1
            className="text-sm font-black tracking-[0.18em] text-cyber-cyan"
            style={{ fontFamily: 'Orbitron, JetBrains Mono, monospace' }}
          >
            Live Turn Activity Feed
          </h1>
          <FreshnessBadge isStale={isStale} lastError={lastError} lastSuccessAt={lastSuccessAt} />
          <span className="text-[0.55rem] font-mono text-slate-600">auto-refreshes every 5s</span>
          <div className="flex-1" />
          {activeCount > 0 && (
            <span
              className="text-[0.6rem] font-mono px-2 py-0.5 rounded border"
              style={{ color: '#22d3ee', borderColor: '#22d3ee44', background: '#22d3ee11' }}
            >
              {activeCount} active
            </span>
          )}
        </div>
      </header>

      <main className="flex-1 p-6 max-w-5xl mx-auto w-full">
        {/* Column headers */}
        {!loading && projects.length > 0 && (
          <div className="flex items-center gap-4 px-4 mb-2 text-[0.5rem] font-mono text-slate-700 uppercase tracking-wider">
            <span className="w-10 shrink-0" />
            <span className="w-36 shrink-0">Project</span>
            <span className="w-14 shrink-0">State</span>
            <span className="w-20 shrink-0">Duration</span>
            <span className="flex-1 min-w-0">Last Tool</span>
            <span className="w-16 shrink-0 text-right">Tools</span>
            <span className="w-20 shrink-0 text-right">Output</span>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center h-48">
            <span className="text-sm font-mono text-slate-600 animate-pulse">Loading transcripts…</span>
          </div>
        ) : projects.length === 0 ? (
          <div className="flex items-center justify-center h-48">
            <span className="text-sm font-mono text-slate-600">No active transcripts</span>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {projects.map((p) => (
              <ProjectRow key={p.slug} project={p} now={now} />
            ))}
          </div>
        )}
      </main>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>
    </div>
  )
}
