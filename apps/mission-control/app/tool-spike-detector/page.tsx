'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import SubPageHeader from '../../components/SubPageHeader'
import type { ToolSpikeResponse, Spike, SpikeHistoryEntry, ToolErrorBucket, SpikeSeverity } from '../api/tool-spike-detector/route'

const SEV_COLOR: Record<SpikeSeverity, string> = {
  low:    '#F59E0B',
  medium: '#F97316',
  high:   '#EF4444',
}

function fmtBucket(tsMs: number): string {
  const d = new Date(tsMs)
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

function shortTool(name: string): string {
  return name.replace('mcp__mcd__', 'mcd:').replace('mcp__', '')
}

// ─── Heatmap ──────────────────────────────────────────────────────────────────

function SpikeHeatmap({ buckets }: { buckets: ToolErrorBucket[] }) {
  const [tooltip, setTooltip] = useState<{ bucket: ToolErrorBucket; x: number; y: number } | null>(null)

  if (buckets.length === 0) return <div className="text-slate-600 text-xs font-mono py-4">No tool errors in last 24h.</div>

  // Get unique tools (top 12 by total errors) and unique buckets (last 24 × 12 = 288 max)
  const toolTotals = new Map<string, number>()
  for (const b of buckets) {
    toolTotals.set(b.tool, (toolTotals.get(b.tool) ?? 0) + b.errorCount)
  }
  const topTools = [...toolTotals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([t]) => t)

  const bucketTimes = [...new Set(buckets.map((b) => b.bucketTs))].sort((a, b) => a - b).slice(-24)

  const CELL_W = 28, CELL_H = 18
  const LEFT = 90, TOP = 16, BOTTOM = 20
  const svgW = LEFT + bucketTimes.length * CELL_W + 4
  const svgH = TOP + topTools.length * CELL_H + BOTTOM

  const maxErrors = Math.max(...buckets.map((b) => b.errorCount), 1)

  const cellMap = new Map<string, ToolErrorBucket>()
  for (const b of buckets) {
    cellMap.set(`${b.tool}::${b.bucketTs}`, b)
  }

  return (
    <div className="relative overflow-x-auto">
      <svg width={svgW} height={svgH}>
        {/* Time labels */}
        {bucketTimes.filter((_, i) => i % 3 === 0).map((ts) => {
          const col = bucketTimes.indexOf(ts)
          return (
            <text key={ts} x={LEFT + col * CELL_W + CELL_W / 2} y={12} textAnchor="middle" fill="#334155" fontSize={7} fontFamily="monospace">
              {fmtBucket(ts)}
            </text>
          )
        })}

        {topTools.map((tool, row) => (
          <g key={tool}>
            {/* Tool label */}
            <text x={LEFT - 4} y={TOP + row * CELL_H + CELL_H / 2 + 3} textAnchor="end" fill="#475569" fontSize={7} fontFamily="monospace">
              {shortTool(tool).slice(0, 14)}
            </text>

            {bucketTimes.map((ts, col) => {
              const b = cellMap.get(`${tool}::${ts}`)
              const count = b?.errorCount ?? 0
              const affected = b?.slugs.length ?? 0
              const intensity = count / maxErrors
              const isSpike = affected >= 3
              const color = isSpike ? '#EF4444' : '#F59E0B'
              const alpha = count === 0 ? 0.05 : 0.15 + 0.85 * intensity
              return (
                <rect
                  key={ts}
                  x={LEFT + col * CELL_W + 1}
                  y={TOP + row * CELL_H + 1}
                  width={CELL_W - 2}
                  height={CELL_H - 2}
                  rx={2}
                  fill={count === 0 ? 'rgba(30,58,95,0.2)' : `rgba(${isSpike ? '239,68,68' : '245,158,11'},${alpha})`}
                  stroke={isSpike ? `${color}60` : 'none'}
                  strokeWidth={1}
                  style={{ cursor: count > 0 ? 'pointer' : 'default' }}
                  onMouseEnter={(e) => {
                    if (!b) return
                    const rect = (e.target as SVGRectElement).getBoundingClientRect()
                    setTooltip({ bucket: b, x: rect.left + rect.width / 2, y: rect.top })
                  }}
                  onMouseLeave={() => setTooltip(null)}
                />
              )
            })}
          </g>
        ))}

        {/* Legend */}
        <text x={LEFT} y={svgH - 3} fill="#334155" fontSize={6} fontFamily="monospace">yellow=isolated · red=spike (≥3 projects)</text>
      </svg>

      {tooltip && (
        <div
          className="fixed z-50 pointer-events-none px-2 py-1.5 rounded text-[0.55rem] font-mono flex flex-col gap-0.5"
          style={{ left: tooltip.x, top: tooltip.y - 56, transform: 'translateX(-50%)', background: 'rgba(4,10,20,0.95)', border: '1px solid #1e3a5f', color: '#94a3b8' }}
        >
          <div><span className="text-slate-300">{shortTool(tooltip.bucket.tool)}</span> @ {fmtBucket(tooltip.bucket.bucketTs)}</div>
          <div><span style={{ color: '#EF4444' }}>{tooltip.bucket.errorCount} errors</span> · {tooltip.bucket.slugs.length} projects</div>
          <div className="text-slate-600">{tooltip.bucket.slugs.slice(0, 4).join(', ')}{tooltip.bucket.slugs.length > 4 ? '…' : ''}</div>
        </div>
      )}
    </div>
  )
}

// ─── History timeline ─────────────────────────────────────────────────────────

function HistoryTimeline({ history }: { history: SpikeHistoryEntry[] }) {
  if (history.length === 0) return <div className="text-slate-600 text-xs font-mono py-4">No spikes in last 24h.</div>
  return (
    <div className="flex flex-col gap-1 max-h-64 overflow-y-auto">
      {history.map((h, i) => (
        <div key={i} className="flex items-center gap-3 text-[0.6rem] font-mono py-1 border-b border-white/3">
          <span className="text-slate-600 shrink-0 w-20">{fmtBucket(h.ts)}</span>
          <span
            className="shrink-0 px-1.5 py-0.5 rounded text-[0.5rem] font-bold uppercase"
            style={{ background: `${SEV_COLOR[h.severity]}18`, color: SEV_COLOR[h.severity] }}
          >
            {h.severity}
          </span>
          <span className="text-slate-300 truncate">{shortTool(h.tool)}</span>
          <span className="text-slate-500 shrink-0">{h.affectedCount} projects</span>
        </div>
      ))}
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function ToolSpikeDetectorPage() {
  const [data, setData] = useState<ToolSpikeResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/tool-spike-detector')
      if (res.ok) {
        setData(await res.json() as ToolSpikeResponse)
        setLastRefresh(new Date())
      }
    } catch { /* skip */ } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
    intervalRef.current = setInterval(fetchData, 30_000)
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [fetchData])

  const hasSpikes = (data?.currentSpikes.length ?? 0) > 0

  return (
    <div className="min-h-dvh flex flex-col" style={{ background: '#020811', fontFamily: 'JetBrains Mono, monospace' }}>
      <SubPageHeader title="TOOL FAILURE SPIKE DETECTOR" />

      {/* Header badge */}
      <div className="flex items-center gap-4 px-4 py-2 border-b border-white/5" style={{ background: '#060d1a' }}>
        {hasSpikes ? (
          <div
            className="px-3 py-1 rounded text-xs font-mono font-bold animate-pulse"
            style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.4)', color: '#EF4444' }}
          >
            ⚠ {data!.currentSpikes.length} ACTIVE SPIKE{data!.currentSpikes.length > 1 ? 'S' : ''}
          </div>
        ) : data && !loading ? (
          <div
            className="px-3 py-1 rounded text-xs font-mono"
            style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.3)', color: '#10B981' }}
          >
            ✓ No active spikes
          </div>
        ) : null}
        <div className="flex-1" />
        {lastRefresh && (
          <span className="text-[0.55rem] font-mono text-slate-600">
            updated {lastRefresh.toLocaleTimeString()} · auto-refresh 30s
          </span>
        )}
        <button
          onClick={fetchData}
          className="text-[0.6rem] font-mono px-2 py-0.5 rounded border border-slate-700 text-slate-500 hover:text-slate-300 transition-colors"
        >
          ↻
        </button>
      </div>

      {loading && <div className="p-8 text-slate-500 text-xs font-mono">Scanning transcripts…</div>}

      {data && (
        <div className="p-4 flex flex-col gap-6" style={{ maxWidth: 1100 }}>
          {/* Active spikes */}
          {hasSpikes && (
            <div className="rounded border p-4" style={{ background: 'rgba(239,68,68,0.04)', borderColor: '#EF444440' }}>
              <div className="text-[0.6rem] font-mono uppercase tracking-widest mb-3" style={{ color: '#EF4444' }}>
                Active Spikes (last 10 min)
              </div>
              <div className="flex flex-col gap-2">
                {data.currentSpikes.map((s: Spike, i) => (
                  <div key={i} className="flex items-start gap-3 text-[0.6rem] font-mono">
                    <span
                      className="shrink-0 px-1.5 py-0.5 rounded font-bold uppercase text-[0.5rem]"
                      style={{ background: `${SEV_COLOR[s.severity]}18`, color: SEV_COLOR[s.severity] }}
                    >
                      {s.severity}
                    </span>
                    <div className="flex-1">
                      <span className="text-slate-200">{shortTool(s.tool)}</span>
                      <span className="text-slate-500 ml-2">{s.errorCount} errors across {s.affectedSlugs.length} projects</span>
                      <div className="text-slate-600 text-[0.5rem] mt-0.5">{s.affectedSlugs.join(', ')}</div>
                    </div>
                    <span className="text-slate-600 shrink-0">{fmtBucket(s.windowStart)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Heatmap */}
          <div className="rounded border p-4" style={{ background: '#060d1a', borderColor: '#1e3a5f' }}>
            <div className="text-[0.6rem] font-mono text-slate-400 uppercase tracking-widest mb-3">
              Tool Error Rate Heatmap — Last 24h (5-min buckets)
            </div>
            <SpikeHeatmap buckets={data.heatmapBuckets} />
          </div>

          {/* History */}
          <div className="rounded border p-4" style={{ background: '#060d1a', borderColor: '#1e3a5f' }}>
            <div className="text-[0.6rem] font-mono text-slate-400 uppercase tracking-widest mb-3">
              Spike History — Last 24h
            </div>
            <HistoryTimeline history={data.history} />
          </div>
        </div>
      )}
    </div>
  )
}
