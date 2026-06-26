'use client'

import { Suspense, useCallback, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import SubPageHeader from '../../components/SubPageHeader'
import { useFreshness } from '../../lib/useFreshness'
import type { TopologyDiffResponse, SnapProject, ChangedField } from '../api/topology-diff/route'

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function platformIcon(platform: string): string {
  switch (platform) {
    case 'discord':
      return '💬'
    case 'whatsapp':
      return '📱'
    case 'teams':
      return '👥'
    default:
      return '🖥'
  }
}

function SlugBadge({ slug, platform, color }: { slug: string; platform: string; color: string }) {
  return (
    <div
      className="flex items-center gap-2 px-3 py-1.5 rounded-md"
      style={{
        background: `${color}18`,
        border: `1px solid ${color}40`,
      }}
    >
      <span className="text-base leading-none">{platformIcon(platform)}</span>
      <span
        className="font-mono text-xs font-semibold tracking-wide"
        style={{ color }}
      >
        {slug}
      </span>
      <span className="text-xs text-slate-500 font-mono">{platform}</span>
    </div>
  )
}

function ChangedRow({ item }: { item: ChangedField }) {
  return (
    <div
      className="flex flex-col gap-1 px-3 py-2 rounded-md"
      style={{
        background: 'rgba(245,158,11,0.08)',
        border: '1px solid rgba(245,158,11,0.25)',
      }}
    >
      <span className="font-mono text-xs font-semibold text-amber-400 tracking-wide">
        {item.slug}
      </span>
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-xs text-slate-500 font-mono">{item.field}:</span>
        <span className="font-mono text-xs text-slate-400 line-through">{item.from}</span>
        <span className="text-slate-600 text-xs">→</span>
        <span className="font-mono text-xs text-amber-300">{item.to}</span>
      </div>
    </div>
  )
}

function DiffColumn({
  title,
  color,
  count,
  children,
}: {
  title: string
  color: string
  count: number
  children: React.ReactNode
}) {
  return (
    <div className="flex-1 min-w-0 flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <span className="font-mono text-sm font-bold tracking-wider" style={{ color }}>
          {title}
        </span>
        <span
          className="font-mono text-xs px-1.5 py-0.5 rounded"
          style={{
            background: `${color}22`,
            border: `1px solid ${color}44`,
            color,
          }}
        >
          {count}
        </span>
      </div>
      <div className="flex flex-col gap-2">{children}</div>
    </div>
  )
}

function TopologyDiffInner() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const defaultFrom = toDateStr(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000))
  const defaultTo = toDateStr(new Date())

  const fromDate = searchParams.get('from') ?? defaultFrom
  const toDate = searchParams.get('to') ?? defaultTo

  const [localFrom, setLocalFrom] = useState(fromDate)
  const [localTo, setLocalTo] = useState(toDate)

  const apiUrl = `/api/topology-diff?from=${fromDate}&to=${toDate}`
  const { data, isStale, lastError } = useFreshness<TopologyDiffResponse>(apiUrl, 60_000)

  const applyDates = useCallback(
    (from: string, to: string) => {
      const params = new URLSearchParams(searchParams.toString())
      params.set('from', from)
      params.set('to', to)
      router.replace(`?${params.toString()}`)
    },
    [router, searchParams],
  )

  const handleFromChange = (v: string) => {
    setLocalFrom(v)
    if (v && localTo) applyDates(v, localTo)
  }

  const handleToChange = (v: string) => {
    setLocalTo(v)
    if (localFrom && v) applyDates(localFrom, v)
  }

  const notEnoughSnapshots = data && data.snapshots.length < 2

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <SubPageHeader title="Fleet Topology Diff">
        <div className="flex items-center gap-2">
          {isStale && (
            <span className="text-xs font-mono text-amber-400 px-2 py-0.5 rounded border border-amber-400/30 bg-amber-400/10">
              STALE
            </span>
          )}
          {lastError && (
            <span className="text-xs font-mono text-red-400 px-2 py-0.5 rounded border border-red-400/30 bg-red-400/10">
              {lastError}
            </span>
          )}
        </div>
      </SubPageHeader>

      <div className="max-w-6xl mx-auto px-4 py-8 space-y-8">
        {/* Date range picker */}
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <label className="text-xs font-mono text-slate-400 uppercase tracking-widest">
              From
            </label>
            <input
              type="date"
              value={localFrom}
              onChange={(e) => handleFromChange(e.target.value)}
              className="bg-slate-900 border border-slate-700 rounded px-3 py-1.5 text-sm font-mono text-slate-200 focus:outline-none focus:border-cyan-500/60"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs font-mono text-slate-400 uppercase tracking-widest">
              To
            </label>
            <input
              type="date"
              value={localTo}
              onChange={(e) => handleToChange(e.target.value)}
              className="bg-slate-900 border border-slate-700 rounded px-3 py-1.5 text-sm font-mono text-slate-200 focus:outline-none focus:border-cyan-500/60"
            />
          </div>

          {data && (
            <span className="text-xs font-mono text-slate-500">
              {data.snapshots.length} snapshot{data.snapshots.length !== 1 ? 's' : ''} available
            </span>
          )}

          <div className="ml-auto">
            <Link
              href="/graph3d"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-mono font-semibold text-cyan-400 border border-cyan-500/30 bg-cyan-500/10 hover:bg-cyan-500/20 transition-colors"
            >
              <span>✦</span>
              <span>View in Constellation</span>
            </Link>
          </div>
        </div>

        {/* Loading state */}
        {!data && !lastError && (
          <div className="flex items-center justify-center py-24">
            <span className="text-slate-500 font-mono text-sm animate-pulse">
              Loading snapshots…
            </span>
          </div>
        )}

        {/* Not enough snapshots */}
        {notEnoughSnapshots && (
          <div
            className="rounded-lg px-6 py-10 text-center"
            style={{
              background: 'rgba(14,165,233,0.06)',
              border: '1px solid rgba(14,165,233,0.2)',
            }}
          >
            <p className="text-slate-400 font-mono text-sm">
              Not enough snapshots yet. Check back tomorrow.
            </p>
            <p className="text-slate-600 font-mono text-xs mt-2">
              A new snapshot is captured automatically each day.
            </p>
          </div>
        )}

        {/* Diff columns */}
        {data && !notEnoughSnapshots && (
          <>
            {/* Date span label */}
            <div className="text-xs font-mono text-slate-500">
              Comparing{' '}
              <span className="text-slate-300">{data.fromDate}</span>
              {' → '}
              <span className="text-slate-300">{data.toDate}</span>
            </div>

            <div
              className="rounded-xl p-6"
              style={{
                background: 'rgba(15,23,42,0.8)',
                border: '1px solid rgba(148,163,184,0.1)',
              }}
            >
              <div className="flex gap-6 flex-wrap md:flex-nowrap">
                {/* Added */}
                <DiffColumn
                  title="ADDED"
                  color="#22c55e"
                  count={data.diff.added.length}
                >
                  {data.diff.added.length === 0 ? (
                    <span className="text-xs font-mono text-slate-600 italic">None</span>
                  ) : (
                    data.diff.added.map((p: SnapProject) => (
                      <SlugBadge key={p.slug} slug={p.slug} platform={p.platform} color="#22c55e" />
                    ))
                  )}
                </DiffColumn>

                {/* Divider */}
                <div className="hidden md:block w-px bg-slate-800 self-stretch" />

                {/* Removed */}
                <DiffColumn
                  title="REMOVED"
                  color="#ef4444"
                  count={data.diff.removed.length}
                >
                  {data.diff.removed.length === 0 ? (
                    <span className="text-xs font-mono text-slate-600 italic">None</span>
                  ) : (
                    data.diff.removed.map((p: SnapProject) => (
                      <SlugBadge key={p.slug} slug={p.slug} platform={p.platform} color="#ef4444" />
                    ))
                  )}
                </DiffColumn>

                {/* Divider */}
                <div className="hidden md:block w-px bg-slate-800 self-stretch" />

                {/* Changed */}
                <DiffColumn
                  title="CHANGED"
                  color="#f59e0b"
                  count={data.diff.changed.length}
                >
                  {data.diff.changed.length === 0 ? (
                    <span className="text-xs font-mono text-slate-600 italic">None</span>
                  ) : (
                    data.diff.changed.map((item: ChangedField, i: number) => (
                      <ChangedRow key={`${item.slug}-${item.field}-${i}`} item={item} />
                    ))
                  )}
                </DiffColumn>
              </div>
            </div>
          </>
        )}

        {/* Footer timestamp */}
        {data && (
          <p className="text-xs font-mono text-slate-700 text-right">
            generated {new Date(data.generatedAt).toLocaleTimeString()}
          </p>
        )}
      </div>
    </div>
  )
}

export default function TopologyDiffPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-slate-950 flex items-center justify-center">
          <span className="text-slate-500 font-mono text-sm animate-pulse">Loading…</span>
        </div>
      }
    >
      <TopologyDiffInner />
    </Suspense>
  )
}
