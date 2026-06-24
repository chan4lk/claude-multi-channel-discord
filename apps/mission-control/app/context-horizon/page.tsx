'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import type { ContextHorizonResponse, ContextHorizonProject } from '../api/context-horizon/route'
import { useFreshness } from '../../lib/useFreshness'
import FreshnessBadge from '../../components/FreshnessBadge'

const STATUS_COLORS = {
  critical: { bar: '#ef4444', text: '#ef4444', bg: 'rgba(239,68,68,0.08)' },
  warning: { bar: '#f59e0b', text: '#f59e0b', bg: 'rgba(245,158,11,0.08)' },
  ok: { bar: '#22c55e', text: '#00f5ff', bg: 'rgba(0,245,255,0.04)' },
  unknown: { bar: '#475569', text: '#475569', bg: 'transparent' },
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`
  return String(n)
}

function fmtHours(h: number | null): string {
  if (h === null) return '—'
  if (h < 1) return `${Math.round(h * 60)}m`
  if (h < 24) return `${h}h`
  return `${Math.round(h / 24)}d`
}

function RunwayBar({ project }: { project: ContextHorizonProject }) {
  const colors = STATUS_COLORS[project.status]
  const pct = project.pctUsed
  const tr = project.turnsRemaining

  return (
    <div
      className="rounded-xl border p-4 flex flex-col gap-2"
      style={{ borderColor: `${colors.bar}40`, background: colors.bg }}
    >
      <div className="flex items-center justify-between gap-2">
        <Link
          href={`/context-pressure`}
          className="text-xs font-bold font-mono truncate hover:opacity-80 transition-opacity"
          style={{ color: colors.text }}
        >
          {project.slug}
        </Link>
        <div className="flex items-center gap-2 shrink-0">
          <span
            className="text-[0.5rem] font-mono px-1.5 py-0.5 rounded uppercase tracking-wider"
            style={{ background: `${colors.bar}20`, color: colors.bar }}
          >
            {project.status}
          </span>
        </div>
      </div>

      {/* Context bar */}
      <div className="w-full h-2 rounded-full bg-slate-900 overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${pct}%`, background: colors.bar }}
        />
      </div>

      <div className="flex items-center justify-between text-[0.55rem] font-mono">
        <span className="text-slate-500">
          {fmtTokens(project.tokensUsed)} / {fmtTokens(project.contextLimit)} used ({pct}%)
        </span>
        <div className="flex items-center gap-3">
          {tr !== null ? (
            <span style={{ color: colors.bar }}>
              <span className="font-bold">{tr}</span> turns left
            </span>
          ) : (
            <span className="text-slate-600">turns: —</span>
          )}
          {project.estimatedHoursRemaining !== null && (
            <span className="text-slate-500">≈ {fmtHours(project.estimatedHoursRemaining)}</span>
          )}
          {project.avgGrowthPerTurn !== null && (
            <span className="text-slate-600">+{fmtTokens(project.avgGrowthPerTurn)}/turn</span>
          )}
        </div>
      </div>
    </div>
  )
}

export default function ContextHorizonPage() {
  const { data, isStale, lastError, lastSuccessAt } = useFreshness<ContextHorizonResponse>(
    '/api/context-horizon',
    120_000,
  )

  const loading = data === null && lastError === null

  const { needsReset, healthy, unknown } = useMemo(() => {
    const projects = data?.projects ?? []
    return {
      needsReset: projects.filter((p) => p.status === 'critical' || p.status === 'warning'),
      healthy: projects.filter((p) => p.status === 'ok'),
      unknown: projects.filter((p) => p.status === 'unknown'),
    }
  }, [data])

  if (loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center" style={{ background: '#060d1a' }}>
        <div className="text-xs font-mono text-slate-600 animate-pulse">Computing context runway…</div>
      </div>
    )
  }

  const criticalCount = data?.criticalCount ?? 0
  const warningCount = data?.warningCount ?? 0

  return (
    <div className="min-h-dvh flex flex-col" style={{ background: '#060d1a' }}>
      <header className="sticky top-0 z-30 border-b border-cyber-cyan/12 bg-[#060d1a]/90 backdrop-blur-md px-6 py-3">
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-cyber-cyan/40 to-transparent" />
        <div className="flex items-center gap-3 flex-wrap">
          <Link href="/" className="text-[0.6rem] font-mono text-slate-500 hover:text-cyber-cyan transition-colors uppercase tracking-wider">← Dashboard</Link>
          <h1 className="text-sm font-black tracking-[0.18em] text-cyber-cyan" style={{ fontFamily: 'Orbitron, JetBrains Mono, monospace' }}>
            Context Runway
          </h1>
          <span className="text-[0.6rem] font-mono text-slate-500 border border-slate-700 px-2 py-0.5 rounded">how many turns before context ceiling?</span>
          <FreshnessBadge isStale={isStale} lastError={lastError} lastSuccessAt={lastSuccessAt} />
          <div className="flex-1" />
          <div className="flex items-center gap-4">
            {criticalCount > 0 && (
              <div className="flex items-center gap-1.5">
                <span className="text-[0.55rem] font-mono text-red-400 uppercase tracking-wider">critical</span>
                <span className="text-lg font-black tabular-nums text-red-400" style={{ fontFamily: 'Orbitron, monospace' }}>{criticalCount}</span>
              </div>
            )}
            {warningCount > 0 && (
              <div className="flex items-center gap-1.5">
                <span className="text-[0.55rem] font-mono text-amber-400 uppercase tracking-wider">warning</span>
                <span className="text-lg font-black tabular-nums text-amber-400" style={{ fontFamily: 'Orbitron, monospace' }}>{warningCount}</span>
              </div>
            )}
            <div className="flex items-center gap-1.5">
              <span className="text-[0.55rem] font-mono text-slate-500 uppercase tracking-wider">projects</span>
              <span className="text-lg font-black tabular-nums text-cyber-cyan" style={{ fontFamily: 'Orbitron, monospace' }}>
                {(data?.projects ?? []).length}
              </span>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 p-6 max-w-4xl mx-auto w-full flex flex-col gap-6">
        {/* Needs Reset panel */}
        {needsReset.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-[0.55rem] font-mono text-red-400 uppercase tracking-wider">⚠ Needs Reset</span>
              <span className="text-[0.5rem] font-mono text-slate-600">— &lt;10 turns remaining, consider stopping + resuming</span>
            </div>
            <div className="flex flex-col gap-2">
              {needsReset.map((p) => <RunwayBar key={p.slug} project={p} />)}
            </div>
          </div>
        )}

        {/* Healthy */}
        {healthy.length > 0 && (
          <div>
            <div className="text-[0.55rem] font-mono text-slate-500 uppercase tracking-wider mb-3">Healthy</div>
            <div className="flex flex-col gap-2">
              {healthy.map((p) => <RunwayBar key={p.slug} project={p} />)}
            </div>
          </div>
        )}

        {/* Unknown (no turn growth data) */}
        {unknown.length > 0 && (
          <div>
            <div className="text-[0.55rem] font-mono text-slate-600 uppercase tracking-wider mb-3">Insufficient Data</div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {unknown.map((p) => (
                <div key={p.slug} className="rounded border border-slate-800 px-3 py-2 text-[0.55rem] font-mono text-slate-500">
                  {p.slug}
                  <div className="text-[0.5rem] text-slate-700">{p.turnCount} turns, {Math.round(p.pctUsed)}% used</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {(data?.projects ?? []).length === 0 && (
          <div className="h-48 flex items-center justify-center text-slate-600 text-xs font-mono text-center">
            No transcript data found. Projects need active sessions with recorded turns.
          </div>
        )}

        <p className="text-[0.5rem] font-mono text-slate-700">
          Reads each project&apos;s active JSONL transcript. Per turn: total input tokens = input + cache_read + cache_creation.
          Rolling 5-turn average of context growth → turns_remaining = (200k – latest) / avg_growth.
          Est. time uses rolling 5-turn inter-message interval (idle gaps &gt;1h excluded).
          Critical: &lt;5 turns. Warning: &lt;10 turns. Refreshes every 2 min.
        </p>
      </main>
    </div>
  )
}
