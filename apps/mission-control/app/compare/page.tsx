'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense } from 'react'
import type { FleetProject } from '../api/fleet/route'
import type { SlugMetrics } from '../api/metrics/[slug]/route'
import type { TimelineEntry } from '../api/projects/[slug]/timeline/route'

// ─── Types ────────────────────────────────────────────────────────────────────

interface ProjectData {
  slug: string
  state: string
  ageMins: number
  contextUsagePct?: number
  goalText?: string
  metrics: SlugMetrics | null
  memoryCount: number
  timeline: TimelineEntry[]
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtCost(usd: number): string {
  if (usd < 0.01) return '<$0.01'
  return `$${usd.toFixed(2)}`
}

function fmtMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${(ms / 60000).toFixed(1)}m`
}

function fmtAge(mins: number): string {
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`
  return `${Math.round(mins / 1440)}d ago`
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`
  return String(n)
}

const STATE_COLOR: Record<string, string> = {
  active: '#4ADE80',
  stalled: '#EF4444',
  autonomous: '#A855F7',
  idle: '#22D3EE',
}

const EVENT_ICON: Record<string, string> = {
  spawn: '🟢', kill: '🔴', crash: '💥', stuck: '⚠️',
  'budget-alert': '🔶', 'scheduler-fire': '📅',
  distillation: '💭', reply: '💬', audit: '📋', other: '⬡',
}

// ─── Diff banner ──────────────────────────────────────────────────────────────

interface DiffFlag {
  label: string
  aVal: string
  bVal: string
  winner: 'a' | 'b' | 'tie'
}

function computeDiffs(a: ProjectData, b: ProjectData): DiffFlag[] {
  const flags: DiffFlag[] = []
  const am = a.metrics
  const bm = b.metrics
  if (!am || !bm) return flags

  const check = (
    label: string,
    aNum: number,
    bNum: number,
    threshold: number,
    fmtFn: (n: number) => string,
    lowerIsBetter = false
  ) => {
    if (aNum === 0 && bNum === 0) return
    const ratio = aNum > 0 && bNum > 0 ? Math.max(aNum, bNum) / Math.min(aNum, bNum) : 0
    if (ratio < threshold && ratio > 0) return
    const winner: 'a' | 'b' | 'tie' =
      aNum === bNum ? 'tie'
      : lowerIsBetter
        ? (aNum < bNum ? 'a' : 'b')
        : (aNum > bNum ? 'a' : 'b')
    flags.push({ label, aVal: fmtFn(aNum), bVal: fmtFn(bNum), winner })
  }

  check('Cost', am.estimatedCostUsd, bm.estimatedCostUsd, 2, fmtCost, false)
  check('Avg latency', am.avgLatencyMs, bm.avgLatencyMs, 3, fmtMs, true)
  check('Turns/day', am.turnsPerDay, bm.turnsPerDay, 2, (n) => n.toFixed(1), false)
  check('Input tokens', am.totalInputTokens, bm.totalInputTokens, 2, fmtTokens, false)
  check('Memory', a.memoryCount, b.memoryCount, 2, String, false)

  return flags
}

// ─── Column ───────────────────────────────────────────────────────────────────

function StatRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-white/5 last:border-none">
      <span className="text-[0.6rem] font-mono text-slate-500 uppercase tracking-wide">{label}</span>
      <span
        className="text-[0.7rem] font-mono font-semibold"
        style={{ color: highlight ? '#F59E0B' : '#CBD5E1' }}
      >
        {value}
      </span>
    </div>
  )
}

function ProjectColumn({ data, side }: { data: ProjectData; side: 'a' | 'b' }) {
  const stateColor = STATE_COLOR[data.state] ?? '#64748b'
  const m = data.metrics

  const EVENT_COLOR: Record<string, string> = {
    spawn: '#4ADE80', kill: '#EF4444', crash: '#EF4444', stuck: '#F59E0B',
    'budget-alert': '#F97316', 'scheduler-fire': '#FCD34D',
    distillation: '#A855F7', reply: '#00F5FF', audit: '#64748b', other: '#334155',
  }

  return (
    <div
      className="flex-1 min-w-0 rounded-xl border p-5 flex flex-col gap-4"
      style={{ background: '#080f1c', borderColor: `${stateColor}30` }}
    >
      {/* Header */}
      <div className="flex items-center gap-3 flex-wrap">
        <span
          className="text-[0.5rem] font-mono uppercase tracking-widest px-1.5 py-0.5 rounded"
          style={{ color: side === 'a' ? '#00F5FF' : '#A78BFA', background: side === 'a' ? '#00F5FF15' : '#A78BFA15' }}
        >
          {side.toUpperCase()}
        </span>
        <Link
          href={`/projects/${encodeURIComponent(data.slug)}`}
          className="text-base font-black tracking-wide hover:underline"
          style={{ color: stateColor, fontFamily: 'Orbitron, JetBrains Mono, monospace' }}
        >
          {data.slug}
        </Link>
        <span
          className="text-[0.6rem] font-mono px-2 py-0.5 rounded-full"
          style={{ color: stateColor, background: `${stateColor}20`, border: `1px solid ${stateColor}40` }}
        >
          {data.state}
        </span>
      </div>

      {/* Stats */}
      <div className="rounded-lg border border-white/5 p-3" style={{ background: '#040a14' }}>
        <div className="text-[0.5rem] font-mono uppercase tracking-widest text-slate-600 mb-2">Overview</div>
        <StatRow label="Last active" value={fmtAge(data.ageMins)} />
        <StatRow label="Context fill" value={data.contextUsagePct != null ? `${data.contextUsagePct}%` : '—'} highlight={(data.contextUsagePct ?? 0) > 70} />
        <StatRow label="Memory entries" value={String(data.memoryCount)} />
        {data.goalText && (
          <div className="mt-2 text-[0.6rem] font-mono text-slate-500 italic leading-relaxed line-clamp-2">
            Goal: {data.goalText}
          </div>
        )}
      </div>

      {/* Metrics */}
      {m ? (
        <div className="rounded-lg border border-white/5 p-3" style={{ background: '#040a14' }}>
          <div className="text-[0.5rem] font-mono uppercase tracking-widest text-slate-600 mb-2">Metrics</div>
          <StatRow label="Input tokens" value={fmtTokens(m.totalInputTokens)} />
          <StatRow label="Output tokens" value={fmtTokens(m.totalOutputTokens)} />
          <StatRow label="Est. cost" value={fmtCost(m.estimatedCostUsd)} />
          <StatRow label="Avg latency" value={fmtMs(m.avgLatencyMs)} />
          <StatRow label="p95 latency" value={fmtMs(m.p95LatencyMs)} />
          <StatRow label="Turns/day" value={m.turnsPerDay.toFixed(1)} />
        </div>
      ) : (
        <div className="rounded-lg border border-white/5 p-3 text-center text-slate-700 text-xs font-mono" style={{ background: '#040a14' }}>
          No metrics data
        </div>
      )}

      {/* Recent timeline */}
      <div className="rounded-lg border border-white/5 p-3" style={{ background: '#040a14' }}>
        <div className="text-[0.5rem] font-mono uppercase tracking-widest text-slate-600 mb-2">Recent events</div>
        {data.timeline.length === 0 ? (
          <div className="text-[0.6rem] font-mono text-slate-700 text-center py-2">No events</div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {data.timeline.slice(0, 5).map((e) => {
              const color = EVENT_COLOR[e.eventType] ?? '#334155'
              const label = e.auditVerb
                ? `${e.auditVerb}${e.auditActor ? ` by ${e.auditActor}` : ''}`
                : e.rawType.replace(/_/g, ' ')
              return (
                <div key={e.id} className="flex items-center gap-2">
                  <span className="text-xs">{EVENT_ICON[e.eventType] ?? '⬡'}</span>
                  <span className="text-[0.6rem] font-mono truncate flex-1" style={{ color }}>{label}</span>
                  <span className="text-[0.55rem] font-mono text-slate-700 shrink-0">
                    {new Date(e.ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Diff Banner ──────────────────────────────────────────────────────────────

function DiffBanner({ slugA, slugB, flags }: { slugA: string; slugB: string; flags: DiffFlag[] }) {
  if (flags.length === 0) return null
  return (
    <div
      className="rounded-xl border p-4 mb-6"
      style={{ background: '#0d1220', borderColor: '#F59E0B30' }}
    >
      <div className="text-[0.55rem] font-mono uppercase tracking-widest text-amber-500/70 mb-3">
        ⚡ Significant divergences
      </div>
      <div className="flex flex-wrap gap-3">
        {flags.map((f) => (
          <div
            key={f.label}
            className="rounded-lg border px-3 py-2 flex flex-col gap-1 min-w-[120px]"
            style={{ background: '#040a14', borderColor: '#F59E0B25' }}
          >
            <div className="text-[0.5rem] font-mono uppercase tracking-widest text-slate-600">{f.label}</div>
            <div className="flex items-center gap-2">
              <span
                className="text-[0.65rem] font-mono font-semibold"
                style={{ color: f.winner === 'a' ? '#4ADE80' : '#64748b' }}
              >
                {slugA}: {f.aVal}
              </span>
              <span className="text-slate-700 text-[0.6rem]">vs</span>
              <span
                className="text-[0.65rem] font-mono font-semibold"
                style={{ color: f.winner === 'b' ? '#4ADE80' : '#64748b' }}
              >
                {slugB}: {f.bVal}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

function CompareInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const slugA = searchParams.get('a') ?? ''
  const slugB = searchParams.get('b') ?? ''

  const [allSlugs, setAllSlugs] = useState<string[]>([])
  const [dataA, setDataA] = useState<ProjectData | null>(null)
  const [dataB, setDataB] = useState<ProjectData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Load slug list from fleet
  useEffect(() => {
    fetch('/api/fleet')
      .then((r) => r.json())
      .then((d: { projects: FleetProject[] }) => {
        setAllSlugs(d.projects.map((p) => p.slug).sort())
      })
      .catch(() => {})
  }, [])

  const fetchProject = useCallback(async (slug: string, fleet: FleetProject[]): Promise<ProjectData> => {
    const fp: FleetProject = fleet.find((p) => p.slug === slug) ?? { slug, state: 'idle', ageMins: 0, stuckThresholdMinutes: 5 }

    const [metrics, memoriesRaw, timelineRaw] = await Promise.all([
      fetch(`/api/metrics/${encodeURIComponent(slug)}`).then((r) => r.ok ? r.json() : null) as Promise<SlugMetrics | null>,
      fetch(`/api/memories?slug=${encodeURIComponent(slug)}&limit=500`).then((r) => r.ok ? r.json() : []) as Promise<unknown[]>,
      fetch(`/api/projects/${encodeURIComponent(slug)}/timeline`).then((r) => r.ok ? r.json() : { entries: [] }) as Promise<{ entries: TimelineEntry[] }>,
    ])

    return {
      slug,
      state: fp.state,
      ageMins: fp.ageMins,
      contextUsagePct: fp.contextUsagePct,
      goalText: fp.goalText,
      metrics,
      memoryCount: Array.isArray(memoriesRaw) ? memoriesRaw.length : 0,
      timeline: timelineRaw.entries ?? [],
    }
  }, [])

  // Load both projects when slugs change
  useEffect(() => {
    if (!slugA || !slugB) { setDataA(null); setDataB(null); return }
    setLoading(true)
    setError(null)

    fetch('/api/fleet')
      .then((r) => r.json())
      .then(async (d: { projects: FleetProject[] }) => {
        const [a, b] = await Promise.all([
          fetchProject(slugA, d.projects),
          fetchProject(slugB, d.projects),
        ])
        setDataA(a)
        setDataB(b)
      })
      .catch((e) => setError(e.message ?? 'Failed to load'))
      .finally(() => setLoading(false))
  }, [slugA, slugB, fetchProject])

  function setSlug(side: 'a' | 'b', val: string) {
    const params = new URLSearchParams(searchParams.toString())
    params.set(side, val)
    router.push(`/compare?${params.toString()}`)
  }

  const diffs = dataA && dataB ? computeDiffs(dataA, dataB) : []

  return (
    <div className="min-h-dvh flex flex-col" style={{ background: '#060d1a' }}>
      {/* Header */}
      <header className="relative border-b border-cyber-cyan/12 bg-cyber-surface/70 backdrop-blur-md px-6 py-3">
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-cyber-cyan/40 to-transparent" />
        <div className="flex items-center gap-4 flex-wrap">
          <Link href="/" className="text-[0.6rem] font-mono text-slate-500 hover:text-cyber-cyan transition-colors uppercase tracking-wider">
            ← Dashboard
          </Link>
          <h1
            className="text-lg font-black tracking-[0.18em] text-cyber-cyan"
            style={{ fontFamily: 'Orbitron, JetBrains Mono, monospace' }}
          >
            PROJECT COMPARE
          </h1>
        </div>
      </header>

      <main className="flex-1 px-4 sm:px-6 py-6 max-w-6xl mx-auto w-full">
        {/* Selectors */}
        <div className="flex items-center gap-4 mb-6 flex-wrap">
          <div className="flex items-center gap-2">
            <span
              className="text-[0.55rem] font-mono uppercase tracking-widest px-1.5 py-0.5 rounded"
              style={{ color: '#00F5FF', background: '#00F5FF15' }}
            >A</span>
            <select
              value={slugA}
              onChange={(e) => setSlug('a', e.target.value)}
              className="text-xs font-mono rounded border px-2 py-1 focus:outline-none focus:ring-1 focus:ring-cyber-cyan/40"
              style={{ background: '#080f1c', color: '#CBD5E1', borderColor: '#1e3a5f', minWidth: 140 }}
            >
              <option value="">— select project —</option>
              {allSlugs.map((s) => (
                <option key={s} value={s} disabled={s === slugB}>{s}</option>
              ))}
            </select>
          </div>

          <span className="text-slate-600 font-mono text-sm">vs</span>

          <div className="flex items-center gap-2">
            <span
              className="text-[0.55rem] font-mono uppercase tracking-widest px-1.5 py-0.5 rounded"
              style={{ color: '#A78BFA', background: '#A78BFA15' }}
            >B</span>
            <select
              value={slugB}
              onChange={(e) => setSlug('b', e.target.value)}
              className="text-xs font-mono rounded border px-2 py-1 focus:outline-none focus:ring-1 focus:ring-cyber-cyan/40"
              style={{ background: '#080f1c', color: '#CBD5E1', borderColor: '#1e3a5f', minWidth: 140 }}
            >
              <option value="">— select project —</option>
              {allSlugs.map((s) => (
                <option key={s} value={s} disabled={s === slugA}>{s}</option>
              ))}
            </select>
          </div>

          {(slugA || slugB) && (
            <button
              onClick={() => router.push('/compare')}
              className="text-[0.6rem] font-mono text-slate-600 hover:text-slate-400 transition-colors"
            >
              clear
            </button>
          )}
        </div>

        {/* Empty state */}
        {!slugA && !slugB && (
          <div className="flex flex-col items-center justify-center h-64 gap-3 text-slate-700">
            <div className="text-5xl opacity-15">⬡</div>
            <div className="text-sm font-mono">Select two projects to compare</div>
            <div className="text-[0.65rem] font-mono text-slate-600">
              URL encodes as <code className="text-slate-500">?a=slug1&amp;b=slug2</code> — share the link
            </div>
          </div>
        )}

        {/* Partial selection */}
        {(slugA || slugB) && !(slugA && slugB) && (
          <div className="flex flex-col items-center justify-center h-48 gap-2 text-slate-700">
            <div className="text-sm font-mono">Pick a second project to compare</div>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center h-64 text-slate-600 font-mono text-xs animate-pulse">
            Loading comparison…
          </div>
        )}

        {/* Error */}
        {error && !loading && (
          <div className="flex flex-col items-center justify-center h-48 gap-2 text-red-500/70">
            <div className="text-sm font-mono">{error}</div>
          </div>
        )}

        {/* Results */}
        {!loading && !error && dataA && dataB && (
          <>
            <DiffBanner slugA={slugA} slugB={slugB} flags={diffs} />
            <div className="flex gap-4 flex-col md:flex-row">
              <ProjectColumn data={dataA} side="a" />
              <ProjectColumn data={dataB} side="b" />
            </div>
          </>
        )}
      </main>
    </div>
  )
}

export default function ComparePage() {
  return (
    <Suspense fallback={
      <div className="min-h-dvh flex items-center justify-center text-slate-600 font-mono text-xs animate-pulse">
        Loading…
      </div>
    }>
      <CompareInner />
    </Suspense>
  )
}
