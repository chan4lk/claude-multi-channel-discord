'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import Link from 'next/link'
import type { TraceabilityResponse, ProposalEntry } from '../api/traceability/route'

type StatusFilter = 'all' | 'done' | 'pending'

function CommitBadge({ sha, message, date, repoUrl }: { sha: string; message: string; date: string; repoUrl: string | null }) {
  const short = sha.slice(0, 7)
  const href = repoUrl ? `${repoUrl}/commit/${sha}` : null
  return (
    <div className="flex items-start gap-2 py-0.5">
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[0.55rem] font-mono px-1.5 py-0.5 rounded transition-colors hover:text-amber-300"
          style={{ color: '#F59E0B', border: '1px solid rgba(245,158,11,0.3)', background: 'rgba(245,158,11,0.06)', whiteSpace: 'nowrap' }}
        >
          {short} ↗
        </a>
      ) : (
        <span
          className="text-[0.55rem] font-mono px-1.5 py-0.5 rounded"
          style={{ color: '#F59E0B', border: '1px solid rgba(245,158,11,0.3)', background: 'rgba(245,158,11,0.06)', whiteSpace: 'nowrap' }}
        >
          {short}
        </span>
      )}
      <span className="text-[0.6rem] font-mono text-slate-400 leading-tight">{message}</span>
    </div>
  )
}

function ProposalRow({ proposal, repoUrl }: { proposal: ProposalEntry; repoUrl: string | null }) {
  const [open, setOpen] = useState(false)
  const isDone = proposal.status === 'done'
  const hasCommits = proposal.commits.length > 0

  return (
    <>
      <tr
        className="border-b border-cyber-cyan/6 cursor-pointer transition-colors"
        style={{ background: open ? 'rgba(0,245,255,0.03)' : 'transparent' }}
        onClick={() => setOpen((o) => !o)}
      >
        <td className="px-4 py-2.5 w-16">
          <span className="text-[0.65rem] font-mono font-bold" style={{ color: isDone ? '#4ADE80' : '#F59E0B' }}>
            P{proposal.number}
          </span>
        </td>
        <td className="px-4 py-2.5">
          <span className="text-xs font-mono text-slate-200">{proposal.title}</span>
        </td>
        <td className="px-4 py-2.5 text-center w-20">
          <span
            className="text-[0.55rem] font-mono px-1.5 py-0.5 rounded uppercase tracking-wider"
            style={{
              color: isDone ? '#4ADE80' : '#F59E0B',
              border: `1px solid ${isDone ? 'rgba(74,222,128,0.3)' : 'rgba(245,158,11,0.3)'}`,
              background: isDone ? 'rgba(74,222,128,0.06)' : 'rgba(245,158,11,0.06)',
            }}
          >
            {proposal.status}
          </span>
        </td>
        <td className="px-4 py-2.5 text-right w-24">
          {hasCommits ? (
            <span className="text-[0.6rem] font-mono text-amber-400">{proposal.commits.length} commit{proposal.commits.length !== 1 ? 's' : ''}</span>
          ) : (
            <span className="text-[0.6rem] font-mono text-amber-500/60">untraced</span>
          )}
        </td>
        <td className="px-4 py-2.5 text-center w-8">
          <span
            className="text-[0.55rem] font-mono text-slate-500 transition-transform inline-block"
            style={{ transform: open ? 'rotate(90deg)' : 'none' }}
          >▶</span>
        </td>
      </tr>
      {open && (
        <tr style={{ background: 'rgba(0,245,255,0.015)' }}>
          <td />
          <td colSpan={4} className="px-6 py-3 border-b border-cyber-cyan/6">
            {hasCommits ? (
              <div className="flex flex-col gap-1">
                {proposal.commits.map((c) => (
                  <CommitBadge key={c.sha} {...c} repoUrl={repoUrl} />
                ))}
              </div>
            ) : (
              <span className="text-[0.6rem] font-mono text-amber-500/70">
                No commits reference P{proposal.number} in their subject line.
              </span>
            )}
          </td>
        </tr>
      )}
    </>
  )
}

export default function TraceabilityPage() {
  const [data, setData] = useState<TraceabilityResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<StatusFilter>('all')
  const [search, setSearch] = useState('')

  const load = useCallback(() => {
    fetch('/api/traceability')
      .then((r) => r.json())
      .then((d: TraceabilityResponse) => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  const proposals = useMemo(() => {
    let list = data?.proposals ?? []
    if (filter !== 'all') list = list.filter((p) => p.status === filter)
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter((p) =>
        p.title.toLowerCase().includes(q) ||
        `p${p.number}`.includes(q)
      )
    }
    return list
  }, [data, filter, search])

  const stats = useMemo(() => {
    const all = data?.proposals ?? []
    return {
      total: all.length,
      done: all.filter((p) => p.status === 'done').length,
      pending: all.filter((p) => p.status === 'pending').length,
      untraced: all.filter((p) => p.commits.length === 0).length,
    }
  }, [data])

  return (
    <div className="min-h-dvh flex flex-col" style={{ background: '#060d1a' }}>
      <header className="relative border-b border-cyber-cyan/12 bg-cyber-surface/70 backdrop-blur-md px-6 py-3">
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-cyber-cyan/40 to-transparent" />
        <div className="flex items-center gap-4">
          <Link href="/" className="text-[0.6rem] font-mono text-slate-500 hover:text-cyber-cyan transition-colors uppercase tracking-wider">
            ← Dashboard
          </Link>
          <h1 className="text-lg font-black tracking-[0.18em] text-cyber-cyan" style={{ fontFamily: 'Orbitron, JetBrains Mono, monospace' }}>
            TRACEABILITY
          </h1>
          <div className="flex-1" />
          <button
            onClick={load}
            className="text-[0.6rem] font-mono text-slate-500 hover:text-cyber-cyan transition-colors uppercase tracking-wider border border-slate-700 hover:border-cyber-cyan/30 px-2 py-1 rounded"
          >
            Refresh
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-auto p-6">
        <div className="max-w-5xl mx-auto space-y-4">
          {/* Stats */}
          {!loading && data && (
            <div className="flex flex-wrap gap-4">
              {[
                { label: 'Total', value: stats.total, color: '#94A3B8' },
                { label: 'Done', value: stats.done, color: '#4ADE80' },
                { label: 'Pending', value: stats.pending, color: '#F59E0B' },
                { label: 'Untraced', value: stats.untraced, color: '#EF4444' },
              ].map(({ label, value, color }) => (
                <div
                  key={label}
                  className="rounded-lg px-4 py-2 border"
                  style={{ borderColor: `${color}30`, background: `${color}08` }}
                >
                  <p className="text-[0.55rem] font-mono uppercase tracking-wider" style={{ color: `${color}99` }}>{label}</p>
                  <p className="text-lg font-mono font-bold" style={{ color }}>{value}</p>
                </div>
              ))}
            </div>
          )}

          {/* Filters */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex gap-1">
              {(['all', 'done', 'pending'] as StatusFilter[]).map((s) => (
                <button
                  key={s}
                  onClick={() => setFilter(s)}
                  className="text-[0.6rem] font-mono px-2.5 py-1 rounded uppercase tracking-wider transition-colors"
                  style={{
                    border: `1px solid ${filter === s ? '#00F5FF60' : '#334155'}`,
                    color: filter === s ? '#00F5FF' : '#64748b',
                    background: filter === s ? 'rgba(0,245,255,0.08)' : 'transparent',
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search title or P-number…"
              className="flex-1 max-w-xs text-[0.65rem] font-mono px-3 py-1.5 rounded outline-none border transition-colors"
              style={{
                background: 'rgba(0,245,255,0.04)',
                border: '1px solid rgba(0,245,255,0.15)',
                color: '#94A3B8',
              }}
            />
          </div>

          {/* Table */}
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <div className="text-xs font-mono text-slate-600 animate-pulse">Loading traceability data…</div>
            </div>
          ) : proposals.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 gap-3 text-slate-600">
              <div className="text-4xl opacity-20">⑂</div>
              <span className="text-xs font-mono">No matching proposals</span>
            </div>
          ) : (
            <div className="rounded-lg border border-cyber-cyan/12 overflow-hidden">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-cyber-cyan/12" style={{ background: 'rgba(0,245,255,0.04)' }}>
                    <th className="px-4 py-2 text-[0.55rem] font-mono text-slate-500 uppercase tracking-wider w-16">ID</th>
                    <th className="px-4 py-2 text-[0.55rem] font-mono text-slate-500 uppercase tracking-wider">Title</th>
                    <th className="px-4 py-2 text-[0.55rem] font-mono text-slate-500 uppercase tracking-wider text-center w-20">Status</th>
                    <th className="px-4 py-2 text-[0.55rem] font-mono text-slate-500 uppercase tracking-wider text-right w-24">Commits</th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody>
                  {proposals.map((p) => (
                    <ProposalRow key={p.number} proposal={p} repoUrl={data?.repoUrl ?? null} />
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {data && (
            <p className="text-[0.5rem] font-mono text-slate-700">
              {proposals.length} of {data.proposals.length} proposals shown · Generated {new Date(data.generatedAt).toLocaleTimeString()}
            </p>
          )}
        </div>
      </main>
    </div>
  )
}
