'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import type { FleetResponse, FleetProject, BudgetStatus } from '../api/fleet/route'
import { useFreshness } from '../../lib/useFreshness'
import FreshnessBadge from '../../components/FreshnessBadge'

interface Row {
  slug: string
  used: number
  budget: number
  frac: number
  status: BudgetStatus
}

// Bar color by budgetStatus. ok=green, warning=amber, critical=red, exhausted=deep red.
function statusColor(s: BudgetStatus): string {
  switch (s) {
    case 'ok': return '#34d399'
    case 'warning': return '#f59e0b'
    case 'critical': return '#ef4444'
    case 'exhausted': return '#b91c1c'
    default: return '#6B7280'
  }
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`
  return String(n)
}

const TRACK_W = 100 // SVG user units; bar drawn in a viewBox of this width
const TRACK_H = 16
const TICKS = [0.5, 0.8, 1.0]

function BulletRow({ r }: { r: Row }) {
  const c = statusColor(r.status)
  const fillW = Math.min(1, r.frac) * TRACK_W
  const over = r.frac > 1
  return (
    <Link href={`/project-config?slug=${encodeURIComponent(r.slug)}`} className="group block">
      <div className="flex items-center gap-3 py-1.5 px-2 rounded-lg transition-colors group-hover:bg-cyber-cyan/[0.04]">
        <div className="w-32 shrink-0 text-[0.7rem] font-bold text-slate-200 truncate" style={{ fontFamily: 'Orbitron, monospace' }}>{r.slug}</div>
        <div className="flex-1 min-w-0">
          <svg viewBox={`0 0 ${TRACK_W} ${TRACK_H}`} width="100%" height={TRACK_H} preserveAspectRatio="none">
            {/* track */}
            <rect x={0} y={TRACK_H / 2 - 4} width={TRACK_W} height={8} rx={2} fill="#1e293b" />
            {/* fill */}
            <rect x={0} y={TRACK_H / 2 - 4} width={fillW} height={8} rx={2} fill={c} />
            {/* threshold ticks */}
            {TICKS.map((t) => (
              <line key={t} x1={t * TRACK_W} x2={t * TRACK_W} y1={1} y2={TRACK_H - 1} stroke="#64748b" strokeWidth={0.6} strokeDasharray="1.5 1.5" />
            ))}
            {over && <line x1={TRACK_W - 0.5} x2={TRACK_W - 0.5} y1={1} y2={TRACK_H - 1} stroke="#ef4444" strokeWidth={1} />}
          </svg>
        </div>
        <div className="w-16 shrink-0 text-right text-[0.65rem] font-black tabular-nums" style={{ fontFamily: 'Orbitron, monospace', color: c }}>{Math.round(r.frac * 100)}%</div>
        <div className="w-28 shrink-0 text-right text-[0.55rem] font-mono text-slate-500 tabular-nums">{fmtTokens(r.used)}/{fmtTokens(r.budget)}</div>
      </div>
    </Link>
  )
}

export default function BudgetPressurePage() {
  const { data, isStale, lastError, lastSuccessAt } = useFreshness<FleetResponse>('/api/fleet', 60_000)
  const loading = data === null && lastError === null

  const rows: Row[] = useMemo(() => {
    const projects = (data?.projects ?? []) as FleetProject[]
    return projects
      .filter((p) => p.monthlyTokenBudget != null && p.monthlyTokenBudget > 0)
      .map((p) => {
        const budget = p.monthlyTokenBudget!
        const used = p.monthlyTokensUsed ?? 0
        return { slug: p.slug, used, budget, frac: used / budget, status: p.budgetStatus ?? 'ok' }
      })
      .sort((a, b) => b.frac - a.frac)
  }, [data])

  const totals = useMemo(() => {
    const used = rows.reduce((s, r) => s + r.used, 0)
    const budget = rows.reduce((s, r) => s + r.budget, 0)
    return { used, budget, frac: budget > 0 ? used / budget : 0 }
  }, [rows])

  if (loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center" style={{ background: '#060d1a' }}>
        <div className="text-xs font-mono text-slate-600 animate-pulse">Measuring budget pressure…</div>
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
            Budget Pressure Bullet Chart
          </h1>
          <span className="text-[0.6rem] font-mono text-slate-500 border border-slate-700 px-2 py-0.5 rounded">which projects near token budget exhaustion</span>
          <FreshnessBadge isStale={isStale} lastError={lastError} lastSuccessAt={lastSuccessAt} />
          <div className="flex-1" />
          <div className="flex items-center gap-2">
            <span className="text-[0.55rem] font-mono text-slate-500 uppercase tracking-wider">fleet</span>
            <span className="text-lg font-black tabular-nums" style={{ fontFamily: 'Orbitron, monospace', color: statusColor(totals.frac >= 1 ? 'exhausted' : totals.frac >= 0.8 ? 'critical' : totals.frac >= 0.5 ? 'warning' : 'ok') }}>{Math.round(totals.frac * 100)}%</span>
            <span className="text-[0.55rem] font-mono text-slate-600 tabular-nums">{fmtTokens(totals.used)}/{fmtTokens(totals.budget)}</span>
          </div>
        </div>
      </header>

      <main className="flex-1 p-6 max-w-5xl mx-auto w-full">
        {rows.length === 0 ? (
          <div className="h-64 flex items-center justify-center text-slate-600 text-xs font-mono">No projects with a defined monthly token budget.</div>
        ) : (
          <>
            <div className="rounded-xl border border-cyber-cyan/12 p-3" style={{ background: 'rgba(0,245,255,0.02)' }}>
              {rows.map((r) => <BulletRow key={r.slug} r={r} />)}
            </div>

            {/* legend */}
            <div className="mt-6 flex items-center gap-4 text-[0.55rem] font-mono text-slate-500 flex-wrap">
              <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded-sm" style={{ background: '#34d399' }} />ok &lt;50%</span>
              <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded-sm" style={{ background: '#f59e0b' }} />warning ≥50%</span>
              <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded-sm" style={{ background: '#ef4444' }} />critical ≥80%</span>
              <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded-sm" style={{ background: '#b91c1c' }} />exhausted ≥100%</span>
              <span className="text-slate-600">· dashed ticks at 50/80/100%</span>
            </div>
          </>
        )}

        <p className="text-[0.5rem] font-mono text-slate-700 mt-4">
          One horizontal bullet row per project with a <code>monthlyTokenBudget</code>. Filled bar ∝ usage fraction
          (<code>monthlyTokensUsed</code> ÷ budget); dashed ticks mark 50/80/100%. Bar color follows <code>budgetStatus</code>.
          Rows sorted by usage fraction descending so the most-pressured projects float to the top. Click a row to open Project Config.
          Reuses <code>/api/fleet</code>; projects without a budget are omitted. Refreshes every 60s.
        </p>
      </main>
    </div>
  )
}
