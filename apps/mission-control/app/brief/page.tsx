'use client'

import Link from 'next/link'
import type { BriefResponse, BriefSeverity } from '../api/brief/route'
import { useFreshness } from '../../lib/useFreshness'
import FreshnessBadge from '../../components/FreshnessBadge'

function sevColor(s: BriefSeverity): string {
  switch (s) {
    case 'critical': return '#ef4444'
    case 'warn': return '#f59e0b'
    case 'info': return '#22d3ee'
    default: return '#34d399'
  }
}

function sevLabel(s: BriefSeverity): string {
  switch (s) {
    case 'critical': return 'CRITICAL'
    case 'warn': return 'WARN'
    case 'info': return 'INFO'
    default: return 'OK'
  }
}

export default function BriefPage() {
  const { data, isStale, lastError, lastSuccessAt } = useFreshness<BriefResponse>('/api/brief', 60_000)
  const loading = data === null && lastError === null
  const findings = data?.findings ?? []

  const counts = findings.reduce(
    (acc, f) => { acc[f.severity] = (acc[f.severity] ?? 0) + 1; return acc },
    {} as Record<BriefSeverity, number>
  )

  if (loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center" style={{ background: '#060d1a' }}>
        <div className="text-xs font-mono text-slate-600 animate-pulse">Synthesising fleet brief…</div>
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
            Fleet Brief
          </h1>
          <span className="text-[0.6rem] font-mono text-slate-500 border border-slate-700 px-2 py-0.5 rounded">which projects need attention, and why</span>
          <FreshnessBadge isStale={isStale} lastError={lastError} lastSuccessAt={lastSuccessAt} />
          <div className="flex-1" />
          <div className="flex items-center gap-4">
            {(['critical', 'warn', 'info'] as const).map((s) => (
              <div key={s} className="flex items-center gap-1.5">
                <span className="inline-block w-2 h-2 rounded-full" style={{ background: sevColor(s) }} />
                <span className="text-[0.55rem] font-mono text-slate-500 uppercase tracking-wider">{s}</span>
                <span className="text-sm font-black tabular-nums" style={{ fontFamily: 'Orbitron, monospace', color: counts[s] ? sevColor(s) : '#475569' }}>{counts[s] ?? 0}</span>
              </div>
            ))}
          </div>
        </div>
      </header>

      <main className="flex-1 p-6 max-w-2xl mx-auto w-full">
        {data?.fleetStatus === 'empty' ? (
          <div className="h-64 flex items-center justify-center text-slate-600 text-xs font-mono">No projects registered.</div>
        ) : (
          <div className="flex flex-col gap-2">
            {findings.map((f, i) => (
              <Link
                key={`${f.slug}-${i}`}
                href={f.href}
                className="group relative flex items-start gap-3 rounded-lg border border-slate-800 hover:border-cyber-cyan/40 transition-colors pl-4 pr-3 py-3 overflow-hidden"
                style={{ background: 'rgba(255,255,255,0.015)' }}
              >
                {/* severity color rail */}
                <span className="absolute left-0 top-0 bottom-0 w-1" style={{ background: sevColor(f.severity) }} />
                <span
                  className="text-[0.5rem] font-black font-mono tracking-wider px-1.5 py-0.5 rounded mt-0.5 shrink-0"
                  style={{ color: sevColor(f.severity), border: `1px solid ${sevColor(f.severity)}55`, fontFamily: 'Orbitron, monospace' }}
                >
                  {sevLabel(f.severity)}
                </span>
                <span className="flex-1 text-[0.7rem] font-mono text-slate-300 leading-relaxed">{f.message}</span>
                <span className="text-[0.6rem] font-mono text-slate-600 group-hover:text-cyber-cyan transition-colors shrink-0 mt-0.5">{f.href} →</span>
              </Link>
            ))}
          </div>
        )}

        <p className="text-[0.5rem] font-mono text-slate-700 mt-4">
          Deterministic, rule-based briefing — no LLM call. Each card joins per-project convergence direction
          (latest − earliest <code>convergence_history</code> over {data?.windowDays ?? 30}d), memory churn
          (<code>memory_diff_log</code> added+removed lines), open alerts (<code>alert_events</code>), and transcript
          stall signals into a plain-language finding. Rules cover thrashing (declining convergence + high churn),
          stall, idle, open-alert backlog, and healthy. Severity drives the color rail and sort order; deep-links
          jump to the most relevant view. Reuses <code>/api/memory-convergence-xy</code> helpers. Refreshes every 60s.
        </p>
      </main>
    </div>
  )
}
