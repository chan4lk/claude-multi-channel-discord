'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import Link from 'next/link'
import type { TraceabilityResponse, ProposalEntry } from '../api/traceability/route'

function ProposalCard({ proposal }: { proposal: ProposalEntry }) {
  const isDone = proposal.status === 'done'
  const hasCommits = proposal.commits.length > 0
  return (
    <Link
      href={`/traceability?search=P${proposal.number}`}
      className="block rounded-lg border p-3 transition-all hover:border-opacity-60"
      style={{
        borderColor: isDone ? 'rgba(74,222,128,0.2)' : 'rgba(245,158,11,0.2)',
        background: isDone ? 'rgba(74,222,128,0.03)' : 'rgba(245,158,11,0.03)',
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <span
          className="text-[0.65rem] font-mono font-bold shrink-0"
          style={{ color: isDone ? '#4ADE80' : '#F59E0B' }}
        >
          P{proposal.number}
        </span>
        {!hasCommits && isDone && (
          <span className="text-[0.5rem] font-mono text-amber-500/60 shrink-0">untraced</span>
        )}
        {hasCommits && (
          <span className="text-[0.5rem] font-mono text-slate-500 shrink-0">{proposal.commits.length}c</span>
        )}
      </div>
      <p className="text-[0.65rem] font-mono text-slate-300 mt-1 leading-snug">{proposal.title}</p>
    </Link>
  )
}

export default function BacklogPage() {
  const [data, setData] = useState<TraceabilityResponse | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(() => {
    fetch('/api/traceability')
      .then((r) => r.json())
      .then((d: TraceabilityResponse) => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  const { done, pending } = useMemo(() => {
    const all = data?.proposals ?? []
    return {
      done: all.filter((p) => p.status === 'done'),
      pending: all.filter((p) => p.status === 'pending'),
    }
  }, [data])

  const total = done.length + pending.length
  const progressPct = total > 0 ? Math.round((done.length / total) * 100) : 0

  return (
    <div className="min-h-dvh flex flex-col" style={{ background: '#060d1a' }}>
      <header className="relative border-b border-cyber-cyan/12 bg-cyber-surface/70 backdrop-blur-md px-6 py-3">
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-cyber-cyan/40 to-transparent" />
        <div className="flex items-center gap-4">
          <Link href="/" className="text-[0.6rem] font-mono text-slate-500 hover:text-cyber-cyan transition-colors uppercase tracking-wider">
            ← Dashboard
          </Link>
          <h1 className="text-lg font-black tracking-[0.18em] text-cyber-cyan" style={{ fontFamily: 'Orbitron, JetBrains Mono, monospace' }}>
            BACKLOG
          </h1>
          <div className="flex-1" />
          <Link
            href="/traceability"
            className="text-[0.6rem] font-mono text-slate-500 hover:text-cyber-cyan transition-colors uppercase tracking-wider border border-slate-700 hover:border-cyber-cyan/30 px-2 py-1 rounded"
          >
            ⑂ Traceability
          </Link>
          <button
            onClick={load}
            className="text-[0.6rem] font-mono text-slate-500 hover:text-cyber-cyan transition-colors uppercase tracking-wider border border-slate-700 hover:border-cyber-cyan/30 px-2 py-1 rounded"
          >
            Refresh
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-auto p-6">
        <div className="max-w-6xl mx-auto space-y-6">
          {/* Progress bar */}
          {!loading && data && (
            <div className="rounded-lg border border-cyber-cyan/12 p-4 flex flex-col gap-3" style={{ background: 'rgba(0,245,255,0.02)' }}>
              <div className="flex items-center justify-between">
                <div className="flex gap-6">
                  <div>
                    <p className="text-[0.5rem] font-mono text-slate-600 uppercase tracking-wider">Done</p>
                    <p className="text-xl font-mono font-bold text-green-400">{done.length}</p>
                  </div>
                  <div>
                    <p className="text-[0.5rem] font-mono text-slate-600 uppercase tracking-wider">Pending</p>
                    <p className="text-xl font-mono font-bold text-amber-400">{pending.length}</p>
                  </div>
                  <div>
                    <p className="text-[0.5rem] font-mono text-slate-600 uppercase tracking-wider">Total</p>
                    <p className="text-xl font-mono font-bold text-slate-300">{total}</p>
                  </div>
                </div>
                <span className="text-2xl font-mono font-black" style={{ color: progressPct === 100 ? '#4ADE80' : '#00F5FF' }}>
                  {progressPct}%
                </span>
              </div>
              <div className="h-2 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${progressPct}%`,
                    background: progressPct === 100 ? '#4ADE80' : 'linear-gradient(to right, #00F5FF, #4ADE80)',
                  }}
                />
              </div>
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center h-64">
              <div className="text-xs font-mono text-slate-600 animate-pulse">Loading backlog…</div>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Pending column */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <h2 className="text-[0.7rem] font-mono font-bold text-amber-400 uppercase tracking-wider">
                    ◎ Pending
                  </h2>
                  <span className="text-[0.55rem] font-mono text-slate-600">({pending.length})</span>
                </div>
                {pending.length === 0 ? (
                  <div
                    className="rounded-lg border border-green-400/20 p-6 flex flex-col items-center gap-2"
                    style={{ background: 'rgba(74,222,128,0.03)' }}
                  >
                    <span className="text-2xl">✓</span>
                    <p className="text-[0.7rem] font-mono text-green-400">All caught up ✓</p>
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    {pending.map((p) => <ProposalCard key={p.number} proposal={p} />)}
                  </div>
                )}
              </div>

              {/* Done column */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <h2 className="text-[0.7rem] font-mono font-bold text-green-400 uppercase tracking-wider">
                    ✓ Done
                  </h2>
                  <span className="text-[0.55rem] font-mono text-slate-600">({done.length})</span>
                </div>
                <div className="flex flex-col gap-2 max-h-[70vh] overflow-y-auto pr-1">
                  {done.map((p) => <ProposalCard key={p.number} proposal={p} />)}
                </div>
              </div>
            </div>
          )}

          {data && (
            <p className="text-[0.5rem] font-mono text-slate-700">
              Generated {new Date(data.generatedAt).toLocaleTimeString()} · Click a card to view commit coverage in Traceability
            </p>
          )}
        </div>
      </main>
    </div>
  )
}
