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

const CYCLE_DAYS = 90
const CYCLE_MINS = CYCLE_DAYS * 1440

function toRad(deg: number): number {
  return (deg - 90) * (Math.PI / 180)
}

function ageToAngleDeg(ageMins: number): number {
  return ((ageMins % CYCLE_MINS) / CYCLE_MINS) * 360
}

function fmtAge(mins: number): string {
  if (mins < 60) return `${Math.round(mins)}m`
  if (mins < 1440) return `${(mins / 60).toFixed(1)}h`
  return `${(mins / 1440).toFixed(1)}d`
}

interface TooltipData {
  project: FleetProject
  tx: number
  ty: number
}

export default function LifecycleClockPage() {
  const { data, isStale, lastError, lastSuccessAt } = useFreshness<FleetResponse>('/api/fleet', 60_000)
  const [tooltip, setTooltip] = useState<TooltipData | null>(null)

  const SIZE = 540
  const C = SIZE / 2
  const R = C - 40
  const MIN_LEN = R * 0.12

  const projects = data?.projects ?? []
  const loading = data === null && lastError === null

  const handData = useMemo(() => {
    return projects.map(p => {
      const angleDeg = ageToAngleDeg(p.ageMins)
      const rad = toRad(angleDeg)
      const lenFrac = Math.max(0.12, Math.min(1, (p.contextUsagePct ?? 5) / 100))
      const len = lenFrac * R
      return {
        project: p,
        angleDeg,
        rad,
        len,
        color: STATE_COLOR[p.state] ?? '#64748B',
        tx: C + Math.cos(rad) * len,
        ty: C + Math.sin(rad) * len,
      }
    })
  }, [projects, C, R])

  const totalProjects = projects.length
  const meanAgeMins = totalProjects > 0
    ? projects.reduce((s, p) => s + p.ageMins, 0) / totalProjects
    : 0
  const minAgeMins = totalProjects > 0 ? Math.min(...projects.map(p => p.ageMins)) : 0
  const maxAgeMins = totalProjects > 0 ? Math.max(...projects.map(p => p.ageMins)) : 0

  const ringDays = [30, 60, 90]

  return (
    <div className="min-h-screen p-4 md:p-6" style={{ background: '#080f1c', color: '#E2E8F0' }}>
      <SubPageHeader title="Project Lifecycle Clock">
        <FreshnessBadge isStale={isStale} lastError={lastError} lastSuccessAt={lastSuccessAt} />
      </SubPageHeader>

      <p className="text-xs text-slate-500 mb-4">
        Hand angle = project age mod 90 days (12 o'clock = just spawned). Hand length = context fill %. Color = state.
      </p>

      <div className="flex gap-4 mb-4 flex-wrap">
        {(Object.entries(STATE_COLOR) as [ProjectState, string][]).map(([state, color]) => (
          <div key={state} className="flex items-center gap-1.5 text-xs font-mono">
            <span style={{ width: 10, height: 10, background: color, borderRadius: 2, display: 'inline-block' }} />
            <span style={{ color }}>{state}</span>
          </div>
        ))}
      </div>

      {loading && (
        <div className="text-center py-20 text-slate-600 font-mono text-sm animate-pulse">Calibrating clock…</div>
      )}

      {!loading && (
        <div className="relative inline-block" onMouseLeave={() => setTooltip(null)}>
          <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} style={{ display: 'block' }}>
            {/* Outer ring */}
            <circle cx={C} cy={C} r={R} fill="none" stroke="#1E293B" strokeWidth={1} />

            {/* Concentric rings at 30/60/90 days */}
            {ringDays.map(days => {
              const ringR = (days / CYCLE_DAYS) * R
              return (
                <g key={days}>
                  <circle
                    cx={C} cy={C} r={ringR}
                    fill="none"
                    stroke="#1E293B"
                    strokeWidth={1}
                    strokeDasharray="4 6"
                  />
                  <text
                    x={C + ringR + 4}
                    y={C + 4}
                    fontSize={9}
                    fill="#334155"
                    fontFamily="monospace"
                  >
                    {days}d
                  </text>
                </g>
              )
            })}

            {/* Tick marks at 12/3/6/9 positions */}
            {[0, 90, 180, 270].map(deg => {
              const rad = toRad(deg)
              return (
                <line
                  key={deg}
                  x1={C + Math.cos(rad) * (R - 10)}
                  y1={C + Math.sin(rad) * (R - 10)}
                  x2={C + Math.cos(rad) * R}
                  y2={C + Math.sin(rad) * R}
                  stroke="#334155"
                  strokeWidth={2}
                />
              )
            })}

            {/* 12 o'clock label */}
            <text x={C} y={C - R - 8} textAnchor="middle" fontSize={9} fill="#475569" fontFamily="monospace">
              0d (spawn)
            </text>

            {/* Project hands */}
            {handData.map(({ project, rad, len, color, tx, ty }) => (
              <g key={project.slug}>
                <line
                  x1={C} y1={C}
                  x2={tx} y2={ty}
                  stroke={color}
                  strokeWidth={project.state === 'active' ? 2.5 : 1.5}
                  strokeLinecap="round"
                  opacity={0.85}
                />
                <circle
                  cx={tx} cy={ty}
                  r={5}
                  fill={color}
                  stroke="#080f1c"
                  strokeWidth={1}
                  style={{ cursor: 'pointer' }}
                  onMouseMove={e => {
                    const svg = (e.target as SVGElement).ownerSVGElement!
                    const rect = svg.getBoundingClientRect()
                    setTooltip({
                      project,
                      tx: e.clientX - rect.left,
                      ty: e.clientY - rect.top,
                    })
                  }}
                />
              </g>
            ))}

            {/* Center dot */}
            <circle cx={C} cy={C} r={4} fill="#334155" />
          </svg>

          {tooltip && (
            <div
              className="absolute z-10 pointer-events-none rounded border text-xs font-mono px-3 py-2 shadow-xl"
              style={{
                left: Math.min(tooltip.tx + 12, SIZE - 180),
                top: Math.max(0, tooltip.ty - 8),
                background: '#0f1e35',
                borderColor: STATE_COLOR[tooltip.project.state] ?? '#334155',
                color: '#E2E8F0',
                minWidth: 160,
              }}
            >
              <div style={{ color: STATE_COLOR[tooltip.project.state], fontWeight: 700, marginBottom: 4 }}>
                {tooltip.project.slug}
              </div>
              <div>State: {tooltip.project.state}</div>
              <div>Age: {fmtAge(tooltip.project.ageMins)}</div>
              {tooltip.project.contextUsagePct != null && (
                <div>Context: {Math.round(tooltip.project.contextUsagePct)}%</div>
              )}
              {tooltip.project.convergenceScore != null && (
                <div>Conv: {Math.round(tooltip.project.convergenceScore * 100)}%</div>
              )}
            </div>
          )}
        </div>
      )}

      {!loading && (
        <div className="mt-4 flex gap-6 text-xs font-mono text-slate-500 flex-wrap">
          <span>{totalProjects} projects</span>
          {totalProjects > 0 && (
            <>
              <span>Mean age: {fmtAge(meanAgeMins)}</span>
              <span>Youngest: {fmtAge(minAgeMins)}</span>
              <span>Oldest: {fmtAge(maxAgeMins)}</span>
            </>
          )}
          {totalProjects === 0 && <span>No projects in fleet.</span>}
        </div>
      )}
    </div>
  )
}
