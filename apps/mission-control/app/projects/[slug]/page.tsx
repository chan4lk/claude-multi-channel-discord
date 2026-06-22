'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import type { FleetResponse, FleetProject, ProjectState } from '../../api/fleet/route'
import type { SlugMetrics } from '../../api/metrics/[slug]/route'
import type { BranchInfo, BranchesResponse } from '../../api/branches/route'
import type { ScheduleRow } from '../../api/schedules/route'
import type { HealthScore } from '../../../lib/health'
import HealthScoreRing from '../../../components/HealthScoreRing'

const STATE_COLORS: Record<ProjectState, string> = {
  idle: '#00F5FF',
  active: '#4ADE80',
  stalled: '#EF4444',
  autonomous: '#A855F7',
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`
  return String(n)
}

function fmtBytes(b: number): string {
  if (b >= 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} MB`
  if (b >= 1024) return `${(b / 1024).toFixed(1)} KB`
  return `${b} B`
}

function GoalChip({ text, status }: { text: string; status: string }) {
  const color = status === 'completed' ? '#4ADE80' : status === 'paused' ? '#64748b' : '#A855F7'
  return (
    <div className="flex flex-col gap-1.5">
      <span
        className="self-start text-[0.55rem] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded border"
        style={{ color, borderColor: `${color}40`, background: `${color}10` }}
      >
        {status}
      </span>
      <p className="text-xs font-mono text-slate-300 leading-relaxed line-clamp-3">{text}</p>
    </div>
  )
}

function GitStatus({ branch }: { branch: BranchInfo }) {
  if (!branch.hasGit) return <span className="text-[0.65rem] font-mono text-slate-600">no git</span>
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs font-mono text-cyber-cyan">{branch.currentBranch ?? 'detached'}</span>
      <div className="flex gap-3 text-[0.6rem] font-mono flex-wrap">
        {branch.aheadCount > 0 && <span className="text-green-400">↑{branch.aheadCount} ahead</span>}
        {branch.behindCount > 0 && <span className="text-amber-400">↓{branch.behindCount} behind</span>}
        {branch.uncommittedCount > 0 && <span className="text-slate-400">~{branch.uncommittedCount} uncommitted</span>}
        {branch.aheadCount === 0 && branch.behindCount === 0 && branch.uncommittedCount === 0 && (
          <span className="text-slate-600">clean</span>
        )}
      </div>
    </div>
  )
}

function MiniBar({ data }: { data: number[] }) {
  const max = Math.max(...data, 1)
  return (
    <div className="flex items-end gap-0.5 h-8 mt-1">
      {data.map((v, i) => (
        <div
          key={i}
          className="flex-1 rounded-sm"
          style={{
            height: `${Math.max(8, (v / max) * 100)}%`,
            background: v > 0 ? 'rgba(0,245,255,0.6)' : 'rgba(255,255,255,0.04)',
          }}
        />
      ))}
    </div>
  )
}

interface ProjectData {
  fleet: FleetProject | null
  metrics: SlugMetrics | null
  health: HealthScore | null
  branch: BranchInfo | null
  goal: { goalText: string; status: string } | null
  nextSchedule: ScheduleRow | null
}

export default function ProjectDetailPage() {
  const params = useParams()
  const slug = typeof params.slug === 'string' ? params.slug : Array.isArray(params.slug) ? params.slug[0] : ''

  const [data, setData] = useState<ProjectData>({
    fleet: null, metrics: null, health: null, branch: null, goal: null, nextSchedule: null,
  })
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)

  const load = useCallback(async () => {
    if (!slug) return
    try {
      const [fleetRes, metricsRes, healthRes, branchRes, goalsRes, schedulesRes] = await Promise.all([
        fetch('/api/fleet').then((r) => r.json() as Promise<FleetResponse>),
        fetch(`/api/metrics/${encodeURIComponent(slug)}`).then((r) => r.ok ? r.json() as Promise<SlugMetrics> : null).catch(() => null),
        fetch('/api/health').then((r) => r.json() as Promise<{ projects: HealthScore[] }>).catch(() => ({ projects: [] })),
        fetch('/api/branches').then((r) => r.json() as Promise<BranchesResponse>).catch(() => ({ branches: [] })),
        fetch('/api/goals').then((r) => r.json() as Promise<{ goals: Array<{ slug: string; goalText: string; status: string }> }>).catch(() => ({ goals: [] })),
        fetch('/api/schedules').then((r) => r.json() as Promise<ScheduleRow[]>).catch(() => []),
      ])

      const fleet = fleetRes.projects?.find((p) => p.slug === slug) ?? null
      if (!fleet) { setNotFound(true); setLoading(false); return }

      const health = healthRes.projects?.find((p) => p.slug === slug) ?? null
      const branch = (branchRes.branches as BranchInfo[])?.find((b) => b.slug === slug) ?? null
      const goal = goalsRes.goals?.find((g) => g.slug === slug) ?? null
      const schedules = Array.isArray(schedulesRes)
        ? schedulesRes.filter((s: ScheduleRow) => s.slug === slug && s.enabled)
        : []
      const nextSchedule = schedules[0] ?? null

      setData({ fleet, metrics: metricsRes, health, branch, goal, nextSchedule })
      setLastRefresh(new Date())
      setLoading(false)
    } catch {
      setLoading(false)
    }
  }, [slug])

  useEffect(() => {
    load()
    const id = setInterval(load, 30_000)
    return () => clearInterval(id)
  }, [load])

  function openInject() {
    window.dispatchEvent(new CustomEvent('mc:inject', { detail: { slug } }))
  }

  if (loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center" style={{ background: '#060d1a' }}>
        <div className="text-xs font-mono text-slate-600 animate-pulse">Loading project…</div>
      </div>
    )
  }

  if (notFound) {
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center gap-4" style={{ background: '#060d1a' }}>
        <div className="text-4xl opacity-20">◎</div>
        <p className="text-xs font-mono text-slate-500">Project <span className="text-cyber-cyan">{slug}</span> not found.</p>
        <Link href="/" className="text-[0.6rem] font-mono text-slate-500 hover:text-cyber-cyan transition-colors uppercase tracking-wider">← Dashboard</Link>
      </div>
    )
  }

  const { fleet, metrics, health, branch, goal, nextSchedule } = data
  const state = fleet?.state ?? 'idle'
  const stateColor = STATE_COLORS[state]
  const totalTokens7d = metrics?.dayBuckets.reduce((s, b) => s + b.tokens, 0) ?? 0
  const sparkData = metrics?.dayBuckets.map((b) => b.tokens) ?? []

  return (
    <div className="min-h-dvh flex flex-col" style={{ background: '#060d1a' }}>
      <header className="sticky top-0 z-30 border-b border-cyber-cyan/12 bg-[#060d1a]/90 backdrop-blur-md px-6 py-3">
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-cyber-cyan/40 to-transparent" />
        <div className="flex items-center gap-3 flex-wrap">
          <Link href="/" className="text-[0.6rem] font-mono text-slate-500 hover:text-cyber-cyan transition-colors uppercase tracking-wider">← Dashboard</Link>
          <h1 className="text-lg font-black tracking-[0.18em]" style={{ fontFamily: 'Orbitron, JetBrains Mono, monospace', color: stateColor }}>
            {slug.toUpperCase()}
          </h1>
          <span
            className="text-[0.6rem] font-mono font-bold uppercase px-2 py-0.5 rounded border"
            style={{ color: stateColor, borderColor: `${stateColor}40`, background: `${stateColor}12` }}
          >
            {state}
          </span>
          <div className="flex-1" />
          <Link
            href={`/graph?highlight=${encodeURIComponent(slug)}`}
            className="text-[0.6rem] font-mono text-slate-500 hover:text-cyber-cyan transition-colors border border-slate-700 hover:border-cyber-cyan/30 px-2 py-1 rounded"
          >
            ⬡ Graph
          </Link>
          <button
            onClick={openInject}
            className="text-[0.65rem] font-mono font-bold px-3 py-1 rounded uppercase tracking-wider transition-all"
            style={{ background: 'rgba(0,245,255,0.12)', color: '#00F5FF', border: '1px solid rgba(0,245,255,0.3)' }}
          >
            ⟳ Inject
          </button>
        </div>
      </header>

      <main className="flex-1 p-6">
        <div className="max-w-5xl mx-auto">
          {/* Top stats */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
            <div className="rounded-lg border border-cyber-cyan/12 p-4 flex flex-col items-center justify-center gap-2" style={{ background: 'rgba(0,245,255,0.02)' }}>
              <p className="text-[0.5rem] font-mono text-slate-600 uppercase tracking-wider">Health</p>
              {health ? (
                <HealthScoreRing
                  score={health.score}
                  insufficientData={health.insufficientData}
                  recency={health.recency}
                  stallRate={health.stallRate}
                  efficiency={health.efficiency}
                  freshness={health.freshness}
                  size={52}
                />
              ) : (
                <span className="text-xl font-mono text-slate-600">—</span>
              )}
            </div>

            <div className="rounded-lg border border-cyber-cyan/12 p-4" style={{ background: 'rgba(0,245,255,0.02)' }}>
              <p className="text-[0.5rem] font-mono text-slate-600 uppercase tracking-wider mb-0.5">7d Tokens</p>
              <p className="text-xl font-mono font-bold text-cyber-cyan">{fmtTokens(totalTokens7d)}</p>
              {sparkData.length > 0 && <MiniBar data={sparkData} />}
            </div>

            <div className="rounded-lg border border-cyber-cyan/12 p-4" style={{ background: 'rgba(0,245,255,0.02)' }}>
              <p className="text-[0.5rem] font-mono text-slate-600 uppercase tracking-wider mb-0.5">Turns/Day</p>
              <p className="text-xl font-mono font-bold text-slate-300">{metrics?.turnsPerDay ?? '—'}</p>
              {metrics?.toolStats && (
                <p className="text-[0.55rem] font-mono text-slate-600 mt-0.5">{metrics.toolStats.avgCallsPerTurn} calls/turn</p>
              )}
            </div>

            <div className="rounded-lg border border-cyber-cyan/12 p-4" style={{ background: 'rgba(0,245,255,0.02)' }}>
              <p className="text-[0.5rem] font-mono text-slate-600 uppercase tracking-wider mb-0.5">Memory</p>
              {fleet?.memoryStatus?.exists ? (
                <>
                  <p className="text-xl font-mono font-bold text-purple-400">✦</p>
                  <p className="text-[0.55rem] font-mono text-slate-600 mt-0.5">{fmtBytes(fleet.memoryStatus.sizeBytes)}</p>
                </>
              ) : (
                <p className="text-xl font-mono text-slate-600">—</p>
              )}
            </div>

            <div className="rounded-lg border border-cyber-cyan/12 p-4" style={{ background: 'rgba(0,245,255,0.02)' }}>
              <p className="text-[0.5rem] font-mono text-slate-600 uppercase tracking-wider mb-0.5">Budget</p>
              <p className="text-xl font-mono font-bold" style={{
                color: !fleet?.budgetStatus || fleet.budgetStatus === 'ok' ? '#4ADE80'
                  : fleet.budgetStatus === 'warning' ? '#F59E0B'
                  : fleet.budgetStatus === 'critical' ? '#EF4444'
                  : '#64748b',
              }}>
                {fleet?.budgetStatus ?? 'ok'}
              </p>
            </div>
          </div>

          {/* Detail cards */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="rounded-lg border border-cyber-cyan/12 p-4" style={{ background: 'rgba(0,245,255,0.02)' }}>
              <p className="text-[0.6rem] font-mono text-slate-500 uppercase tracking-wider mb-3">◎ Goal</p>
              {goal ? (
                <GoalChip text={goal.goalText} status={goal.status} />
              ) : (
                <div className="flex flex-col gap-1">
                  <p className="text-[0.65rem] font-mono text-slate-600">No goal set.</p>
                  <Link href="/goals" className="text-[0.6rem] font-mono text-cyber-cyan/60 hover:text-cyber-cyan transition-colors">Set a goal →</Link>
                </div>
              )}
            </div>

            <div className="rounded-lg border border-cyber-cyan/12 p-4" style={{ background: 'rgba(0,245,255,0.02)' }}>
              <p className="text-[0.6rem] font-mono text-slate-500 uppercase tracking-wider mb-3">⑂ Git Status</p>
              {branch ? <GitStatus branch={branch} /> : (
                <p className="text-[0.65rem] font-mono text-slate-600">No git data.</p>
              )}
            </div>

            {metrics?.toolStats && metrics.toolStats.topTools.length > 0 && (
              <div className="rounded-lg border border-cyber-cyan/12 p-4" style={{ background: 'rgba(0,245,255,0.02)' }}>
                <p className="text-[0.6rem] font-mono text-slate-500 uppercase tracking-wider mb-3">⬡ Top Tools</p>
                <div className="flex flex-col gap-1.5">
                  {metrics.toolStats.topTools.slice(0, 5).map((t) => {
                    const maxCount = metrics.toolStats.topTools[0]?.count ?? 1
                    return (
                      <div key={t.name} className="flex items-center gap-2">
                        <span className="text-[0.6rem] font-mono text-slate-400 w-28 truncate">{t.name}</span>
                        <div className="flex-1 h-2.5 rounded-sm overflow-hidden" style={{ background: 'rgba(255,255,255,0.05)' }}>
                          <div className="h-full rounded-sm" style={{ width: `${(t.count / maxCount) * 100}%`, background: 'rgba(0,245,255,0.5)' }} />
                        </div>
                        <span className="text-[0.55rem] font-mono text-slate-500 w-8 text-right">{t.count}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            <div className="rounded-lg border border-cyber-cyan/12 p-4" style={{ background: 'rgba(0,245,255,0.02)' }}>
              <div className="flex items-center justify-between mb-3">
                <p className="text-[0.6rem] font-mono text-slate-500 uppercase tracking-wider">◫ Next Schedule</p>
                <Link href="/timeline" className="text-[0.55rem] font-mono text-slate-600 hover:text-cyber-cyan transition-colors">All →</Link>
              </div>
              {nextSchedule ? (
                <div className="flex flex-col gap-1">
                  <span className="text-xs font-mono text-amber-400">{nextSchedule.at}</span>
                  <p className="text-[0.65rem] font-mono text-slate-400 line-clamp-2">{nextSchedule.prompt}</p>
                  {nextSchedule.interval && (
                    <span className="text-[0.55rem] font-mono text-slate-600">repeats: {nextSchedule.interval}</span>
                  )}
                </div>
              ) : (
                <p className="text-[0.65rem] font-mono text-slate-600">No scheduled jobs.</p>
              )}
            </div>
          </div>

          {/* Quick links */}
          <div className="flex flex-wrap gap-2 mt-6">
            {[
              { href: `/projects/${slug}/terminal`, label: '▶ Terminal' },
              { href: `/metrics?slug=${slug}`, label: '◱ Metrics' },
              { href: `/flamegraph?project=${slug}`, label: '↬ Flamegraph' },
              { href: `/replay?project=${slug}`, label: '⏮ Replay' },
              { href: `/branches`, label: '⑂ Branches' },
              { href: `/goals`, label: '◎ Goals' },
              { href: `/timeline`, label: '◫ Timeline' },
              { href: `/heatmap`, label: '▦ Heatmap' },
            ].map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                className="text-[0.6rem] font-mono text-slate-500 hover:text-cyber-cyan transition-colors border border-slate-700/60 hover:border-cyber-cyan/30 px-2.5 py-1 rounded"
              >
                {label}
              </Link>
            ))}
          </div>

          {lastRefresh && (
            <p className="text-[0.5rem] font-mono text-slate-700 mt-4">
              Refreshes every 30s · Last updated {lastRefresh.toLocaleTimeString()}
            </p>
          )}
        </div>
      </main>
    </div>
  )
}
