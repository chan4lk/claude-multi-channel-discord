'use client'

import { useEffect, useState, useCallback } from 'react'
import SubPageHeader from '../../components/SubPageHeader'
import type { TurnDurationResponse, TurnDurationStats, HistogramBucket } from '../api/turn-duration/route'

const PALETTE = [
  '#22D3EE', '#A855F7', '#F59E0B', '#10B981', '#EF4444',
  '#3B82F6', '#EC4899', '#14B8A6', '#F97316', '#8B5CF6',
]

function hashSlug(s: string): number {
  let h = 0
  for (const c of s) h = (Math.imul(31, h) + c.charCodeAt(0)) | 0
  return Math.abs(h)
}
function slugColor(s: string): string { return PALETTE[hashSlug(s) % PALETTE.length] }

function fmtSec(sec: number): string {
  if (sec < 60) return `${sec}s`
  return `${Math.floor(sec / 60)}m ${sec % 60}s`
}

function bucketLabel(b: HistogramBucket): string {
  if (b.maxSec >= 9000) return `${fmtSec(b.minSec)}+`
  return `${fmtSec(b.minSec)}–${fmtSec(b.maxSec)}`
}

function StatBadge({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="rounded border border-white/5 p-2 text-center" style={{ background: `${color}08` }}>
      <div className="text-base font-mono font-bold" style={{ color }}>{value}</div>
      <div className="text-[0.5rem] font-mono text-slate-600 mt-0.5">{label}</div>
    </div>
  )
}

function StatsPanel({ stats, slugs, selectedSlug }: { stats: TurnDurationStats[]; slugs: string[]; selectedSlug: string | null }) {
  const show = selectedSlug ? stats.filter((s) => s.slug === selectedSlug) : stats

  return (
    <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1">
      {show.map((s) => {
        const color = slugColor(s.slug)
        const threshPct = s.exceedsThresholdCount / Math.max(1, s.count)
        return (
          <div
            key={s.slug}
            className="rounded border border-white/5 p-3"
            style={{ background: 'rgba(255,255,255,0.02)' }}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-[0.65rem] font-mono" style={{ color }}>{s.slug}</span>
              <span className="text-[0.55rem] font-mono text-slate-500">{s.count} turns</span>
            </div>
            <div className="grid grid-cols-3 gap-2 mb-2">
              <StatBadge label="p50" value={fmtSec(s.p50)} color="#10B981" />
              <StatBadge label="p90" value={fmtSec(s.p90)} color="#F59E0B" />
              <StatBadge label="p99/max" value={fmtSec(s.max)} color="#EF4444" />
            </div>
            {s.exceedsThresholdCount > 0 && (
              <div className="text-[0.55rem] font-mono text-red-400">
                {s.exceedsThresholdCount} turns exceeded watchdog threshold ({fmtSec(s.stuckThresholdSeconds)}) — {Math.round(threshPct * 100)}%
              </div>
            )}
          </div>
        )
      })}
      {show.length === 0 && (
        <div className="text-[0.65rem] font-mono text-slate-600 py-8 text-center">No turn data</div>
      )}
    </div>
  )
}

function HistogramChart({
  histogram,
  slugs,
  selectedSlug,
  thresholdSec,
}: {
  histogram: HistogramBucket[]
  slugs: string[]
  selectedSlug: string | null
  thresholdSec: number
}) {
  const totalPerBucket = histogram.map((b) => Object.values(b.counts).reduce((a, c) => a + c, 0))
  const maxCount = Math.max(1, ...totalPerBucket)
  const BAR_H = 200

  const thresholdBucketIdx = histogram.findIndex(
    (b) => thresholdSec >= b.minSec && thresholdSec < b.maxSec
  )

  return (
    <div className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${histogram.length * 72 + 20} ${BAR_H + 60}`}
        className="w-full"
        style={{ minWidth: 400 }}
      >
        {/* Y axis label */}
        <text x="6" y={BAR_H / 2} fill="#475569" fontSize="0.45rem" fontFamily="monospace"
          transform={`rotate(-90, 6, ${BAR_H / 2})`} textAnchor="middle">
          turns
        </text>

        {histogram.map((bucket, bi) => {
          const x = 20 + bi * 72
          const total = totalPerBucket[bi]
          let yOff = 0

          // Stack by slug
          const segments: Array<{ slug: string; h: number }> = []
          for (const slug of slugs) {
            const n = bucket.counts[slug] ?? 0
            if (n > 0) segments.push({ slug, h: (n / maxCount) * BAR_H })
          }

          return (
            <g key={bi}>
              {/* Threshold marker */}
              {bi === thresholdBucketIdx && (
                <line
                  x1={x - 4} y1={0} x2={x - 4} y2={BAR_H}
                  stroke="#EF4444" strokeWidth={1.5} strokeDasharray="4,3"
                  opacity={0.6}
                />
              )}

              {/* Stacked bars */}
              {[...segments].reverse().map(({ slug, h }) => {
                const barY = BAR_H - yOff - h
                yOff += h
                return (
                  <rect
                    key={slug}
                    x={x} y={barY} width={60} height={h}
                    fill={slugColor(slug)}
                    fillOpacity={0.8}
                    rx={2}
                  />
                )
              })}

              {/* Bar outline */}
              <rect x={x} y={0} width={60} height={BAR_H}
                fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth={1} />

              {/* Count label */}
              {total > 0 && (
                <text x={x + 30} y={BAR_H - (totalPerBucket[bi] / maxCount) * BAR_H - 4}
                  textAnchor="middle" fill="#94A3B8" fontSize="0.5rem" fontFamily="monospace">
                  {total}
                </text>
              )}

              {/* X label */}
              <text x={x + 30} y={BAR_H + 14} textAnchor="middle"
                fill="#64748B" fontSize="0.45rem" fontFamily="monospace">
                {bucketLabel(bucket)}
              </text>
            </g>
          )
        })}

        {/* Threshold legend */}
        {thresholdBucketIdx >= 0 && (
          <text x={20 + thresholdBucketIdx * 72 - 6} y={BAR_H + 28}
            fill="#EF4444" fontSize="0.45rem" fontFamily="monospace" textAnchor="middle">
            ← watchdog
          </text>
        )}
      </svg>
    </div>
  )
}

export default function TurnDurationPage() {
  const [data, setData] = useState<TurnDurationResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null)
  const [windowDays, setWindowDays] = useState(30)

  const load = useCallback(() => {
    const params = new URLSearchParams({ days: String(windowDays) })
    if (selectedSlug) params.set('slug', selectedSlug)
    fetch(`/api/turn-duration?${params}`)
      .then((r) => r.json())
      .then((d: TurnDurationResponse) => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [windowDays, selectedSlug])

  useEffect(() => { setLoading(true); load() }, [load])

  const thresholdSec = data?.stats[0]?.stuckThresholdSeconds ?? 300

  return (
    <div className="min-h-screen p-4 md:p-6" style={{ background: '#080f1c', color: '#E2E8F0' }}>
      <SubPageHeader title="Turn Duration Histogram">
        <span className="text-[0.6rem] font-mono text-slate-500">
          Wall-clock time per Claude turn · watchdog threshold overlay
        </span>
      </SubPageHeader>

      {loading && (
        <div className="text-center py-20 text-slate-600 font-mono text-sm">Loading…</div>
      )}

      {!loading && data && (
        <div className="max-w-5xl mx-auto">
          {/* Controls */}
          <div className="flex flex-wrap items-center gap-3 mb-5">
            {[7, 14, 30, 60].map((d) => (
              <button
                key={d}
                onClick={() => setWindowDays(d)}
                className="text-[0.65rem] font-mono px-3 py-1 rounded border transition-colors"
                style={{
                  borderColor: windowDays === d ? '#22D3EE' : 'rgba(255,255,255,0.1)',
                  color: windowDays === d ? '#22D3EE' : '#64748B',
                  background: windowDays === d ? 'rgba(34,211,238,0.08)' : 'transparent',
                }}
              >
                {d}d
              </button>
            ))}
            <select
              value={selectedSlug ?? ''}
              onChange={(e) => setSelectedSlug(e.target.value || null)}
              className="text-[0.65rem] font-mono px-2 py-1 rounded border border-white/10"
              style={{ background: '#0d1b2e', color: '#E2E8F0' }}
            >
              <option value="">All projects</option>
              {data.slugs.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          {data.stats.length === 0 ? (
            <div className="text-center py-20 text-slate-600 font-mono text-sm">
              No turn timing data found in transcripts for this window
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-6">
              {/* Histogram */}
              <div
                className="rounded-lg border border-white/5 p-4"
                style={{ background: 'rgba(255,255,255,0.02)' }}
              >
                <div className="text-[0.6rem] font-mono text-slate-500 uppercase tracking-wider mb-3">
                  Turns per duration bucket
                  {selectedSlug ? ` — ${selectedSlug}` : ' — all projects'}
                </div>
                <HistogramChart
                  histogram={data.histogram}
                  slugs={data.slugs}
                  selectedSlug={selectedSlug}
                  thresholdSec={thresholdSec}
                />
                {/* Legend */}
                <div className="mt-3 flex flex-wrap gap-3">
                  {data.slugs.map((s) => (
                    <button
                      key={s}
                      onClick={() => setSelectedSlug(s === selectedSlug ? null : s)}
                      className="flex items-center gap-1.5 hover:opacity-80"
                    >
                      <div className="w-2 h-2 rounded-sm" style={{ background: slugColor(s) }} />
                      <span className="text-[0.55rem] font-mono" style={{ color: slugColor(s) }}>{s}</span>
                    </button>
                  ))}
                  <div className="flex items-center gap-1.5">
                    <div className="w-4 h-0 border-t border-dashed border-red-500 opacity-60" />
                    <span className="text-[0.55rem] font-mono text-red-400">watchdog threshold</span>
                  </div>
                </div>
              </div>

              {/* Stats panel */}
              <div
                className="rounded-lg border border-white/5 p-4"
                style={{ background: 'rgba(255,255,255,0.02)' }}
              >
                <div className="text-[0.6rem] font-mono text-slate-500 uppercase tracking-wider mb-3">
                  Percentiles by project
                </div>
                <StatsPanel
                  stats={data.stats}
                  slugs={data.slugs}
                  selectedSlug={selectedSlug}
                />
              </div>
            </div>
          )}

          <div className="text-[0.55rem] font-mono text-slate-700 text-right mt-4">
            Generated {new Date(data.generatedAt).toLocaleString()}
          </div>
        </div>
      )}
    </div>
  )
}
