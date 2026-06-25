'use client'

import { useMemo, useState } from 'react'
import type { FleetResponse, FleetProject, ProjectState } from '../api/fleet/route'
import { useFreshness } from '../../lib/useFreshness'
import FreshnessBadge from '../../components/FreshnessBadge'
import SubPageHeader from '../../components/SubPageHeader'

const STATE_COLOR: Record<ProjectState, string> = {
  active: '#4ADE80',
  idle: '#22D3EE',
  stalled: '#EF4444',
  autonomous: '#A78BFA',
}

function fmtAge(mins: number): string {
  if (mins < 60) return `${Math.round(mins)}m`
  if (mins < 1440) return `${(mins / 60).toFixed(1)}h`
  return `${(mins / 1440).toFixed(1)}d`
}

function starPath(cx: number, cy: number, r: number): string {
  const pts: string[] = []
  for (let i = 0; i < 10; i++) {
    const angle = (i * Math.PI) / 5 - Math.PI / 2
    const radius = i % 2 === 0 ? r : r * 0.4
    const x = cx + Math.cos(angle) * radius
    const y = cy + Math.sin(angle) * radius
    pts.push(`${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`)
  }
  return pts.join(' ') + ' Z'
}

interface TooltipData {
  project: FleetProject
  mx: number
  my: number
}

interface PlotPoint {
  project: FleetProject
  px: number
  py: number
  r: number
  color: string
  missing: boolean
}

const MARGIN = { top: 30, right: 30, bottom: 50, left: 55 }
const W = 720
const H = 480
const INNER_W = W - MARGIN.left - MARGIN.right
const INNER_H = H - MARGIN.top - MARGIN.bottom

export default function StarMapPage() {
  const { data, isStale, lastError, lastSuccessAt } = useFreshness<FleetResponse>('/api/fleet', 60_000)
  const [tooltip, setTooltip] = useState<TooltipData | null>(null)

  const projects = data?.projects ?? []
  const loading = data === null && lastError === null

  const points = useMemo<PlotPoint[]>(() => {
    return projects.map(p => {
      const conv = p.convergenceScore ?? null
      const ctx = p.contextUsagePct ?? null
      const missing = conv === null || ctx === null

      const xVal = conv ?? 0
      const yVal = ctx ?? 0

      const px = MARGIN.left + xVal * INNER_W
      const py = MARGIN.top + (1 - yVal / 100) * INNER_H

      const ageDays = p.ageMins / 1440
      const r = Math.min(16, 8 + Math.min(ageDays, 90) / 90 * 8)

      return {
        project: p,
        px,
        py,
        r,
        color: STATE_COLOR[p.state] ?? '#64748B',
        missing,
      }
    })
  }, [projects])

  const xTicks = [0, 0.25, 0.5, 0.75, 1.0]
  const yTicks = [0, 25, 50, 75, 100]

  return (
    <div className="min-h-screen p-4 md:p-6" style={{ background: '#080f1c', color: '#E2E8F0' }}>
      <SubPageHeader title="Fleet Star Map">
        <FreshnessBadge isStale={isStale} lastError={lastError} lastSuccessAt={lastSuccessAt} />
      </SubPageHeader>

      <p className="text-xs text-slate-500 mb-4">
        X = convergence score (0–1) · Y = context fill % (0–100) · Star size = project age · Color = state · Active projects pulse
      </p>

      <style>{`
        @keyframes starPulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.45; }
        }
        .star-active { animation: starPulse 1.8s ease-in-out infinite; }
      `}</style>

      <div className="flex gap-4 mb-4 flex-wrap">
        {(Object.entries(STATE_COLOR) as [ProjectState, string][]).map(([state, color]) => (
          <div key={state} className="flex items-center gap-1.5 text-xs font-mono">
            <span style={{ width: 10, height: 10, background: color, borderRadius: 2, display: 'inline-block' }} />
            <span style={{ color }}>{state}</span>
          </div>
        ))}
        <div className="flex items-center gap-1.5 text-xs font-mono">
          <span style={{ width: 10, height: 10, background: '#334155', borderRadius: 2, display: 'inline-block', opacity: 0.5 }} />
          <span style={{ color: '#64748B' }}>missing data (origin)</span>
        </div>
      </div>

      {loading && (
        <div className="text-center py-20 text-slate-600 font-mono text-sm animate-pulse">Mapping stars…</div>
      )}

      {!loading && (
        <div
          className="relative inline-block"
          onMouseLeave={() => setTooltip(null)}
        >
          <svg
            width="100%"
            viewBox={`0 0 ${W} ${H}`}
            style={{ display: 'block', maxWidth: W }}
          >
            {/* Quadrant dividers */}
            <line
              x1={MARGIN.left + INNER_W * 0.5}
              y1={MARGIN.top}
              x2={MARGIN.left + INNER_W * 0.5}
              y2={MARGIN.top + INNER_H}
              stroke="#1E293B"
              strokeWidth={1}
              strokeDasharray="6 4"
            />
            <line
              x1={MARGIN.left}
              y1={MARGIN.top + INNER_H * 0.5}
              x2={MARGIN.left + INNER_W}
              y2={MARGIN.top + INNER_H * 0.5}
              stroke="#1E293B"
              strokeWidth={1}
              strokeDasharray="6 4"
            />

            {/* Quadrant labels */}
            <text x={MARGIN.left + INNER_W * 0.75} y={MARGIN.top + 16} textAnchor="middle" fontSize={9} fill="#22D3EE" fontFamily="monospace" opacity={0.6}>Maturing</text>
            <text x={MARGIN.left + INNER_W * 0.25} y={MARGIN.top + 16} textAnchor="middle" fontSize={9} fill="#475569" fontFamily="monospace" opacity={0.6}>Starting</text>
            <text x={MARGIN.left + INNER_W * 0.75} y={MARGIN.top + INNER_H - 8} textAnchor="middle" fontSize={9} fill="#4ADE80" fontFamily="monospace" opacity={0.6}>Optimal</text>
            <text x={MARGIN.left + INNER_W * 0.25} y={MARGIN.top + INNER_H - 8} textAnchor="middle" fontSize={9} fill="#EF4444" fontFamily="monospace" opacity={0.6}>Diverging</text>

            {/* Y-axis ticks + labels */}
            {yTicks.map(v => {
              const py = MARGIN.top + (1 - v / 100) * INNER_H
              return (
                <g key={v}>
                  <line x1={MARGIN.left - 4} y1={py} x2={MARGIN.left} y2={py} stroke="#334155" strokeWidth={1} />
                  <text x={MARGIN.left - 7} y={py + 4} textAnchor="end" fontSize={9} fill="#475569" fontFamily="monospace">{v}</text>
                </g>
              )
            })}

            {/* X-axis ticks + labels */}
            {xTicks.map(v => {
              const px = MARGIN.left + v * INNER_W
              return (
                <g key={v}>
                  <line x1={px} y1={MARGIN.top + INNER_H} x2={px} y2={MARGIN.top + INNER_H + 4} stroke="#334155" strokeWidth={1} />
                  <text x={px} y={MARGIN.top + INNER_H + 16} textAnchor="middle" fontSize={9} fill="#475569" fontFamily="monospace">{v.toFixed(2)}</text>
                </g>
              )
            })}

            {/* Axis borders */}
            <line x1={MARGIN.left} y1={MARGIN.top} x2={MARGIN.left} y2={MARGIN.top + INNER_H} stroke="#1E293B" strokeWidth={1} />
            <line x1={MARGIN.left} y1={MARGIN.top + INNER_H} x2={MARGIN.left + INNER_W} y2={MARGIN.top + INNER_H} stroke="#1E293B" strokeWidth={1} />

            {/* Axis labels */}
            <text x={MARGIN.left + INNER_W / 2} y={H - 4} textAnchor="middle" fontSize={10} fill="#475569" fontFamily="monospace">convergence score →</text>
            <text
              x={12}
              y={MARGIN.top + INNER_H / 2}
              textAnchor="middle"
              fontSize={10}
              fill="#475569"
              fontFamily="monospace"
              transform={`rotate(-90, 12, ${MARGIN.top + INNER_H / 2})`}
            >context fill % →</text>

            {/* Stars */}
            {points.map(({ project, px, py, r, color, missing }) => (
              <path
                key={project.slug}
                d={starPath(px, py, r)}
                fill={color}
                stroke="#080f1c"
                strokeWidth={1}
                opacity={missing ? 0.35 : 0.9}
                className={project.state === 'active' && !missing ? 'star-active' : undefined}
                style={{ cursor: 'pointer' }}
                onMouseMove={e => {
                  const svg = (e.target as SVGElement).ownerSVGElement!
                  const rect = svg.getBoundingClientRect()
                  setTooltip({
                    project,
                    mx: e.clientX - rect.left,
                    my: e.clientY - rect.top,
                  })
                }}
              />
            ))}

            {projects.length === 0 && (
              <text x={W / 2} y={H / 2} textAnchor="middle" fontSize={13} fill="#334155" fontFamily="monospace">No projects in fleet.</text>
            )}
          </svg>

          {tooltip && (
            <div
              className="absolute z-10 pointer-events-none rounded border text-xs font-mono px-3 py-2 shadow-xl"
              style={{
                left: Math.min(tooltip.mx + 14, W - 200),
                top: Math.max(0, tooltip.my - 8),
                background: '#0f1e35',
                borderColor: STATE_COLOR[tooltip.project.state] ?? '#334155',
                color: '#E2E8F0',
                minWidth: 170,
              }}
            >
              <div style={{ color: STATE_COLOR[tooltip.project.state], fontWeight: 700, marginBottom: 4 }}>
                {tooltip.project.slug}
              </div>
              <div>State: {tooltip.project.state}</div>
              <div>Age: {fmtAge(tooltip.project.ageMins)}</div>
              {tooltip.project.convergenceScore != null
                ? <div>Convergence: {(tooltip.project.convergenceScore * 100).toFixed(1)}%</div>
                : <div style={{ color: '#475569' }}>Convergence: —</div>
              }
              {tooltip.project.contextUsagePct != null
                ? <div>Context: {Math.round(tooltip.project.contextUsagePct)}%</div>
                : <div style={{ color: '#475569' }}>Context: —</div>
              }
            </div>
          )}
        </div>
      )}

      {!loading && (
        <div className="mt-3 text-xs font-mono text-slate-600">
          {projects.length} projects · size = age (8–16px over 0–90 days) · missing convergence/context plotted at origin (50% opacity)
        </div>
      )}
    </div>
  )
}
