'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import type { AdvisorCard, AdvisorResponse } from '../app/api/advisor/route'
import type { StallRiskResponse, StallRiskProject } from '../app/api/stall-risk/route'

const STORAGE_KEY = 'mc_advisor_open'
const REFRESH_INTERVAL_MS = 5 * 60_000

const SEV_COLORS: Record<string, { border: string; badge: string; text: string }> = {
  critical: { border: '#EF4444', badge: 'bg-red-500/20 text-red-400', text: 'text-red-400' },
  warn: { border: '#F59E0B', badge: 'bg-amber-500/20 text-amber-400', text: 'text-amber-400' },
  info: { border: '#00F5FF', badge: 'bg-cyan-500/10 text-cyan-400', text: 'text-cyan-400' },
}

function ActionButton({ card }: { card: AdvisorCard }) {
  const [copied, setCopied] = useState(false)

  function handleClick() {
    if (card.actionType === 'inject' && card.slug) {
      window.dispatchEvent(
        new CustomEvent('mc:inject', {
          detail: { slug: card.slug, initialMessage: card.actionPayload },
        })
      )
    } else if (card.actionType === 'distill' && card.slug) {
      fetch(`/api/memory/${card.slug}/distill`, { method: 'POST' }).catch(() => {})
    } else {
      navigator.clipboard.writeText(card.actionPayload).catch(() => {})
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const label =
    card.actionType === 'inject'
      ? 'Inject'
      : card.actionType === 'distill'
        ? 'Distill now'
        : copied
          ? 'Copied!'
          : 'Copy cmd'

  return (
    <button
      onClick={handleClick}
      className="mt-2 px-2 py-0.5 rounded border text-[0.65rem] font-mono uppercase tracking-wider transition-opacity hover:opacity-80"
      style={{ borderColor: SEV_COLORS[card.severity].border, color: SEV_COLORS[card.severity].text }}
    >
      {label}
    </button>
  )
}

function AdvisorCard({ card }: { card: AdvisorCard }) {
  const { border, badge } = SEV_COLORS[card.severity]
  return (
    <div
      className="rounded p-2.5 flex flex-col gap-1"
      style={{
        border: `1px solid ${border}33`,
        background: `${border}08`,
        boxShadow: `inset 0 0 8px ${border}18`,
      }}
    >
      <div className="flex items-center gap-1.5">
        <span className={`text-[0.6rem] font-mono uppercase px-1.5 py-0.5 rounded ${badge}`}>
          {card.severity}
        </span>
        {card.slug && (
          <span className="text-[0.6rem] font-mono text-slate-500 bg-slate-800 rounded px-1 py-0.5">
            {card.slug}
          </span>
        )}
      </div>
      <p className="text-[0.7rem] font-mono text-slate-200 leading-snug">{card.title}</p>
      <p className="text-[0.65rem] text-slate-400 leading-snug">{card.explanation}</p>
      <ActionButton card={card} />
    </div>
  )
}

export default function FleetAdvisorPanel() {
  const [open, setOpen] = useState<boolean>(() => {
    try { return localStorage.getItem(STORAGE_KEY) === '1' } catch { return false }
  })
  const [data, setData] = useState<AdvisorResponse | null>(null)
  const [stallRisk, setStallRisk] = useState<StallRiskProject[]>([])
  const [loading, setLoading] = useState(false)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/advisor')
      if (res.ok) setData(await res.json() as AdvisorResponse)
    } catch {}
    try {
      const res = await fetch('/api/stall-risk', { cache: 'no-store' })
      if (res.ok) {
        const d = await res.json() as StallRiskResponse
        setStallRisk(d.projects.filter((p) => p.score >= 40).slice(0, 3))
      }
    } catch {}
    setLoading(false)
  }, [])

  useEffect(() => {
    refresh()
    timerRef.current = setInterval(refresh, REFRESH_INTERVAL_MS)
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [refresh])

  // Toggle with 'A' key
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (
        e.key === 'a' || e.key === 'A' &&
        !e.ctrlKey && !e.metaKey && !e.altKey &&
        !(document.activeElement instanceof HTMLInputElement) &&
        !(document.activeElement instanceof HTMLTextAreaElement)
      ) {
        setOpen((prev) => {
          const next = !prev
          try { localStorage.setItem(STORAGE_KEY, next ? '1' : '0') } catch {}
          return next
        })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const recs = data?.recommendations ?? []
  const checkedAt = data?.generatedAt
    ? new Date(data.generatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : null

  return (
    <div
      className="fixed bottom-4 right-4 z-50 flex flex-col"
      style={{ width: open ? 300 : 'auto' }}
    >
      {/* Toggle button */}
      <div className="flex justify-end mb-1">
        <button
          onClick={() => setOpen((prev) => {
            const next = !prev
            try { localStorage.setItem(STORAGE_KEY, next ? '1' : '0') } catch {}
            return next
          })}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded border border-cyan-500/40 text-[0.65rem] font-mono text-cyan-400 hover:bg-cyan-500/10 transition-colors"
          style={{ background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(8px)' }}
          title="Toggle Fleet Advisor (A)"
        >
          <span>⚡</span>
          <span>Advisor</span>
          {recs.some((r) => r.severity === 'critical') && (
            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
          )}
          {!recs.some((r) => r.severity === 'critical') && recs.some((r) => r.severity === 'warn') && (
            <span className="w-2 h-2 rounded-full bg-amber-500" />
          )}
        </button>
      </div>

      {/* Panel */}
      {open && (
        <div
          className="rounded border border-cyan-500/30 overflow-hidden"
          style={{ background: 'rgba(5,10,20,0.95)', backdropFilter: 'blur(12px)' }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-cyan-500/20">
            <span className="text-[0.7rem] font-mono text-cyan-400 uppercase tracking-wider">Fleet Advisor</span>
            <div className="flex items-center gap-2">
              {checkedAt && (
                <span className="text-[0.55rem] text-slate-600 font-mono">checked {checkedAt}</span>
              )}
              <button
                onClick={() => refresh()}
                disabled={loading}
                className="text-[0.6rem] font-mono text-slate-500 hover:text-cyan-400 transition-colors"
                title="Refresh"
              >
                {loading ? '…' : '↺'}
              </button>
            </div>
          </div>

          {/* Stall risk widget (P148, AC6) — top 3 at-risk projects */}
          {stallRisk.length > 0 && (
            <div className="px-2 pt-2">
              <Link
                href="/stall-risk"
                className="block rounded border border-amber-500/25 bg-amber-500/5 p-2 hover:bg-amber-500/10 transition-colors"
              >
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[0.6rem] font-mono text-amber-400 uppercase tracking-wider">⚠ Stall Risk</span>
                  <span className="text-[0.55rem] font-mono text-slate-500">view all →</span>
                </div>
                <div className="flex flex-col gap-1">
                  {stallRisk.map((p) => (
                    <div key={p.slug} className="flex items-center gap-2">
                      <span className="text-[0.6rem] font-mono text-slate-300 truncate flex-1">{p.slug}</span>
                      <span
                        className="text-[0.6rem] font-mono font-bold"
                        style={{ color: p.score >= 80 ? '#EF4444' : '#F59E0B' }}
                      >
                        {p.score}
                      </span>
                    </div>
                  ))}
                </div>
              </Link>
            </div>
          )}

          {/* Cards */}
          <div className="flex flex-col gap-2 p-2 max-h-[70vh] overflow-y-auto">
            {recs.length === 0 ? (
              <div className="flex flex-col items-center py-6 gap-2">
                <span className="text-2xl">✓</span>
                <span className="text-[0.7rem] font-mono text-green-400">Fleet looks healthy</span>
              </div>
            ) : (
              recs.map((card) => <AdvisorCard key={card.id} card={card} />)
            )}
          </div>
        </div>
      )}
    </div>
  )
}
