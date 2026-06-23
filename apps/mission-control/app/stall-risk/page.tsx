'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import SubPageHeader from '../../components/SubPageHeader'
import type { StallRiskResponse, StallRiskProject } from '../api/stall-risk/route'

const PRE_INJECT_MESSAGE = 'Please checkpoint your progress and confirm your next step.'

function riskColor(score: number): string {
  if (score >= 80) return '#EF4444'
  if (score >= 40) return '#F59E0B'
  return '#10B981'
}

function riskLabel(score: number): string {
  if (score >= 80) return 'HIGH'
  if (score >= 40) return 'ELEVATED'
  return 'LOW'
}

function RiskBar({ score }: { score: number }) {
  const color = riskColor(score)
  return (
    <div className="h-2 w-full rounded-full overflow-hidden bg-[#1E293B]">
      <div
        className="h-full rounded-full transition-all duration-500"
        style={{ width: `${score}%`, background: color, boxShadow: `0 0 8px ${color}80` }}
      />
    </div>
  )
}

function preInject(slug: string) {
  // Open the app-wide InjectTerminal (hosted by ClientShell) pre-filled with a
  // gentle check-in prompt — same pattern as StallAlertPanel / FleetAdvisor.
  window.dispatchEvent(
    new CustomEvent('mc:inject', { detail: { slug, initialMessage: PRE_INJECT_MESSAGE } }),
  )
}

export default function StallRiskPage() {
  const [data, setData] = useState<StallRiskResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/stall-risk', { cache: 'no-store' })
      if (r.ok) setData((await r.json()) as StallRiskResponse)
    } catch {
      /* ignore */
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    intervalRef.current = setInterval(load, 60_000)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [load])

  const all = data?.projects ?? []
  const atRisk = all.filter((p) => p.score >= 40)
  const dimmed = all.filter((p) => p.score < 40)
  const high = atRisk.filter((p) => p.score >= 80).length

  return (
    <div className="min-h-screen bg-[#030712] text-slate-300">
      <SubPageHeader title="Stall Risk Forecaster">
        {data && (
          <span className="text-[0.6rem] text-slate-500 font-mono">
            {high} high · {atRisk.length} at-risk · refreshes 60s
          </span>
        )}
      </SubPageHeader>

      <div className="p-4 font-mono">
        <p className="text-[0.65rem] text-slate-600 mb-4 max-w-2xl leading-relaxed">
          Forward-looking risk score per project — context pressure (30%), turn-quality trend (30%),
          time-since-reply vs watchdog threshold (25%), and recent stall/kill history (15%). Intervene
          before a stall actually fires.
        </p>

        {loading && <div className="text-slate-600 text-sm animate-pulse">Computing stall risk…</div>}

        {data && atRisk.length === 0 && !loading && (
          <div className="flex flex-col items-center py-12 gap-2">
            <span className="text-2xl">✓</span>
            <span className="text-sm text-green-400">No projects at elevated stall risk.</span>
          </div>
        )}

        <div className="space-y-2">
          {atRisk.map((p) => (
            <RiskRow key={p.slug} p={p} />
          ))}
        </div>

        {dimmed.length > 0 && (
          <div className="mt-6">
            <div className="text-[0.55rem] text-slate-600 uppercase tracking-wider mb-2">
              Low risk ({dimmed.length})
            </div>
            <div className="space-y-2 opacity-40">
              {dimmed.map((p) => (
                <RiskRow key={p.slug} p={p} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function RiskRow({ p }: { p: StallRiskProject }) {
  const color = riskColor(p.score)
  return (
    <div className="rounded-lg border p-3" style={{ borderColor: `${color}25`, background: '#080f1c' }}>
      <div className="flex items-center gap-3 mb-2">
        <span className="text-sm font-bold text-slate-200">{p.slug}</span>
        <span
          className="text-[0.55rem] px-1.5 py-0.5 rounded border font-bold"
          style={{ color, borderColor: `${color}40`, background: `${color}10` }}
        >
          {riskLabel(p.score)}
        </span>
        <span className="text-[0.55rem] text-slate-600 uppercase">{p.state}</span>
        <span className="text-sm font-bold ml-auto" style={{ color }}>
          {p.score}
        </span>
        <button
          onClick={() => preInject(p.slug)}
          className="text-[0.6rem] px-2 py-0.5 rounded border border-slate-700 hover:border-cyber-cyan hover:text-cyber-cyan transition-colors"
          title="Open Inject Terminal with a check-in prompt"
        >
          Pre-inject
        </button>
      </div>
      <RiskBar score={p.score} />
      {p.factors.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {p.factors.map((f, i) => (
            <span
              key={i}
              className="text-[0.55rem] px-1.5 py-0.5 rounded bg-white/5 text-slate-400"
              style={i === 0 ? { color, background: `${color}12` } : undefined}
            >
              {f}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
