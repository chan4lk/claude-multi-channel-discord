'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import type { FleetResponse, FleetProject } from '../api/fleet/route'
import { useFreshness } from '../../lib/useFreshness'
import FreshnessBadge from '../../components/FreshnessBadge'

// Four attention factors, each scored 0..1 and weighted equally.
interface Factor {
  key: 'budget' | 'headroom' | 'context' | 'queue'
  label: string
  color: string
  score: number // 0..1
}

interface Row {
  slug: string
  total: number // 0..100
  factors: Factor[]
  reason: string
}

const WEIGHT = 0.25
const ATTENTION_THRESHOLD = 50 // composite score that flags "needs attention"

const FACTOR_META: Record<Factor['key'], { label: string; color: string }> = {
  budget: { label: 'budget', color: '#ef4444' },
  headroom: { label: 'reap', color: '#f59e0b' },
  context: { label: 'context', color: '#22d3ee' },
  queue: { label: 'queue', color: '#a78bfa' },
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n))
}

function scoreProject(p: FleetProject): Row {
  // Budget: usage fraction, floored up when status escalates.
  let budget = 0
  if (p.monthlyTokenBudget && p.monthlyTokenBudget > 0) {
    budget = clamp01((p.monthlyTokensUsed ?? 0) / p.monthlyTokenBudget)
  }
  if (p.budgetStatus === 'critical') budget = Math.max(budget, 0.8)
  if (p.budgetStatus === 'exhausted') budget = 1

  // Headroom: how close idle age is to the watchdog reap line.
  const headroom = p.stuckThresholdMinutes > 0 ? clamp01(p.ageMins / p.stuckThresholdMinutes) : 0

  // Context: urgency inverse of fill ETA (0m→1, ≥120m→0).
  let context = 0
  if (p.contextFillEtaMinutes != null && Number.isFinite(p.contextFillEtaMinutes)) {
    context = clamp01(1 - p.contextFillEtaMinutes / 120)
  }

  // Queue/circuit: open breaker is max; otherwise scale queue depth.
  const queue = p.circuitOpen ? 1 : clamp01((p.queuedCount ?? 0) / 5)

  const factors: Factor[] = [
    { key: 'budget', ...FACTOR_META.budget, score: budget },
    { key: 'headroom', ...FACTOR_META.headroom, score: headroom },
    { key: 'context', ...FACTOR_META.context, score: context },
    { key: 'queue', ...FACTOR_META.queue, score: queue },
  ]
  const total = factors.reduce((s, f) => s + f.score * WEIGHT, 0) * 100

  // Dominant factor → human reason tag.
  const dom = factors.reduce((a, b) => (b.score > a.score ? b : a))
  let reason = 'nominal'
  if (dom.score > 0.05) {
    if (dom.key === 'budget') reason = p.budgetStatus === 'exhausted' ? 'budget exhausted' : p.budgetStatus === 'critical' ? 'budget critical' : 'budget pressure'
    else if (dom.key === 'headroom') reason = headroom >= 0.85 ? 'near-reap' : 'idling'
    else if (dom.key === 'context') reason = 'context filling'
    else reason = p.circuitOpen ? 'breaker open' : 'queue backlog'
  }

  return { slug: p.slug, total, factors, reason }
}

function ScoreRow({ r }: { r: Row }) {
  const flagged = r.total >= ATTENTION_THRESHOLD
  return (
    <Link href={`/focus/${encodeURIComponent(r.slug)}`} className="group block">
      <div className="flex items-center gap-3 py-1.5 px-2 rounded-lg transition-colors group-hover:bg-cyber-cyan/[0.04]">
        <div className="w-9 shrink-0 text-right text-sm font-black tabular-nums" style={{ fontFamily: 'Orbitron, monospace', color: flagged ? '#ef4444' : r.total >= 25 ? '#f59e0b' : '#475569' }}>{Math.round(r.total)}</div>
        <div className="w-32 shrink-0 text-[0.7rem] font-bold text-slate-200 truncate" style={{ fontFamily: 'Orbitron, monospace' }}>{r.slug}</div>
        <div className="flex-1 min-w-0 flex h-2.5 rounded-sm overflow-hidden bg-[#1e293b]">
          {/* stacked factor contributions; each segment width ∝ weighted score */}
          {r.factors.map((f) => (
            <div key={f.key} style={{ width: `${f.score * WEIGHT * 100}%`, background: f.color }} title={`${f.label} ${Math.round(f.score * 100)}%`} />
          ))}
        </div>
        <div className="w-28 shrink-0 text-right text-[0.55rem] font-mono uppercase tracking-wider" style={{ color: flagged ? '#ef4444' : '#64748b' }}>{r.reason}</div>
      </div>
    </Link>
  )
}

export default function ScoreboardPage() {
  const { data, isStale, lastError, lastSuccessAt } = useFreshness<FleetResponse>('/api/fleet', 60_000)
  const loading = data === null && lastError === null

  const rows: Row[] = useMemo(() => {
    const projects = (data?.projects ?? []) as FleetProject[]
    return projects.map(scoreProject).sort((a, b) => b.total - a.total)
  }, [data])

  const flaggedCount = rows.filter((r) => r.total >= ATTENTION_THRESHOLD).length

  if (loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center" style={{ background: '#060d1a' }}>
        <div className="text-xs font-mono text-slate-600 animate-pulse">Scoring fleet attention…</div>
      </div>
    )
  }

  return (
    <div className="min-h-dvh flex flex-col" style={{ background: '#060d1a' }}>
      <header className="sticky top-0 z-30 border-b border-cyber-cyan/12 bg-[#060d1a]/90 backdrop-blur-md px-6 py-3">
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-cyber-cyan/40 to-transparent" />
        <div className="flex items-center gap-3 flex-wrap">
          <Link href="/" className="text-[0.6rem] font-mono text-slate-500 hover:text-cyber-cyan transition-colors uppercase tracking-wider">← Dashboard</Link>
          <h1 className="text-sm font-black tracking-[0.18em] text-cyber-cyan" style={{ fontFamily: 'Orbitron, JetBrains Mono, monospace' }}>
            Fleet Attention Scoreboard
          </h1>
          <span className="text-[0.6rem] font-mono text-slate-500 border border-slate-700 px-2 py-0.5 rounded">one ranked pane: which channel needs you now</span>
          <FreshnessBadge isStale={isStale} lastError={lastError} lastSuccessAt={lastSuccessAt} />
          <div className="flex-1" />
          <div className="flex items-center gap-1.5">
            <span className="text-[0.55rem] font-mono text-slate-500 uppercase tracking-wider">need attention</span>
            <span className="text-lg font-black tabular-nums" style={{ fontFamily: 'Orbitron, monospace', color: flaggedCount > 0 ? '#ef4444' : '#475569' }}>{flaggedCount}</span>
          </div>
        </div>
      </header>

      <main className="flex-1 p-6 max-w-4xl mx-auto w-full">
        {rows.length === 0 ? (
          <div className="h-64 flex items-center justify-center text-slate-600 text-xs font-mono">No projects to score.</div>
        ) : (
          <>
            <div className="rounded-xl border border-cyber-cyan/12 p-3" style={{ background: 'rgba(0,245,255,0.02)' }}>
              {rows.map((r) => <ScoreRow key={r.slug} r={r} />)}
            </div>

            <div className="mt-6 flex items-center gap-4 text-[0.55rem] font-mono text-slate-500 flex-wrap">
              {(['budget', 'headroom', 'context', 'queue'] as const).map((k) => (
                <span key={k} className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded-sm" style={{ background: FACTOR_META[k].color }} />{FACTOR_META[k].label}</span>
              ))}
              <span className="text-slate-600">· score = mean of four factors ×100; flagged ≥{ATTENTION_THRESHOLD}</span>
            </div>
          </>
        )}

        <p className="text-[0.5rem] font-mono text-slate-700 mt-4">
          Composite attention score (0–100) per project, the equal-weighted mean of four signals from <code>/api/fleet</code>:
          budget pressure (usage fraction, escalated by <code>budgetStatus</code>), stuck headroom (<code>ageMins / stuckThresholdMinutes</code>),
          context-fill urgency (inverse of <code>contextFillEtaMinutes</code>), and queue/circuit state (<code>queuedCount</code>, <code>circuitOpen</code>).
          The stacked bar shows each factor's contribution; the tag names the dominant one. Rows ranked by score desc; click to open Focus. Refreshes every 60s.
        </p>
      </main>
    </div>
  )
}
