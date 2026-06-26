'use client'

import { useEffect, useState, useCallback } from 'react'
import SubPageHeader from '../../components/SubPageHeader'
import type {
  MemoryRecoveryResponse,
  OpenOrphan,
  WeekBucket,
  ProjectSparkline,
} from '../api/memory-recovery/route'

const BAR_COLORS = {
  relinked: '#22d3ee',
  deleted: '#f43f5e',
  ignored: '#64748b',
  stillOpen: '#f59e0b',
}

function ageColor(days: number): string {
  if (days >= 7) return '#f43f5e'
  if (days >= 3) return '#f59e0b'
  return '#94a3b8'
}

function relAge(days: number): string {
  if (days === 0) return 'today'
  if (days === 1) return '1d'
  if (days < 30) return `${days}d`
  return `${Math.floor(days / 30)}mo`
}

function Sparkline({ counts }: { counts: number[] }) {
  const max = Math.max(...counts, 1)
  const w = 80
  const h = 20
  const pts = counts.map((v, i) => {
    const x = (i / (counts.length - 1)) * w
    const y = h - (v / max) * h
    return `${x},${y}`
  })
  return (
    <svg width={w} height={h} className="overflow-visible">
      <polyline
        points={pts.join(' ')}
        fill="none"
        stroke="#f59e0b"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={0.7}
      />
      {counts.map((v, i) => {
        const x = (i / (counts.length - 1)) * w
        const y = h - (v / max) * h
        return (
          <circle key={i} cx={x} cy={y} r={2} fill="#f59e0b" opacity={0.8}>
            <title>{v} open</title>
          </circle>
        )
      })}
    </svg>
  )
}

function StackedBarChart({ history }: { history: WeekBucket[] }) {
  const maxTotal = Math.max(
    ...history.map((b) => b.relinked + b.deleted + b.ignored + b.stillOpen),
    1,
  )
  const barW = 48
  const gap = 8
  const chartH = 100

  return (
    <div className="overflow-x-auto">
      <svg
        width={history.length * (barW + gap)}
        height={chartH + 32}
        className="font-mono"
      >
        {history.map((b, i) => {
          const x = i * (barW + gap)
          const total = b.relinked + b.deleted + b.ignored + b.stillOpen
          const totalH = (total / maxTotal) * chartH

          let y = chartH
          const segments = [
            { key: 'relinked', val: b.relinked, color: BAR_COLORS.relinked },
            { key: 'deleted', val: b.deleted, color: BAR_COLORS.deleted },
            { key: 'ignored', val: b.ignored, color: BAR_COLORS.ignored },
            { key: 'stillOpen', val: b.stillOpen, color: BAR_COLORS.stillOpen },
          ]

          const rects = segments
            .filter((s) => s.val > 0)
            .map((s) => {
              const h = (s.val / maxTotal) * chartH
              y -= h
              return (
                <rect key={s.key} x={x} y={y} width={barW} height={h} fill={s.color} opacity={0.85} rx={1}>
                  <title>{s.key}: {s.val}</title>
                </rect>
              )
            })

          return (
            <g key={b.weekLabel}>
              {rects}
              <text
                x={x + barW / 2}
                y={chartH + 14}
                textAnchor="middle"
                fontSize={8}
                fill="#475569"
              >
                {b.weekLabel.slice(5)}
              </text>
              {total > 0 && (
                <text
                  x={x + barW / 2}
                  y={chartH - totalH - 3}
                  textAnchor="middle"
                  fontSize={8}
                  fill="#94a3b8"
                >
                  {total}
                </text>
              )}
            </g>
          )
        })}
      </svg>

      <div className="flex gap-4 mt-2 flex-wrap">
        {Object.entries(BAR_COLORS).map(([k, c]) => (
          <div key={k} className="flex items-center gap-1">
            <span className="inline-block w-3 h-3 rounded-sm" style={{ background: c }} />
            <span className="font-mono text-[0.55rem] text-slate-400">{k}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function OrphanRow({
  orphan,
  sparkline,
  onIgnore,
  ignoring,
}: {
  orphan: OpenOrphan
  sparkline?: ProjectSparkline
  onIgnore: (id: string) => void
  ignoring: boolean
}) {
  return (
    <tr className="border-b border-white/5 hover:bg-white/2">
      <td className="px-3 py-2">
        <span className="font-mono text-[0.6rem] text-cyan-400">{orphan.project}</span>
      </td>
      <td className="px-3 py-2 max-w-[160px]">
        <span className="font-mono text-xs text-white truncate block" title={orphan.file}>
          {orphan.file.replace(/\.md$/, '')}
        </span>
        {orphan.snippet && (
          <span
            className="font-mono text-[0.5rem] text-slate-500 truncate block"
            title={orphan.snippet}
          >
            {orphan.snippet}
          </span>
        )}
      </td>
      <td className="px-3 py-2 text-center">
        <span
          className="font-mono text-[0.65rem] px-2 py-0.5 rounded"
          style={{
            color: ageColor(orphan.daysOrphaned),
            background: `${ageColor(orphan.daysOrphaned)}18`,
          }}
        >
          {relAge(orphan.daysOrphaned)}
        </span>
      </td>
      <td className="px-3 py-2">
        {sparkline ? (
          <Sparkline counts={sparkline.weeklyOpenCounts} />
        ) : (
          <span className="font-mono text-[0.55rem] text-slate-600">—</span>
        )}
      </td>
      <td className="px-3 py-2">
        <button
          disabled={ignoring}
          onClick={() => onIgnore(orphan.id)}
          className="font-mono text-[0.55rem] px-2 py-0.5 rounded border border-slate-600/40 text-slate-400 hover:text-white hover:border-slate-400/50 disabled:opacity-40 transition-colors"
        >
          {ignoring ? '…' : 'ignore'}
        </button>
      </td>
    </tr>
  )
}

export default function MemoryRecoveryPage() {
  const [data, setData] = useState<MemoryRecoveryResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ignoringIds, setIgnoringIds] = useState<Set<string>>(new Set())

  const load = useCallback(() => {
    fetch('/api/memory-recovery')
      .then((r) => r.json())
      .then((d) => setData(d as MemoryRecoveryResponse))
      .catch((e) => setError(String(e)))
  }, [])

  useEffect(() => {
    load()
    const t = setInterval(load, 60_000)
    return () => clearInterval(t)
  }, [load])

  async function handleIgnore(id: string) {
    setIgnoringIds((prev) => new Set([...prev, id]))
    try {
      await fetch('/api/memory-recovery', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      load()
    } finally {
      setIgnoringIds((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    }
  }

  const sparklineByProject = data
    ? new Map(data.projectSparklines.map((s) => [s.project, s]))
    : new Map<string, ProjectSparkline>()

  const staleCount = data?.openOrphans.filter((o) => o.daysOrphaned >= 7).length ?? 0
  const oldest = data?.openOrphans[0]

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <div className="sticky top-0 z-40 bg-slate-950/90 backdrop-blur border-b border-white/5">
        <SubPageHeader title="Memory Recovery">
          {data && (
            <div className="flex gap-4 font-mono text-[0.6rem] text-slate-400">
              <span>
                Open: <span className="text-amber-400">{data.totalOpen}</span>
              </span>
              <span>
                Resolved: <span className="text-cyan-400">{data.totalResolved}</span>
              </span>
              {staleCount > 0 && (
                <span>
                  Stale ≥7d: <span className="text-red-400">{staleCount}</span>
                </span>
              )}
              <span className="text-slate-600">{data.generatedAt.slice(0, 19).replace('T', ' ')}</span>
            </div>
          )}
        </SubPageHeader>
      </div>

      <div className="p-6 space-y-8">
        {error && <p className="font-mono text-red-400 text-xs">{error}</p>}
        {!data && !error && <p className="font-mono text-slate-500 text-xs">Loading…</p>}

        {data && (
          <>
            {/* Summary header */}
            {oldest && (
              <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 flex gap-6 flex-wrap">
                <div>
                  <div className="font-mono text-[0.55rem] text-slate-500 uppercase tracking-wider mb-1">
                    Stale (≥7d)
                  </div>
                  <div className="font-mono text-xl font-bold text-red-400">{staleCount}</div>
                </div>
                <div>
                  <div className="font-mono text-[0.55rem] text-slate-500 uppercase tracking-wider mb-1">
                    Oldest pending
                  </div>
                  <div className="font-mono text-xs text-amber-300">
                    {oldest.file.replace(/\.md$/, '')}
                    <span className="text-slate-500 ml-2">({relAge(oldest.daysOrphaned)})</span>
                  </div>
                </div>
              </div>
            )}

            {/* Orphan table */}
            <div>
              <h2 className="font-mono text-[0.6rem] text-slate-500 uppercase tracking-wider mb-3">
                Open Orphans ({data.totalOpen})
              </h2>
              {data.openOrphans.length === 0 ? (
                <div className="text-center py-12 rounded-xl border border-white/5">
                  <div className="font-mono text-2xl mb-2 text-green-400">✓</div>
                  <p className="font-mono text-slate-400 text-sm">No open orphans.</p>
                  <p className="font-mono text-slate-600 text-xs mt-1">
                    All flagged memories have been resolved.
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-white/8">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-white/10 text-left">
                        <th className="px-3 py-2 font-mono text-[0.55rem] text-slate-500 uppercase tracking-wider">
                          Project
                        </th>
                        <th className="px-3 py-2 font-mono text-[0.55rem] text-slate-500 uppercase tracking-wider">
                          File
                        </th>
                        <th className="px-3 py-2 font-mono text-[0.55rem] text-slate-500 uppercase tracking-wider text-center">
                          Age
                        </th>
                        <th className="px-3 py-2 font-mono text-[0.55rem] text-slate-500 uppercase tracking-wider">
                          Trend (8w)
                        </th>
                        <th className="px-3 py-2 font-mono text-[0.55rem] text-slate-500 uppercase tracking-wider">
                          Action
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.openOrphans.map((o) => (
                        <OrphanRow
                          key={o.id}
                          orphan={o}
                          sparkline={sparklineByProject.get(o.project)}
                          onIgnore={handleIgnore}
                          ignoring={ignoringIds.has(o.id)}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Resolution history chart */}
            <div>
              <h2 className="font-mono text-[0.6rem] text-slate-500 uppercase tracking-wider mb-3">
                Resolution History (8 weeks)
              </h2>
              <div className="rounded-xl border border-white/8 bg-white/2 p-4">
                {data.weeklyHistory.every(
                  (b) => b.relinked + b.deleted + b.ignored + b.stillOpen === 0,
                ) ? (
                  <p className="font-mono text-slate-600 text-xs text-center py-4">
                    No data yet — history builds as orphans are flagged and resolved.
                  </p>
                ) : (
                  <StackedBarChart history={data.weeklyHistory} />
                )}
              </div>
            </div>

            {/* Project sparklines summary */}
            {data.projectSparklines.length > 0 && (
              <div>
                <h2 className="font-mono text-[0.6rem] text-slate-500 uppercase tracking-wider mb-3">
                  Per-Project Open Trend
                </h2>
                <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}>
                  {data.projectSparklines.map((s) => {
                    const currentOpen = s.weeklyOpenCounts[s.weeklyOpenCounts.length - 1] ?? 0
                    return (
                      <div
                        key={s.project}
                        className="rounded-lg border border-white/8 bg-white/2 px-3 py-2"
                      >
                        <div className="flex justify-between items-center mb-2">
                          <span className="font-mono text-[0.6rem] text-cyan-400">{s.project}</span>
                          <span
                            className="font-mono text-[0.65rem]"
                            style={{ color: currentOpen > 0 ? '#f59e0b' : '#22d3ee' }}
                          >
                            {currentOpen} open
                          </span>
                        </div>
                        <Sparkline counts={s.weeklyOpenCounts} />
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
