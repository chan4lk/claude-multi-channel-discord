'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'

type GoalStatus = 'active' | 'paused' | 'completed'

interface GoalCard {
  slug: string
  goalText: string
  status: GoalStatus
  lastModified: string | null
}

const STATUS_CONFIG: Record<GoalStatus, { label: string; color: string; bg: string; border: string; colBg: string }> = {
  active:    { label: 'Active',    color: '#A78BFA', bg: '#A78BFA18', border: '#A78BFA40', colBg: '#A78BFA08' },
  paused:    { label: 'Paused',    color: '#94a3b8', bg: '#64748b18', border: '#64748b40', colBg: '#64748b08' },
  completed: { label: 'Completed', color: '#4ADE80', bg: '#4ADE8018', border: '#4ADE8040', colBg: '#4ADE8008' },
}

const CYCLE: Record<GoalStatus, GoalStatus> = {
  active: 'paused',
  paused: 'completed',
  completed: 'active',
}

function ageLabel(iso: string | null): string {
  if (!iso) return ''
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

export default function GoalsPage() {
  const [goals, setGoals] = useState<GoalCard[]>([])
  const [loading, setLoading] = useState(true)
  const [cycling, setCycling] = useState<string | null>(null)

  const fetchGoals = useCallback(async () => {
    const res = await fetch('/api/goals')
    if (!res.ok) return
    const data = await res.json() as { goals: GoalCard[] }
    setGoals(data.goals)
    setLoading(false)
  }, [])

  useEffect(() => {
    void fetchGoals()
    const id = setInterval(() => void fetchGoals(), 30000)
    return () => clearInterval(id)
  }, [fetchGoals])

  async function cycleStatus(card: GoalCard) {
    const newStatus = CYCLE[card.status]
    setCycling(card.slug)
    try {
      await fetch(`/api/projects/${card.slug}/goal`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: card.goalText, status: newStatus }),
      })
      setGoals(prev => prev.map(g => g.slug === card.slug ? { ...g, status: newStatus } : g))
    } finally {
      setCycling(null)
    }
  }

  const columns: GoalStatus[] = ['active', 'paused', 'completed']
  const total = goals.length

  return (
    <div className="min-h-dvh bg-[#050b14] text-slate-200 p-4 sm:p-6">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <Link href="/" className="text-slate-500 hover:text-cyber-cyan transition-colors text-sm font-mono">
          ← Mission Control
        </Link>
        <h1
          className="text-lg font-bold tracking-wider uppercase"
          style={{ fontFamily: 'Orbitron, monospace', color: '#00F5FF', textShadow: '0 0 20px #00F5FF50' }}
        >
          Goal Progress Board
        </h1>
        <span className="ml-auto text-xs font-mono text-slate-600">{total} goal{total !== 1 ? 's' : ''}</span>
      </div>

      {loading ? (
        <div className="text-center py-20 text-slate-600 font-mono text-sm">Loading goals…</div>
      ) : total === 0 ? (
        <div className="text-center py-20 text-slate-600 font-mono text-sm">
          No goals set — create one with <code className="text-slate-500">GOAL.md</code> in a project directory.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {columns.map((status) => {
            const cfg = STATUS_CONFIG[status]
            const cards = goals.filter(g => g.status === status)
            return (
              <div
                key={status}
                className="rounded-xl p-4"
                style={{ background: cfg.colBg, border: `1px solid ${cfg.border}` }}
              >
                {/* Column header */}
                <div className="flex items-center gap-2 mb-3">
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ background: cfg.color, boxShadow: `0 0 6px ${cfg.color}` }}
                  />
                  <span
                    className="text-xs font-bold uppercase tracking-widest"
                    style={{ color: cfg.color }}
                  >
                    {cfg.label}
                  </span>
                  <span className="ml-auto text-xs font-mono text-slate-600">{cards.length}</span>
                </div>

                {/* Cards */}
                <div className="flex flex-col gap-3">
                  {cards.length === 0 ? (
                    <div className="text-center py-6 text-slate-700 text-xs font-mono">—</div>
                  ) : (
                    cards.map((card) => (
                      <div
                        key={card.slug}
                        className="rounded-lg p-3"
                        style={{ background: '#0a1628', border: `1px solid ${cfg.border}` }}
                      >
                        {/* Slug badge */}
                        <div className="flex items-center gap-2 mb-2">
                          <span
                            className="text-[0.6rem] font-mono font-bold px-1.5 py-0.5 rounded"
                            style={{ background: '#00F5FF15', color: '#00F5FF', border: '1px solid #00F5FF30' }}
                          >
                            {card.slug}
                          </span>
                          {card.lastModified && (
                            <span className="text-[0.6rem] font-mono text-slate-600 ml-auto">
                              {ageLabel(card.lastModified)}
                            </span>
                          )}
                        </div>

                        {/* Goal text */}
                        <p className="text-xs font-mono text-slate-300 leading-relaxed mb-2 line-clamp-3">
                          {card.goalText.slice(0, 120)}{card.goalText.length > 120 ? '…' : ''}
                        </p>

                        {/* Footer */}
                        <div className="flex items-center gap-2 mt-1">
                          <button
                            onClick={() => void cycleStatus(card)}
                            disabled={cycling === card.slug}
                            className="text-[0.6rem] font-mono font-semibold px-2 py-0.5 rounded transition-opacity disabled:opacity-50 cursor-pointer hover:opacity-80"
                            style={{ background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.border}` }}
                            title={`Click to mark ${CYCLE[card.status]}`}
                          >
                            {cfg.label} →
                          </button>
                          <Link
                            href={`/projects/${card.slug}`}
                            className="text-[0.6rem] font-mono text-slate-600 hover:text-cyber-cyan transition-colors ml-auto"
                          >
                            Timeline →
                          </Link>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      <p className="mt-6 text-center text-[0.6rem] text-slate-700 font-mono">
        Goal Progress Board · reads GOAL.md per project · refreshes every 30s
      </p>
    </div>
  )
}
