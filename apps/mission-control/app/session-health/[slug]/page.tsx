'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'

interface KpiData {
  contextPct: number
  convergence: number | null
  goalPct: number | null
  turnsToday: number
  contextTrend: Array<{ ts: number; score: number }>
  convergenceTrend: Array<{ date: string; score: number }>
  goalTrend: Array<{ date: string; score: number }>
  alerts: Array<{ ts: number; alert_type: string; description: string }>
  stuckSnippets: Array<{ ts: string; text: string }>
}

function Sparkline({ points, color = '#22D3EE' }: { points: number[]; color?: string }) {
  if (points.length < 2) return <span className="text-slate-700 text-[0.5rem]">—</span>
  const W = 96, H = 24
  const max = Math.max(...points, 1)
  const pts = points.map((v, i) => {
    const x = (i / (points.length - 1)) * W
    const y = H - (v / max) * H
    return `${x},${y}`
  }).join(' ')
  return (
    <svg width={W} height={H} className="overflow-visible">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function KpiCard({
  label,
  value,
  unit,
  color,
  sparkPoints,
  sparkColor,
}: {
  label: string
  value: string | number
  unit?: string
  color: string
  sparkPoints?: number[]
  sparkColor?: string
}) {
  return (
    <div className="rounded-lg border p-3" style={{ borderColor: `${color}25`, background: '#080f1c' }}>
      <div className="text-[0.55rem] text-slate-600 uppercase tracking-widest mb-1">{label}</div>
      <div className="text-2xl font-bold" style={{ color }}>
        {value}
        {unit && <span className="text-sm ml-0.5 text-slate-500">{unit}</span>}
      </div>
      {sparkPoints && sparkPoints.length > 1 && (
        <div className="mt-2">
          <Sparkline points={sparkPoints} color={sparkColor ?? color} />
        </div>
      )}
    </div>
  )
}

async function fetchKpi(slug: string): Promise<KpiData> {
  const [ctxRes, convRes, goalRes, alertRes, narrativeRes] = await Promise.allSettled([
    fetch('/api/context-pressure'),
    fetch(`/api/convergence?slug=${encodeURIComponent(slug)}`),
    fetch(`/api/goal-radar`),
    fetch(`/api/alerts?slug=${encodeURIComponent(slug)}&limit=10`),
    fetch(`/api/narrative?slugs=${encodeURIComponent(slug)}&since=${new Date(Date.now() - 86400000).toISOString().slice(0, 10)}`),
  ])

  let contextPct = 0
  let contextTrend: Array<{ ts: number; score: number }> = []
  if (ctxRes.status === 'fulfilled' && ctxRes.value.ok) {
    const d = await ctxRes.value.json() as { projects: Array<{ slug: string; score: number; trend: Array<{ ts: number; score: number }> }> }
    const proj = d.projects.find((p) => p.slug === slug)
    if (proj) { contextPct = proj.score; contextTrend = proj.trend }
  }

  let convergence: number | null = null
  let convergenceTrend: Array<{ date: string; score: number }> = []
  if (convRes.status === 'fulfilled' && convRes.value.ok) {
    const d = await convRes.value.json() as { history: Array<{ date: string; score: number }> }
    convergenceTrend = d.history ?? []
    convergence = convergenceTrend.length > 0 ? convergenceTrend[convergenceTrend.length - 1].score : null
  }

  let goalPct: number | null = null
  let goalTrend: Array<{ date: string; score: number }> = []
  if (goalRes.status === 'fulfilled' && goalRes.value.ok) {
    const d = await goalRes.value.json() as { projects: Array<{ slug: string; score: number; history: Array<{ date: string; score: number }> }> }
    const proj = d.projects.find((p) => p.slug === slug)
    if (proj) { goalPct = proj.score; goalTrend = proj.history }
  }

  let alerts: Array<{ ts: number; alert_type: string; description: string }> = []
  if (alertRes.status === 'fulfilled' && alertRes.value.ok) {
    const d = await alertRes.value.json() as { alerts?: typeof alerts }
    alerts = d.alerts ?? []
  }

  let turnsToday = 0
  let stuckSnippets: Array<{ ts: string; text: string }> = []
  if (narrativeRes.status === 'fulfilled' && narrativeRes.value.ok) {
    const d = await narrativeRes.value.json() as { turns: Array<{ role: string; text: string; ts: string }> }
    turnsToday = d.turns.length
    stuckSnippets = d.turns
      .filter((t) => /\bstuck\b/i.test(t.text))
      .slice(-5)
      .map((t) => ({ ts: t.ts, text: t.text.slice(0, 120) }))
  }

  return {
    contextPct,
    convergence,
    goalPct,
    turnsToday,
    contextTrend,
    convergenceTrend,
    goalTrend,
    alerts,
    stuckSnippets,
  }
}

function alertTypeColor(type: string): string {
  if (type.includes('stuck') || type.includes('critical')) return '#EF4444'
  if (type.includes('warn') || type.includes('context')) return '#F59E0B'
  return '#22D3EE'
}

export default function SessionHealthPage() {
  const params = useParams<{ slug: string }>()
  const slug = decodeURIComponent(params.slug ?? '')
  const [kpi, setKpi] = useState<KpiData | null>(null)
  const [loading, setLoading] = useState(true)
  const [actionMsg, setActionMsg] = useState('')

  useEffect(() => {
    if (!slug) return
    fetchKpi(slug).then(setKpi).catch(() => {}).finally(() => setLoading(false))
  }, [slug])

  async function doCompact() {
    setActionMsg('Sending compact prompt…')
    try {
      await fetch(`/api/inject/${slug}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: '[OPERATOR] Please summarize your context and continue.' }),
      })
      setActionMsg('Compact sent ✓')
    } catch { setActionMsg('Error sending compact') }
    setTimeout(() => setActionMsg(''), 3000)
  }

  async function doStop() {
    setActionMsg('Stopping…')
    try {
      await fetch(`/api/stop/${slug}`, { method: 'POST' })
      setActionMsg('Stop sent ✓')
    } catch { setActionMsg('Error stopping') }
    setTimeout(() => setActionMsg(''), 3000)
  }

  const ctxColor = kpi ? (kpi.contextPct >= 90 ? '#EF4444' : kpi.contextPct >= 70 ? '#F59E0B' : '#10B981') : '#22D3EE'

  return (
    <div className="min-h-screen bg-[#030712] text-slate-300 font-mono p-4">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Link href="/" className="text-slate-600 hover:text-cyber-cyan text-sm">←</Link>
        <h1 className="text-lg font-bold tracking-widest text-cyber-cyan uppercase">Session Health</h1>
        <span className="text-slate-500 text-sm">/ {slug}</span>
        <Link
          href={`/projects/${encodeURIComponent(slug)}`}
          className="ml-auto text-[0.6rem] text-slate-600 hover:text-cyber-cyan"
        >
          Project →
        </Link>
      </div>

      {loading && <div className="text-slate-600 animate-pulse text-sm">Loading health data…</div>}

      {kpi && (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
            <KpiCard
              label="Context Pressure"
              value={kpi.contextPct}
              unit="%"
              color={ctxColor}
              sparkPoints={[...kpi.contextTrend].sort((a, b) => a.ts - b.ts).map((t) => t.score)}
              sparkColor={ctxColor}
            />
            <KpiCard
              label="Convergence"
              value={kpi.convergence ?? '—'}
              unit={kpi.convergence != null ? '/100' : ''}
              color="#A855F7"
              sparkPoints={[...kpi.convergenceTrend].sort((a, b) => a.date.localeCompare(b.date)).map((t) => t.score)}
              sparkColor="#A855F7"
            />
            <KpiCard
              label="Goal Advancement"
              value={kpi.goalPct ?? '—'}
              unit={kpi.goalPct != null ? '%' : ''}
              color="#10B981"
              sparkPoints={[...kpi.goalTrend].sort((a, b) => a.date.localeCompare(b.date)).map((t) => t.score)}
              sparkColor="#10B981"
            />
            <KpiCard
              label="Turns Today"
              value={kpi.turnsToday}
              color="#F59E0B"
            />
          </div>

          {/* Actions */}
          <div className="rounded-lg border border-white/5 p-3 mb-6 bg-[#080f1c]">
            <div className="text-[0.6rem] text-slate-600 uppercase tracking-widest mb-3">Session Actions</div>
            <div className="flex flex-wrap gap-2 items-center">
              <button
                onClick={doCompact}
                className="text-[0.65rem] px-3 py-1.5 rounded border border-cyber-cyan/30 text-cyber-cyan hover:bg-cyber-cyan/10 transition-colors"
              >
                Compact
              </button>
              <button
                onClick={doStop}
                className="text-[0.65rem] px-3 py-1.5 rounded border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-colors"
              >
                Stop
              </button>
              <Link
                href={`/turns?slug=${encodeURIComponent(slug)}`}
                className="text-[0.65rem] px-3 py-1.5 rounded border border-white/10 text-slate-400 hover:border-slate-400 transition-colors"
              >
                Turn Viewer
              </Link>
              <Link
                href={`/narrative?slugs=${encodeURIComponent(slug)}`}
                className="text-[0.65rem] px-3 py-1.5 rounded border border-white/10 text-slate-400 hover:border-slate-400 transition-colors"
              >
                Narrative
              </Link>
              <Link
                href={`/context-pressure`}
                className="text-[0.65rem] px-3 py-1.5 rounded border border-white/10 text-slate-400 hover:border-slate-400 transition-colors"
              >
                Context Pressure
              </Link>
              {actionMsg && (
                <span className="text-[0.6rem] text-slate-500 ml-2">{actionMsg}</span>
              )}
            </div>
          </div>

          {/* Alerts */}
          <div className="rounded-lg border border-white/5 p-3 mb-4 bg-[#080f1c]">
            <div className="text-[0.6rem] text-slate-600 uppercase tracking-widest mb-3">
              Recent Alerts ({kpi.alerts.length})
            </div>
            {kpi.alerts.length === 0 && (
              <div className="text-slate-700 text-[0.6rem]">No alerts.</div>
            )}
            <div className="space-y-2">
              {kpi.alerts.map((a, i) => (
                <div key={i} className="flex gap-3 text-[0.6rem]">
                  <span className="text-slate-600 flex-shrink-0">
                    {new Date(a.ts * 1000).toLocaleTimeString()}
                  </span>
                  <span
                    className="px-1.5 rounded flex-shrink-0"
                    style={{ color: alertTypeColor(a.alert_type), background: `${alertTypeColor(a.alert_type)}15` }}
                  >
                    {a.alert_type}
                  </span>
                  <span className="text-slate-400 truncate">{a.description}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Stuck snippets */}
          {kpi.stuckSnippets.length > 0 && (
            <div className="rounded-lg border border-red-500/10 p-3 bg-[#080f1c]">
              <div className="text-[0.6rem] text-red-400/70 uppercase tracking-widest mb-3">
                Stuck Signals ({kpi.stuckSnippets.length})
              </div>
              <div className="space-y-2">
                {kpi.stuckSnippets.map((s, i) => (
                  <div key={i} className="text-[0.6rem]">
                    <span className="text-slate-600 mr-2">{new Date(s.ts).toLocaleTimeString()}</span>
                    <span className="text-slate-500">{s.text}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
