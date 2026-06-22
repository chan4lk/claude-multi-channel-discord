'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import type { ContextPressureResponse, ContextPressureProject } from '../api/context-pressure/route'

function scoreColor(score: number): string {
  if (score >= 90) return '#EF4444'
  if (score >= 70) return '#F59E0B'
  return '#10B981'
}

function scoreLabel(score: number): string {
  if (score >= 90) return 'CRITICAL'
  if (score >= 70) return 'WARNING'
  return 'OK'
}

function TrendLine({ trend }: { trend: Array<{ ts: number; score: number }> }) {
  const sorted = [...trend].sort((a, b) => a.ts - b.ts)
  if (sorted.length < 2) return <span className="text-slate-700 text-[0.5rem]">—</span>
  const W = 80, H = 20
  const maxScore = Math.max(...sorted.map((t) => t.score), 1)
  const points = sorted.map((t, i) => {
    const x = (i / (sorted.length - 1)) * W
    const y = H - (t.score / maxScore) * H
    return `${x},${y}`
  }).join(' ')
  const last = sorted[sorted.length - 1].score
  return (
    <svg width={W} height={H} className="overflow-visible">
      <polyline points={points} fill="none" stroke={scoreColor(last)} strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function StackedBar({ proj }: { proj: ContextPressureProject }) {
  const { systemTokens, historyTokens, toolTokens } = proj.breakdown
  const total = proj.contextLimit
  const sysPct = Math.min(100, (systemTokens / total) * 100)
  const hisPct = Math.min(100 - sysPct, (historyTokens / total) * 100)
  const toolPct = Math.min(100 - sysPct - hisPct, (toolTokens / total) * 100)

  return (
    <div className="flex h-4 w-full rounded overflow-hidden gap-px">
      <div style={{ width: `${sysPct}%`, background: '#3B82F6' }} title={`System: ${systemTokens.toLocaleString()} tokens`} />
      <div style={{ width: `${hisPct}%`, background: '#8B5CF6' }} title={`History: ${historyTokens.toLocaleString()} tokens`} />
      <div style={{ width: `${toolPct}%`, background: '#F59E0B' }} title={`Tools: ${toolTokens.toLocaleString()} tokens`} />
      <div style={{ flex: 1, background: '#1E293B' }} />
    </div>
  )
}

async function injectCompact(slug: string) {
  try {
    await fetch(`/api/inject/${slug}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: '[OPERATOR] Please summarize your context and continue.' }),
    })
  } catch { /* ignore */ }
}

export default function ContextPressurePage() {
  const [data, setData] = useState<ContextPressureResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [injecting, setInjecting] = useState<Record<string, boolean>>({})
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  async function load() {
    try {
      const r = await fetch('/api/context-pressure')
      if (r.ok) setData(await r.json() as ContextPressureResponse)
    } catch { /* ignore */ } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    intervalRef.current = setInterval(load, 60_000)
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [])

  const handleCompact = async (slug: string) => {
    setInjecting((p) => ({ ...p, [slug]: true }))
    await injectCompact(slug)
    setTimeout(() => setInjecting((p) => ({ ...p, [slug]: false })), 2000)
  }

  const critical = data?.projects.filter((p) => p.score >= 90) ?? []
  const warning = data?.projects.filter((p) => p.score >= 70 && p.score < 90) ?? []

  return (
    <div className="min-h-screen bg-[#030712] text-slate-300 font-mono p-4">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Link href="/" className="text-slate-600 hover:text-cyber-cyan text-sm">←</Link>
        <h1 className="text-lg font-bold tracking-widest text-cyber-cyan uppercase">Context Pressure Monitor</h1>
        {data && (
          <span className="ml-auto text-[0.6rem] text-slate-600">
            computed {new Date(data.computedAt).toLocaleTimeString()} · refreshes 60s
          </span>
        )}
      </div>

      {/* Summary chips */}
      {data && (
        <div className="flex gap-2 mb-6 flex-wrap">
          <span className="px-2 py-1 rounded text-[0.6rem] border" style={{ borderColor: '#EF444430', color: '#EF4444', background: '#EF444410' }}>
            {critical.length} CRITICAL ≥90%
          </span>
          <span className="px-2 py-1 rounded text-[0.6rem] border" style={{ borderColor: '#F59E0B30', color: '#F59E0B', background: '#F59E0B10' }}>
            {warning.length} WARNING ≥70%
          </span>
          <span className="px-2 py-1 rounded text-[0.6rem] border" style={{ borderColor: '#10B98130', color: '#10B981', background: '#10B98110' }}>
            {(data.projects.length - critical.length - warning.length)} OK
          </span>
        </div>
      )}

      {/* Legend */}
      <div className="flex gap-4 mb-4 text-[0.55rem] text-slate-600">
        <span><span className="inline-block w-2 h-2 rounded mr-1" style={{ background: '#3B82F6' }} />System prompt</span>
        <span><span className="inline-block w-2 h-2 rounded mr-1" style={{ background: '#8B5CF6' }} />Conversation history</span>
        <span><span className="inline-block w-2 h-2 rounded mr-1" style={{ background: '#F59E0B' }} />Tool results</span>
      </div>

      {loading && (
        <div className="text-slate-600 text-sm animate-pulse">Computing context pressure…</div>
      )}

      {data && (
        <div className="space-y-3">
          {data.projects.map((proj) => {
            const color = scoreColor(proj.score)
            const label = scoreLabel(proj.score)
            return (
              <div
                key={proj.slug}
                className="rounded-lg border p-3"
                style={{ borderColor: `${color}25`, background: '#080f1c' }}
              >
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-sm font-bold text-slate-200">{proj.slug}</span>
                  <span
                    className="text-[0.55rem] px-1.5 py-0.5 rounded border font-bold"
                    style={{ color, borderColor: `${color}40`, background: `${color}10` }}
                  >
                    {label}
                  </span>
                  <span className="text-sm font-bold ml-auto" style={{ color }}>
                    {proj.score}%
                  </span>
                  <button
                    onClick={() => handleCompact(proj.slug)}
                    disabled={!!injecting[proj.slug]}
                    className="text-[0.6rem] px-2 py-0.5 rounded border border-slate-700 hover:border-cyber-cyan hover:text-cyber-cyan transition-colors disabled:opacity-40"
                  >
                    {injecting[proj.slug] ? 'Sent' : 'Compact'}
                  </button>
                </div>

                <StackedBar proj={proj} />

                <div className="flex items-center gap-4 mt-2 text-[0.55rem] text-slate-600">
                  <span>{proj.usedTokens.toLocaleString()} / {proj.contextLimit.toLocaleString()} tokens</span>
                  <span>sys {proj.breakdown.systemTokens.toLocaleString()}</span>
                  <span>hist {proj.breakdown.historyTokens.toLocaleString()}</span>
                  <span>tools {proj.breakdown.toolTokens.toLocaleString()}</span>
                  <span className="ml-auto flex items-center gap-2">
                    <span>7-day</span>
                    <TrendLine trend={proj.trend} />
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {data && data.projects.length === 0 && (
        <div className="text-slate-600 text-sm">No projects found.</div>
      )}
    </div>
  )
}
