'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import SubPageHeader from '../../components/SubPageHeader'
import type { ProposalImplLagResponse, ProposalLag, LagStatus } from '../api/proposal-impl-lag/route'

// ─── Helpers ─────────────────────────────────────────────────────────────────

const STATUS_COLOR: Record<LagStatus, string> = {
  done:          '#10B981',
  implementing:  '#22D3EE',
  'not-started': '#F59E0B',
}

const STATUS_LABEL: Record<LagStatus, string> = {
  done:          'done',
  implementing:  'building',
  'not-started': 'not started',
}

function lagColor(days: number | null): string {
  if (days === null) return '#475569'
  if (days <= 3) return '#10B981'
  if (days <= 14) return '#F59E0B'
  return '#EF4444'
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  return iso.slice(0, 10)
}

function fmtLag(days: number | null): string {
  if (days === null) return '—'
  if (days === 0) return '<1d'
  return `${days}d`
}

// ─── Scatter chart ────────────────────────────────────────────────────────────

function ScatterChart({ proposals }: { proposals: ProposalLag[] }) {
  const visible = proposals.filter((p) => p.approvedAt && p.lagDays !== null)
  if (visible.length === 0) return <div className="text-slate-600 text-xs font-mono py-4">Not enough data for scatter plot.</div>

  const W = 500, H = 200
  const PAD = { l: 36, r: 12, t: 12, b: 32 }
  const maxLag = Math.max(...visible.map((p) => p.lagDays!), 1)
  const maxTasks = Math.max(...visible.map((p) => p.taskCount), 1)

  // Sort by approvedAt for x axis
  const sorted = [...visible].sort((a, b) => (a.approvedAt ?? '').localeCompare(b.approvedAt ?? ''))
  const innerW = W - PAD.l - PAD.r
  const innerH = H - PAD.t - PAD.b

  return (
    <svg width={W} height={H}>
      {/* Axes */}
      <line x1={PAD.l} y1={PAD.t} x2={PAD.l} y2={H - PAD.b} stroke="#1e3a5f" strokeWidth={1} />
      <line x1={PAD.l} y1={H - PAD.b} x2={W - PAD.r} y2={H - PAD.b} stroke="#1e3a5f" strokeWidth={1} />

      {/* Y ticks */}
      {[0, Math.round(maxLag * 0.25), Math.round(maxLag * 0.5), Math.round(maxLag * 0.75), maxLag].map((v) => {
        const y = PAD.t + innerH * (1 - v / maxLag)
        return (
          <g key={v}>
            <line x1={PAD.l - 3} y1={y} x2={PAD.l} y2={y} stroke="#1e3a5f" strokeWidth={1} />
            <text x={PAD.l - 5} y={y + 3} textAnchor="end" fill="#334155" fontSize={7} fontFamily="monospace">{v}d</text>
          </g>
        )
      })}

      {/* 14d stall line */}
      {maxLag > 14 && (
        <line
          x1={PAD.l}
          y1={PAD.t + innerH * (1 - 14 / maxLag)}
          x2={W - PAD.r}
          y2={PAD.t + innerH * (1 - 14 / maxLag)}
          stroke="#EF444440"
          strokeDasharray="4 2"
          strokeWidth={1}
        />
      )}

      {/* Points */}
      {sorted.map((p, i) => {
        const x = PAD.l + (innerW / Math.max(sorted.length - 1, 1)) * i
        const y = PAD.t + innerH * (1 - (p.lagDays! / maxLag))
        const r = 3 + (p.taskCount / maxTasks) * 8
        const color = STATUS_COLOR[p.status]
        return (
          <g key={p.changeSlug}>
            <circle cx={x} cy={y} r={r} fill={`${color}50`} stroke={color} strokeWidth={1.5} />
            <title>{p.changeSlug} · {fmtLag(p.lagDays)} · {p.status}</title>
          </g>
        )
      })}

      {/* X label */}
      <text x={PAD.l + innerW / 2} y={H - 2} textAnchor="middle" fill="#334155" fontSize={7} fontFamily="monospace">
        proposals (chronological) — size = task count
      </text>
      <text x={8} y={PAD.t + innerH / 2} textAnchor="middle" fill="#334155" fontSize={7} fontFamily="monospace" transform={`rotate(-90,8,${PAD.t + innerH / 2})`}>
        lag (days)
      </text>

      {/* Legend */}
      {(['done', 'implementing', 'not-started'] as LagStatus[]).map((s, i) => (
        <g key={s}>
          <circle cx={PAD.l + 16 + i * 72} cy={PAD.t + 4} r={4} fill={`${STATUS_COLOR[s]}50`} stroke={STATUS_COLOR[s]} strokeWidth={1.5} />
          <text x={PAD.l + 22 + i * 72} y={PAD.t + 8} fill={STATUS_COLOR[s]} fontSize={6.5} fontFamily="monospace">{STATUS_LABEL[s]}</text>
        </g>
      ))}
    </svg>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function ProposalImplLagPage() {
  const [data, setData] = useState<ProposalImplLagResponse | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/proposal-impl-lag')
      .then((r) => r.json())
      .then((d) => setData(d as ProposalImplLagResponse))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const stalled = data?.proposals.filter((p) => p.status === 'not-started' && (p.lagDays ?? 0) > 14) ?? []

  return (
    <div className="min-h-dvh flex flex-col" style={{ background: '#020811', fontFamily: 'JetBrains Mono, monospace' }}>
      <SubPageHeader title="PROPOSAL IMPLEMENTATION LAG" />

      {/* Stats bar */}
      {data && (
        <div className="flex flex-wrap gap-4 px-4 py-2 border-b border-white/5 text-[0.6rem] font-mono" style={{ background: '#060d1a' }}>
          <span className="text-slate-500">Total: <span className="text-slate-300">{data.proposals.length}</span></span>
          <span style={{ color: '#10B981' }}>Done: {data.proposals.filter(p => p.status === 'done').length}</span>
          <span style={{ color: '#22D3EE' }}>Building: {data.proposals.filter(p => p.status === 'implementing').length}</span>
          <span style={{ color: '#F59E0B' }}>Not started: {data.proposals.filter(p => p.status === 'not-started').length}</span>
          {data.p50 !== null && (
            <span className="text-slate-400">P50 lag: <span className="text-slate-200">{fmtLag(data.p50)}</span></span>
          )}
          {data.p90 !== null && (
            <span className="text-slate-400">P90 lag: <span className="text-slate-200">{fmtLag(data.p90)}</span></span>
          )}
          {data.stallCount > 0 && (
            <span
              className="px-2 py-0.5 rounded"
              style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#EF4444' }}
            >
              {data.stallCount} stalled &gt;14d
            </span>
          )}
        </div>
      )}

      {loading && <div className="p-8 text-slate-500 text-xs font-mono">Loading…</div>}

      {data && (
        <div className="p-4 flex flex-col gap-6" style={{ maxWidth: 960 }}>
          {/* Scatter plot */}
          <div className="rounded border p-4" style={{ background: '#060d1a', borderColor: '#1e3a5f' }}>
            <div className="text-[0.6rem] font-mono text-slate-400 uppercase tracking-widest mb-3">Approval-to-First-Commit Lag</div>
            <ScatterChart proposals={data.proposals} />
          </div>

          {/* Stalled proposals table */}
          {stalled.length > 0 && (
            <div className="rounded border p-4" style={{ background: '#060d1a', borderColor: '#EF444430' }}>
              <div className="text-[0.6rem] font-mono uppercase tracking-widest mb-3" style={{ color: '#EF4444' }}>
                Stalled Proposals (&gt;14 days without first commit)
              </div>
              <table className="w-full text-[0.6rem] font-mono">
                <thead>
                  <tr className="text-slate-500 text-left border-b border-white/5">
                    <th className="pb-1 pr-4">Proposal</th>
                    <th className="pb-1 pr-4">Created</th>
                    <th className="pb-1 pr-4">Lag</th>
                    <th className="pb-1 pr-4">Tasks</th>
                    <th className="pb-1">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {stalled.map((p) => (
                    <tr key={p.changeSlug} className="border-b border-white/3 hover:bg-white/2 transition-colors">
                      <td className="py-1.5 pr-4">
                        <span className="text-slate-300" title={p.title}>{p.changeSlug}</span>
                        {p.title && <div className="text-slate-600 text-[0.5rem] truncate max-w-xs">{p.title}</div>}
                      </td>
                      <td className="py-1.5 pr-4 text-slate-500">{fmtDate(p.approvedAt)}</td>
                      <td className="py-1.5 pr-4" style={{ color: lagColor(p.lagDays) }}>
                        {fmtLag(p.lagDays)}
                      </td>
                      <td className="py-1.5 pr-4 text-slate-500">{p.taskCount || '—'}</td>
                      <td className="py-1.5">
                        <span
                          className="px-1.5 py-0.5 rounded text-[0.5rem]"
                          style={{ color: STATUS_COLOR[p.status], background: `${STATUS_COLOR[p.status]}15` }}
                        >
                          {STATUS_LABEL[p.status]}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Full proposals table */}
          <div className="rounded border p-4" style={{ background: '#060d1a', borderColor: '#1e3a5f' }}>
            <div className="text-[0.6rem] font-mono text-slate-400 uppercase tracking-widest mb-3">All Proposals</div>
            {data.proposals.length === 0 ? (
              <div className="text-slate-600 text-xs">No specclaw proposals found.</div>
            ) : (
              <table className="w-full text-[0.6rem] font-mono">
                <thead>
                  <tr className="text-slate-500 text-left border-b border-white/5">
                    <th className="pb-1 pr-4">Proposal</th>
                    <th className="pb-1 pr-4">Created</th>
                    <th className="pb-1 pr-4">First commit</th>
                    <th className="pb-1 pr-4">Lag</th>
                    <th className="pb-1 pr-4">Tasks</th>
                    <th className="pb-1">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.proposals.map((p) => (
                    <tr key={p.changeSlug} className="border-b border-white/3 hover:bg-white/2 transition-colors">
                      <td className="py-1 pr-4">
                        <Link href={`/proposal-lifecycle?change=${encodeURIComponent(p.changeSlug)}`} className="text-slate-300 hover:text-cyber-cyan transition-colors">
                          {p.changeSlug}
                        </Link>
                        {p.title && <div className="text-slate-600 text-[0.5rem] truncate max-w-xs">{p.title}</div>}
                      </td>
                      <td className="py-1 pr-4 text-slate-500">{fmtDate(p.approvedAt)}</td>
                      <td className="py-1 pr-4 text-slate-500">{fmtDate(p.firstCommitAt)}</td>
                      <td className="py-1 pr-4" style={{ color: lagColor(p.lagDays) }}>{fmtLag(p.lagDays)}</td>
                      <td className="py-1 pr-4 text-slate-500">{p.taskCount || '—'}</td>
                      <td className="py-1">
                        <span
                          className="px-1.5 py-0.5 rounded text-[0.5rem]"
                          style={{ color: STATUS_COLOR[p.status], background: `${STATUS_COLOR[p.status]}15` }}
                        >
                          {STATUS_LABEL[p.status]}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
