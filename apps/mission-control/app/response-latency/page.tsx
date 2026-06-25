'use client'

import { useState } from 'react'
import SubPageHeader from '../../components/SubPageHeader'
import { useFreshness } from '../../lib/useFreshness'
import FreshnessBadge from '../../components/FreshnessBadge'
import type { ResponseLatencyResponse, ProjectLatency, LatencyTrend } from '../api/response-latency/route'

function fmtSecs(s: number): string {
  if (s < 60) return `${s}s`
  if (s < 3600) return `${(s / 60).toFixed(1)}m`
  return `${(s / 3600).toFixed(1)}h`
}

function p50Color(p50: number): string {
  if (p50 < 30) return '#4ADE80'
  if (p50 < 120) return '#F59E0B'
  return '#EF4444'
}

function trendGlyph(trend: LatencyTrend): { icon: string; color: string } {
  if (trend === 'improving') return { icon: '↓', color: '#4ADE80' }
  if (trend === 'degrading') return { icon: '↑', color: '#EF4444' }
  return { icon: '→', color: '#64748B' }
}

interface TooltipState {
  x: number
  y: number
  project: ProjectLatency
}

export default function ResponseLatencyPage() {
  const { data, isStale, lastError, lastSuccessAt } = useFreshness<ResponseLatencyResponse>(
    '/api/response-latency', 120_000
  )
  const [tooltip, setTooltip] = useState<TooltipState | null>(null)

  const projects = data?.projects ?? []
  const maxP90 = Math.max(1, ...projects.map(p => p.p90))

  const ROW_H = 40
  const LABEL_W = 140
  const CHART_W = 560
  const BOX_Y = 12
  const BOX_H = 16

  function xForSec(s: number): number {
    return Math.round((Math.min(s, maxP90) / maxP90) * CHART_W)
  }

  return (
    <div className="min-h-screen p-4 md:p-6" style={{ background: '#080f1c', color: '#E2E8F0' }}>
      <SubPageHeader title="Command Response Latency">
        <FreshnessBadge isStale={isStale} lastError={lastError} lastSuccessAt={lastSuccessAt} />
      </SubPageHeader>

      {!data && (
        <div className="text-center py-20 text-slate-600 font-mono text-sm">Loading…</div>
      )}

      {data && projects.length === 0 && (
        <div className="text-center py-20 text-slate-600 font-mono text-sm">
          No projects with ≥3 response samples found
        </div>
      )}

      {data && projects.length > 0 && (
        <div className="max-w-4xl mx-auto">
          {/* Legend */}
          <div className="flex gap-6 mb-4 flex-wrap text-[0.55rem] font-mono text-slate-500">
            <span><span className="text-green-400">●</span> &lt;30s p50 — fast</span>
            <span><span className="text-amber-400">●</span> 30–120s p50 — moderate</span>
            <span><span className="text-red-400">●</span> &gt;120s p50 — slow</span>
            <span className="ml-auto">box = p25–p75 · whiskers = p10–p90 · dot = p50</span>
          </div>

          {/* Box-and-whisker chart */}
          <div
            className="p-4 rounded border border-white/08 overflow-x-auto"
            style={{ background: '#060d19' }}
            onMouseLeave={() => setTooltip(null)}
          >
            <svg
              width={LABEL_W + CHART_W + 80}
              height={projects.length * ROW_H + 30}
            >
              {/* Grid lines */}
              {[0, 0.25, 0.5, 0.75, 1].map(f => {
                const x = LABEL_W + Math.round(f * CHART_W)
                const label = fmtSecs(Math.round(f * maxP90))
                return (
                  <g key={f}>
                    <line x1={x} y1={0} x2={x} y2={projects.length * ROW_H}
                      stroke="rgba(255,255,255,0.04)" strokeWidth={1} />
                    <text x={x} y={projects.length * ROW_H + 18} textAnchor="middle"
                      fontSize={7} fontFamily="monospace" fill="#475569">{label}</text>
                  </g>
                )
              })}

              {projects.map((p, i) => {
                const y = i * ROW_H
                const color = p50Color(p.p50)
                const trend = trendGlyph(p.trend)

                const x10 = LABEL_W + xForSec(p.p10)
                const x25 = LABEL_W + xForSec(p.p25)
                const x50 = LABEL_W + xForSec(p.p50)
                const x75 = LABEL_W + xForSec(p.p75)
                const x90 = LABEL_W + xForSec(p.p90)
                const boxY = y + BOX_Y
                const midY = y + ROW_H / 2

                return (
                  <g
                    key={p.slug}
                    onMouseEnter={ev => setTooltip({ x: ev.clientX, y: ev.clientY, project: p })}
                    style={{ cursor: 'pointer' }}
                  >
                    {/* Row bg */}
                    <rect x={0} y={y} width={LABEL_W + CHART_W + 80} height={ROW_H}
                      fill="transparent" />

                    {/* Slug label */}
                    <text x={LABEL_W - 8} y={midY + 4} textAnchor="end"
                      fontSize={9} fontFamily="monospace" fill="#94A3B8">
                      {p.slug.slice(0, 18)}
                    </text>

                    {/* Whisker left (p10 → p25) */}
                    <line x1={x10} y1={midY} x2={x25} y2={midY}
                      stroke={color} strokeWidth={1} opacity={0.5} />
                    <line x1={x10} y1={boxY + 3} x2={x10} y2={boxY + BOX_H - 3}
                      stroke={color} strokeWidth={1} opacity={0.5} />

                    {/* Box p25–p75 */}
                    <rect x={x25} y={boxY} width={x75 - x25} height={BOX_H}
                      fill={color} opacity={0.25} rx={2} />
                    <rect x={x25} y={boxY} width={x75 - x25} height={BOX_H}
                      fill="none" stroke={color} strokeWidth={1} opacity={0.6} rx={2} />

                    {/* p50 dot */}
                    <circle cx={x50} cy={midY} r={4} fill={color} />

                    {/* Whisker right (p75 → p90) */}
                    <line x1={x75} y1={midY} x2={x90} y2={midY}
                      stroke={color} strokeWidth={1} opacity={0.5} />
                    <line x1={x90} y1={boxY + 3} x2={x90} y2={boxY + BOX_H - 3}
                      stroke={color} strokeWidth={1} opacity={0.5} />

                    {/* p50 label */}
                    <text x={x90 + 6} y={midY + 4} fontSize={8} fontFamily="monospace" fill={color}>
                      {fmtSecs(p.p50)}
                    </text>

                    {/* Trend glyph */}
                    <text x={LABEL_W + CHART_W + 48} y={midY + 4} fontSize={10}
                      fontFamily="monospace" fill={trend.color} textAnchor="middle">
                      {trend.icon}
                    </text>

                    {/* Baseline separator */}
                    <line x1={0} y1={y + ROW_H} x2={LABEL_W + CHART_W + 80} y2={y + ROW_H}
                      stroke="rgba(255,255,255,0.03)" strokeWidth={1} />
                  </g>
                )
              })}
            </svg>
          </div>

          {/* Summary table */}
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-[0.6rem] font-mono">
              <thead>
                <tr className="text-slate-600 border-b border-white/06">
                  <th className="text-left pb-2 pr-4">project</th>
                  <th className="text-right pb-2 pr-4">p50</th>
                  <th className="text-right pb-2 pr-4">p90</th>
                  <th className="text-right pb-2 pr-4">p99</th>
                  <th className="text-right pb-2 pr-4">samples</th>
                  <th className="text-left pb-2">trend (7d)</th>
                </tr>
              </thead>
              <tbody>
                {projects.map(p => {
                  const trend = trendGlyph(p.trend)
                  const color = p50Color(p.p50)
                  return (
                    <tr key={p.slug} className="border-b border-white/04">
                      <td className="py-1.5 pr-4 text-cyan-300">{p.slug}</td>
                      <td className="py-1.5 pr-4 text-right" style={{ color }}>{fmtSecs(p.p50)}</td>
                      <td className="py-1.5 pr-4 text-right text-slate-400">{fmtSecs(p.p90)}</td>
                      <td className="py-1.5 pr-4 text-right text-slate-500">{fmtSecs(p.p99)}</td>
                      <td className="py-1.5 pr-4 text-right text-slate-500">{p.samples}</td>
                      <td className="py-1.5" style={{ color: trend.color }}>
                        {trend.icon} {p.trend}
                        {p.recent7dP90 !== null && p.prior7dP90 !== null && (
                          <span className="text-slate-600 ml-1">
                            ({fmtSecs(p.prior7dP90)} → {fmtSecs(p.recent7dP90)})
                          </span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="text-[0.5rem] font-mono text-slate-700 text-right mt-3">
            {projects.length} project{projects.length !== 1 ? 's' : ''} ·
            generated {data.generatedAt.slice(0, 16).replace('T', ' ')} UTC
          </div>
        </div>
      )}

      {/* Floating tooltip */}
      {tooltip && (
        <div
          className="fixed pointer-events-none rounded border border-white/10 px-3 py-2 text-[0.6rem] font-mono"
          style={{
            background: '#0d1b2e',
            left: Math.min(tooltip.x + 14, window.innerWidth - 240),
            top: Math.max(0, tooltip.y - 100),
            zIndex: 50,
            maxWidth: 240,
          }}
        >
          <div className="text-cyan-300 font-bold mb-1">{tooltip.project.slug}</div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-slate-400">
            <span>p10</span><span className="text-right">{fmtSecs(tooltip.project.p10)}</span>
            <span>p25</span><span className="text-right">{fmtSecs(tooltip.project.p25)}</span>
            <span className="text-cyan-300">p50</span>
            <span className="text-right" style={{ color: p50Color(tooltip.project.p50) }}>
              {fmtSecs(tooltip.project.p50)}
            </span>
            <span>p75</span><span className="text-right">{fmtSecs(tooltip.project.p75)}</span>
            <span>p90</span><span className="text-right">{fmtSecs(tooltip.project.p90)}</span>
            <span>p99</span><span className="text-right">{fmtSecs(tooltip.project.p99)}</span>
            <span className="text-slate-500">samples</span>
            <span className="text-right text-slate-500">{tooltip.project.samples}</span>
          </div>
        </div>
      )}
    </div>
  )
}
