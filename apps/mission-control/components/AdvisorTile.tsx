'use client'

import { useEffect, useRef, useState } from 'react'
import type { AdvisorCard, AdvisorResponse } from '../app/api/advisor/route'

const SEVERITY_COLORS = {
  critical: '#EF4444',
  warn: '#F59E0B',
  info: '#22D3EE',
}

const SEVERITY_ICONS = {
  critical: '⚠',
  warn: '◉',
  info: '◈',
}

function ActionButton({ card, onDone }: { card: AdvisorCard; onDone: () => void }) {
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<string | null>(null)

  async function handleAction() {
    setLoading(true)
    try {
      if (card.actionType === 'inject' && card.slug) {
        const res = await fetch(`/api/inject/${encodeURIComponent(card.slug)}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ message: card.actionPayload }),
        })
        setResult(res.ok ? 'Injected ✓' : 'Failed')
      } else if (card.actionType === 'distill' && card.slug) {
        const res = await fetch(`/api/memories/${encodeURIComponent(card.slug)}/distill`, {
          method: 'POST',
        })
        setResult(res.ok ? 'Distilling ✓' : 'Failed')
      } else {
        setResult('OK')
      }
    } catch {
      setResult('Error')
    }
    setLoading(false)
    setTimeout(onDone, 1500)
  }

  if (result) {
    return <span className="text-[0.55rem] font-mono" style={{ color: '#4ADE80' }}>{result}</span>
  }

  return (
    <button
      onClick={handleAction}
      disabled={loading}
      className="text-[0.55rem] font-mono px-1.5 py-0.5 rounded border transition-colors disabled:opacity-50"
      style={{ borderColor: '#22D3EE30', color: '#22D3EE', background: '#22D3EE0d' }}
    >
      {loading ? '…' : card.actionType === 'inject' ? 'Inject →' : card.actionType === 'distill' ? 'Distill →' : 'Run →'}
    </button>
  )
}

export default function AdvisorTile() {
  const [recs, setRecs] = useState<AdvisorCard[]>([])
  const [loading, setLoading] = useState(true)
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false
    return localStorage.getItem('advisor-tile-collapsed') === '1'
  })
  const [lastRefresh, setLastRefresh] = useState(0)
  const mountedRef = useRef(true)

  function toggleCollapsed() {
    const next = !collapsed
    setCollapsed(next)
    localStorage.setItem('advisor-tile-collapsed', next ? '1' : '0')
  }

  async function fetchAdvisor() {
    try {
      const res = await fetch('/api/advisor')
      if (res.ok && mountedRef.current) {
        const data: AdvisorResponse = await res.json()
        setRecs(data.recommendations.slice(0, 3))
        setLastRefresh(Date.now())
      }
    } catch {}
    if (mountedRef.current) setLoading(false)
  }

  useEffect(() => {
    mountedRef.current = true
    fetchAdvisor()
    const id = setInterval(fetchAdvisor, 60_000)
    return () => {
      mountedRef.current = false
      clearInterval(id)
    }
  }, [])

  const hasCritical = recs.some((r) => r.severity === 'critical')

  return (
    <div
      className="rounded-lg border overflow-hidden"
      style={{ borderColor: hasCritical ? '#EF444430' : 'rgba(255,255,255,0.06)', background: '#070e1b' }}
    >
      {/* Header */}
      <button
        onClick={toggleCollapsed}
        className="w-full flex items-center gap-2 px-4 py-2.5 hover:bg-white/3 transition-colors"
      >
        <span className="text-xs font-mono text-slate-400 flex items-center gap-2">
          <span style={{ color: '#A78BFA' }}>◆</span>
          Fleet Advisor
          {hasCritical && (
            <span
              className="ml-1 text-[0.55rem] px-1 rounded animate-pulse font-bold"
              style={{ background: '#EF444420', color: '#EF4444', border: '1px solid #EF444430' }}
            >
              {recs.filter((r) => r.severity === 'critical').length} CRITICAL
            </span>
          )}
        </span>
        <span className="ml-auto text-[0.55rem] text-slate-600 font-mono">
          {collapsed ? '▼ expand' : '▲ collapse'}
        </span>
      </button>

      {!collapsed && (
        <div className="px-4 pb-3 flex flex-col gap-2">
          {loading ? (
            <div className="text-[0.6rem] text-slate-600 font-mono animate-pulse">Analyzing fleet…</div>
          ) : recs.length === 0 ? (
            <div className="flex items-center gap-2 py-2">
              <span style={{ color: '#4ADE80' }}>✓</span>
              <span className="text-[0.65rem] font-mono text-slate-500">Fleet healthy — no recommendations</span>
            </div>
          ) : (
            recs.map((rec) => {
              const color = SEVERITY_COLORS[rec.severity]
              return (
                <div
                  key={rec.id}
                  className="flex items-start gap-3 rounded p-2.5 border"
                  style={{ background: `${color}08`, borderColor: `${color}20` }}
                >
                  <span className="shrink-0 mt-0.5 font-mono" style={{ color }}>
                    {SEVERITY_ICONS[rec.severity]}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-[0.65rem] font-mono font-semibold" style={{ color }}>
                      {rec.title}
                      {rec.slug && (
                        <span className="ml-1.5 text-[0.55rem] opacity-60 font-normal">{rec.slug}</span>
                      )}
                    </div>
                    <div className="text-[0.6rem] text-slate-500 mt-0.5 leading-relaxed">{rec.explanation}</div>
                  </div>
                  <div className="shrink-0">
                    <ActionButton card={rec} onDone={fetchAdvisor} />
                  </div>
                </div>
              )
            })
          )}
          {lastRefresh > 0 && (
            <div className="text-[0.5rem] text-slate-700 font-mono mt-1">
              Refreshed {Math.round((Date.now() - lastRefresh) / 1000)}s ago · auto-refresh 60s
            </div>
          )}
        </div>
      )}
    </div>
  )
}
