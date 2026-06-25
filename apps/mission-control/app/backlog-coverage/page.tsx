'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import type { BacklogCoverageResponse, BacklogProposal, WeekBucket } from '../api/backlog-coverage/route'

const DONE_COLOR    = '#10B981'
const PROG_COLOR    = '#F59E0B'
const PENDING_COLOR = '#334155'
const EMPTY_COLOR   = '#0F172A'

const CELL_W = 20
const CELL_H = 72
const CELL_GAP = 3

function cellColor(bucket: WeekBucket): string {
  if (bucket.done > 0) return DONE_COLOR
  if (bucket.inProgress > 0) return PROG_COLOR
  if (bucket.pending > 0) return PENDING_COLOR
  return EMPTY_COLOR
}

function cellOpacity(bucket: WeekBucket): number {
  const total = bucket.done + bucket.inProgress + bucket.pending
  if (total === 0) return 0.15
  // Intensity driven by done count, base driven by any activity
  return Math.min(0.95, 0.25 + bucket.done * 0.18)
}

function fmtWeek(ws: string): string {
  const d = new Date(ws + 'T12:00:00Z')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

function velDelta(v4: number, vPrior: number): string {
  if (vPrior === 0 && v4 === 0) return '—'
  if (vPrior === 0) return `+${v4}`
  const pct = Math.round(((v4 - vPrior) / vPrior) * 100)
  return pct >= 0 ? `+${pct}%` : `${pct}%`
}

interface DrawerState {
  weekBucket: WeekBucket
  proposals: BacklogProposal[]
}

export default function BacklogCoveragePage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [data, setData] = useState<BacklogCoverageResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedSlug, setSelectedSlug] = useState<string>(() => searchParams.get('slug') ?? '')
  const [drawer, setDrawer] = useState<DrawerState | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const qs = selectedSlug ? `?slug=${encodeURIComponent(selectedSlug)}` : ''
        const r = await fetch(`/api/backlog-coverage${qs}`)
        if (r.ok && !cancelled) setData(await r.json() as BacklogCoverageResponse)
      } catch { /* ignore */ } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [selectedSlug])

  function handleSlugChange(slug: string) {
    setSelectedSlug(slug)
    const params = new URLSearchParams(searchParams.toString())
    if (slug) params.set('slug', slug)
    else params.delete('slug')
    router.replace(`?${params.toString()}`)
  }

  function handleCellClick(bucket: WeekBucket) {
    if (!data) return
    const weekStart = bucket.weekStart
    // Find proposals created in this week
    const inWeek = data.proposals.filter((p) => {
      if (!p.created) return false
      return p.created >= weekStart && p.created <= addDays(weekStart, 6)
    })
    if (inWeek.length > 0) setDrawer({ weekBucket: bucket, proposals: inWeek })
  }

  function addDays(dateStr: string, days: number): string {
    const d = new Date(dateStr + 'T12:00:00Z')
    d.setUTCDate(d.getUTCDate() + days)
    return d.toISOString().slice(0, 10)
  }

  const series = data?.weeklySeries ?? []
  const sc = data?.statusCounts
  const delta = data ? velDelta(data.velocity4w, data.velocityPrior4w) : '—'
  const deltaColor = data
    ? data.velocity4w >= data.velocityPrior4w
      ? DONE_COLOR
      : '#EF4444'
    : '#64748B'

  return (
    <div className="min-h-screen bg-[#030712] text-slate-300 font-mono p-4 flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 mb-5 flex-wrap">
        <Link href="/" className="text-slate-600 hover:text-cyan-400 text-sm">←</Link>
        <h1 className="text-lg font-bold tracking-widest text-cyan-400 uppercase">
          Proposal Coverage Heatmap
        </h1>
        {data && (
          <span className="text-slate-600 text-xs">
            {data.slug}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {data?.slugs && data.slugs.length > 1 && (
            <select
              value={selectedSlug || data.slug}
              onChange={(e) => handleSlugChange(e.target.value)}
              className="bg-[#0d1b2e] border border-slate-700 text-slate-300 text-xs rounded px-2 py-1 font-mono"
            >
              {data.slugs.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          )}
        </div>
      </div>

      {loading && <div className="text-slate-600 text-sm animate-pulse">Loading backlog coverage…</div>}

      {!loading && data && (
        <div className="flex gap-6 flex-col lg:flex-row">
          {/* Main: contribution calendar */}
          <div className="flex-1 min-w-0">
            {/* Legend */}
            <div className="flex gap-4 mb-4 text-[0.55rem] text-slate-600 flex-wrap">
              <span>
                <span className="inline-block w-3 h-3 rounded-sm mr-1 align-middle" style={{ background: DONE_COLOR }} />
                Done
              </span>
              <span>
                <span className="inline-block w-3 h-3 rounded-sm mr-1 align-middle" style={{ background: PROG_COLOR }} />
                In Progress
              </span>
              <span>
                <span className="inline-block w-3 h-3 rounded-sm mr-1 align-middle" style={{ background: PENDING_COLOR }} />
                Pending
              </span>
              <span className="text-slate-700">Click cell → proposals created that week</span>
            </div>

            {series.length === 0 ? (
              <div className="text-slate-700 text-sm">
                No proposals with dates found in BACKLOG.md.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <div style={{ display: 'flex', gap: CELL_GAP, alignItems: 'flex-end' }}>
                  {series.map((bucket) => {
                    const color = cellColor(bucket)
                    const opacity = cellOpacity(bucket)
                    const total = bucket.done + bucket.inProgress + bucket.pending
                    const barH = Math.max(8, Math.min(CELL_H, 8 + total * 4))
                    return (
                      <div
                        key={bucket.weekStart}
                        onClick={() => handleCellClick(bucket)}
                        title={`${fmtWeek(bucket.weekStart)} · done=${bucket.done} prog=${bucket.inProgress} pending=${bucket.pending}`}
                        style={{
                          width: CELL_W,
                          height: barH,
                          borderRadius: 3,
                          background: color,
                          opacity,
                          cursor: total > 0 ? 'pointer' : 'default',
                          flexShrink: 0,
                          transition: 'opacity 0.15s',
                          position: 'relative',
                        }}
                      />
                    )
                  })}
                </div>
                {/* X-axis labels — show every 4th week */}
                <div style={{ display: 'flex', gap: CELL_GAP, marginTop: 4 }}>
                  {series.map((bucket, i) => (
                    <div
                      key={bucket.weekStart}
                      style={{
                        width: CELL_W,
                        flexShrink: 0,
                        fontSize: '0.45rem',
                        color: '#475569',
                        overflow: 'hidden',
                        textAlign: 'center',
                        opacity: i % 4 === 0 ? 1 : 0,
                      }}
                    >
                      {fmtWeek(bucket.weekStart)}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Proposal list */}
            <div className="mt-8">
              <div className="text-[0.6rem] text-slate-600 uppercase tracking-widest mb-2">
                All Proposals ({data.proposals.length})
              </div>
              <div className="flex flex-col gap-1 max-h-96 overflow-y-auto pr-1">
                {data.proposals.map((p) => (
                  <div
                    key={p.number}
                    className="flex items-center gap-2 px-2 py-1 rounded text-[0.6rem]"
                    style={{ background: '#0d1b2e' }}
                  >
                    <span className="text-slate-600 font-bold w-10 shrink-0">P{p.number}</span>
                    <span
                      className="shrink-0 px-1.5 py-0.5 rounded text-[0.5rem] font-bold uppercase tracking-wider"
                      style={{
                        background:
                          p.status === 'done'
                            ? '#064E3B'
                            : p.status === 'in_progress'
                            ? '#451A03'
                            : '#1E293B',
                        color:
                          p.status === 'done'
                            ? DONE_COLOR
                            : p.status === 'in_progress'
                            ? PROG_COLOR
                            : '#64748B',
                      }}
                    >
                      {p.status === 'in_progress' ? 'WIP' : p.status}
                    </span>
                    <span className="text-slate-400 truncate flex-1">{p.title}</span>
                    {p.created && (
                      <span className="text-slate-700 shrink-0">{p.created}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Sidebar */}
          <div className="w-full lg:w-56 shrink-0 flex flex-col gap-4">
            {/* Status counts */}
            <div className="rounded-lg border border-white/5 p-3" style={{ background: '#080f1c' }}>
              <div className="text-[0.55rem] text-slate-600 uppercase tracking-widest mb-3">Status</div>
              <div className="flex flex-col gap-2">
                {[
                  { label: 'Done', val: sc?.done ?? 0, color: DONE_COLOR },
                  { label: 'Pending', val: sc?.pending ?? 0, color: '#64748B' },
                  { label: 'In Progress', val: sc?.inProgress ?? 0, color: PROG_COLOR },
                  { label: 'Total', val: sc?.total ?? 0, color: '#94A3B8' },
                ].map(({ label, val, color }) => (
                  <div key={label} className="flex items-center justify-between text-xs">
                    <span style={{ color: '#475569' }}>{label}</span>
                    <span className="font-bold" style={{ color }}>{val}</span>
                  </div>
                ))}
              </div>
              {sc && sc.total > 0 && (
                <div className="mt-3">
                  <div className="h-1.5 rounded-full overflow-hidden" style={{ background: '#1E293B' }}>
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.round((sc.done / sc.total) * 100)}%`,
                        background: DONE_COLOR,
                      }}
                    />
                  </div>
                  <div className="text-[0.5rem] text-slate-700 mt-1 text-right">
                    {Math.round((sc.done / sc.total) * 100)}% complete
                  </div>
                </div>
              )}
            </div>

            {/* Velocity */}
            <div className="rounded-lg border border-white/5 p-3" style={{ background: '#080f1c' }}>
              <div className="text-[0.55rem] text-slate-600 uppercase tracking-widest mb-3">Velocity</div>
              <div className="flex flex-col gap-2 text-xs">
                <div className="flex justify-between">
                  <span style={{ color: '#475569' }}>Last 4w</span>
                  <span className="font-bold" style={{ color: DONE_COLOR }}>{data.velocity4w}</span>
                </div>
                <div className="flex justify-between">
                  <span style={{ color: '#475569' }}>Prior 4w</span>
                  <span className="font-bold text-slate-500">{data.velocityPrior4w}</span>
                </div>
                <div className="flex justify-between">
                  <span style={{ color: '#475569' }}>Δ</span>
                  <span className="font-bold" style={{ color: deltaColor }}>{delta}</span>
                </div>
              </div>
            </div>

            {/* Next pending */}
            {data.nextPending.length > 0 && (
              <div className="rounded-lg border border-white/5 p-3" style={{ background: '#080f1c' }}>
                <div className="text-[0.55rem] text-slate-600 uppercase tracking-widest mb-3">Next Up</div>
                <div className="flex flex-col gap-2">
                  {data.nextPending.map((p) => (
                    <div key={p.number} className="text-[0.6rem]">
                      <span className="text-slate-600 mr-1">P{p.number}</span>
                      <span className="text-slate-400 leading-tight">{p.title}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Week drawer */}
      {drawer && (
        <>
          <div
            className="fixed inset-0 z-40"
            style={{ background: 'rgba(0,0,0,0.6)' }}
            onClick={() => setDrawer(null)}
          />
          <div
            className="fixed right-0 top-0 bottom-0 z-50 border-l border-white/10 overflow-y-auto p-4"
            style={{ background: '#080f1c', width: 'min(420px, 90vw)' }}
          >
            <div className="flex items-center gap-2 mb-4">
              <h2 className="text-sm font-bold text-slate-200">
                Week of {fmtWeek(drawer.weekBucket.weekStart)}
              </h2>
              <button
                onClick={() => setDrawer(null)}
                className="ml-auto text-slate-600 hover:text-slate-300 text-xs"
              >
                ✕
              </button>
            </div>
            <div className="flex gap-3 mb-4 text-xs">
              <span style={{ color: DONE_COLOR }}>{drawer.weekBucket.done} done</span>
              <span style={{ color: PROG_COLOR }}>{drawer.weekBucket.inProgress} wip</span>
              <span style={{ color: '#64748B' }}>{drawer.weekBucket.pending} pending</span>
            </div>
            <div className="flex flex-col gap-2">
              {drawer.proposals.map((p) => (
                <div
                  key={p.number}
                  className="flex items-start gap-2 p-2 rounded text-[0.65rem]"
                  style={{ background: '#0d1b2e' }}
                >
                  <span className="text-slate-600 font-bold shrink-0">P{p.number}</span>
                  <span
                    className="shrink-0 px-1 py-0.5 rounded text-[0.5rem] font-bold uppercase"
                    style={{
                      background: p.status === 'done' ? '#064E3B' : '#1E293B',
                      color: p.status === 'done' ? DONE_COLOR : '#64748B',
                    }}
                  >
                    {p.status}
                  </span>
                  <span className="text-slate-400">{p.title}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
