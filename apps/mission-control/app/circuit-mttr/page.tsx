'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import SubPageHeader from '../../components/SubPageHeader'
import type { CircuitMttrResponse, ProjectMttr, SparklineDay } from '../api/circuit-mttr/route'

function fmtDuration(ms: number | null): string {
  if (ms === null) return '—'
  const sec = Math.round(ms / 1000)
  if (sec < 60) return `${sec}s`
  const min = Math.floor(sec / 60)
  const rem = sec % 60
  if (min < 60) return rem > 0 ? `${min}m ${rem}s` : `${min}m`
  return `${Math.floor(min / 60)}h ${min % 60}m`
}

function mttrColor(ms: number | null): string {
  if (ms === null) return '#475569'
  const min = ms / 60000
  if (min < 2) return '#10B981'
  if (min < 10) return '#F59E0B'
  return '#EF4444'
}

function Sparkline({ data }: { data: SparklineDay[] }) {
  const max = Math.max(1, ...data.map((d) => d.opens))
  const W = 80, H = 20

  return (
    <svg width={W} height={H} className="inline-block">
      {data.map((d, i) => {
        const h = Math.max(1, (d.opens / max) * H)
        const x = (i / data.length) * W
        const barW = Math.max(1, W / data.length - 0.5)
        return (
          <rect
            key={d.date}
            x={x}
            y={H - h}
            width={barW}
            height={h}
            fill={d.opens > 0 ? '#EF4444' : '#1e293b'}
            opacity={0.8}
          />
        )
      })}
    </svg>
  )
}

type SortKey = 'slug' | 'totalOpens' | 'mttrMs' | 'longestOpenMs' | 'opensPerWeek'

export default function CircuitMttrPage() {
  const [data, setData] = useState<CircuitMttrResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [sortKey, setSortKey] = useState<SortKey>('totalOpens')
  const [sortDir, setSortDir] = useState<1 | -1>(-1)

  const load = useCallback(() => {
    fetch('/api/circuit-mttr')
      .then((r) => r.json())
      .then((d: CircuitMttrResponse) => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  function toggleSort(key: SortKey) {
    if (key === sortKey) setSortDir((d) => (d === -1 ? 1 : -1))
    else { setSortKey(key); setSortDir(-1) }
  }

  const sorted = data
    ? [...data.projects].sort((a, b) => {
        let va: number | string, vb: number | string
        if (sortKey === 'slug') { va = a.slug; vb = b.slug }
        else if (sortKey === 'mttrMs') { va = a.mttrMs ?? -1; vb = b.mttrMs ?? -1 }
        else if (sortKey === 'longestOpenMs') { va = a.longestOpenMs ?? -1; vb = b.longestOpenMs ?? -1 }
        else { va = a[sortKey] as number; vb = b[sortKey] as number }
        if (va < vb) return sortDir
        if (va > vb) return -sortDir
        return 0
      })
    : []

  function SortHdr({ k, label }: { k: SortKey; label: string }) {
    const active = sortKey === k
    return (
      <th
        className="text-left text-[0.55rem] font-mono text-slate-500 pb-2 pr-4 cursor-pointer select-none hover:text-slate-300 transition-colors"
        onClick={() => toggleSort(k)}
      >
        {label}{active ? (sortDir === -1 ? ' ↓' : ' ↑') : ''}
      </th>
    )
  }

  return (
    <div className="min-h-screen p-4 md:p-6" style={{ background: '#080f1c', color: '#E2E8F0' }}>
      <SubPageHeader title="Circuit Breaker MTTR">
        <span className="text-[0.6rem] font-mono text-slate-500">
          Mean time to recovery · opens per week · drill into timeline
        </span>
      </SubPageHeader>

      {loading && (
        <div className="text-center py-20 text-slate-600 font-mono text-sm">Loading…</div>
      )}

      {!loading && data && (
        <div className="max-w-5xl mx-auto">
          {sorted.length === 0 ? (
            <div className="text-center py-20 text-slate-600 font-mono text-sm">
              No circuit-events.jsonl files found — circuits have not tripped yet
            </div>
          ) : (
            <div
              className="rounded-lg border border-white/5 overflow-hidden"
              style={{ background: 'rgba(255,255,255,0.02)' }}
            >
              <table className="w-full">
                <thead>
                  <tr className="border-b border-white/5 px-4">
                    <th className="pl-4 text-left"><SortHdr k="slug" label="Project" /></th>
                    <th className="text-left"><SortHdr k="totalOpens" label="Opens" /></th>
                    <th className="text-left"><SortHdr k="mttrMs" label="MTTR" /></th>
                    <th className="text-left"><SortHdr k="longestOpenMs" label="Longest" /></th>
                    <th className="text-left"><SortHdr k="opensPerWeek" label="Opens/wk" /></th>
                    <th className="text-left text-[0.55rem] font-mono text-slate-500 pb-2">
                      Last 30d
                    </th>
                    <th className="text-left text-[0.55rem] font-mono text-slate-500 pb-2 pr-4">
                      Last event
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((proj: ProjectMttr) => {
                    const mttrHex = mttrColor(proj.mttrMs)
                    return (
                      <tr
                        key={proj.slug}
                        className="border-b border-white/5 hover:bg-white/[0.02] transition-colors"
                      >
                        <td className="pl-4 py-3">
                          <Link
                            href={`/circuit-timeline?slug=${proj.slug}`}
                            className="text-[0.65rem] font-mono hover:underline"
                            style={{ color: '#22D3EE' }}
                          >
                            {proj.slug}
                          </Link>
                        </td>
                        <td className="py-3 pr-4">
                          <span className="text-[0.65rem] font-mono text-slate-200">
                            {proj.totalOpens}
                          </span>
                          {proj.totalCloses < proj.totalOpens && (
                            <span className="text-[0.5rem] font-mono text-red-400 ml-1">
                              ({proj.totalOpens - proj.totalCloses} unclosed)
                            </span>
                          )}
                        </td>
                        <td className="py-3 pr-4">
                          <span
                            className="text-[0.65rem] font-mono px-1.5 py-0.5 rounded"
                            style={{ color: mttrHex, background: `${mttrHex}15` }}
                          >
                            {fmtDuration(proj.mttrMs)}
                          </span>
                        </td>
                        <td className="py-3 pr-4">
                          <span className="text-[0.65rem] font-mono text-slate-400">
                            {fmtDuration(proj.longestOpenMs)}
                          </span>
                        </td>
                        <td className="py-3 pr-4">
                          <span className="text-[0.65rem] font-mono text-slate-400">
                            {proj.opensPerWeek}/wk
                          </span>
                        </td>
                        <td className="py-3 pr-4">
                          <Sparkline data={proj.sparkline} />
                        </td>
                        <td className="py-3 pr-4">
                          {proj.lastEventTs ? (
                            <div>
                              <span
                                className="text-[0.55rem] font-mono px-1 py-0.5 rounded mr-1"
                                style={{
                                  color: proj.lastEventType === 'open' ? '#EF4444' : '#10B981',
                                  background: proj.lastEventType === 'open' ? '#EF444415' : '#10B98115',
                                }}
                              >
                                {proj.lastEventType?.toUpperCase()}
                              </span>
                              <span className="text-[0.5rem] font-mono text-slate-600">
                                {proj.lastEventTs.slice(0, 16).replace('T', ' ')}
                              </span>
                            </div>
                          ) : (
                            <span className="text-[0.55rem] font-mono text-slate-700">—</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Legend */}
          <div className="flex items-center gap-4 mt-4 text-[0.55rem] font-mono">
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-green-500" />
              <span className="text-slate-500">MTTR &lt;2min</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-amber-500" />
              <span className="text-slate-500">MTTR &lt;10min</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-red-500" />
              <span className="text-slate-500">MTTR ≥10min</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-4 h-2 rounded-sm bg-red-500 opacity-80" />
              <span className="text-slate-500">sparkline = opens/day last 30d</span>
            </div>
          </div>

          <div className="text-[0.55rem] font-mono text-slate-700 text-right mt-4">
            Generated {new Date(data.generatedAt).toLocaleString()}
          </div>
        </div>
      )}
    </div>
  )
}
