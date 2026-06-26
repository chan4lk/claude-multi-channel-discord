'use client'

import { useState } from 'react'
import Link from 'next/link'
import SubPageHeader from '../../components/SubPageHeader'
import { useFreshness } from '../../lib/useFreshness'
import type { AttentionGravityResponse, GravityProject } from '../api/attention-gravity/route'

const SVG_SIZE = 600
const CENTER = SVG_SIZE / 2

// Orbit radii by attention tier
const RING_CONFIG = [
  { label: 'CRITICAL', minScore: 80, radius: 70,  strokeColor: '#ef4444', strokeDash: '6 3' },
  { label: 'ELEVATED', minScore: 60, radius: 120, strokeColor: '#f59e0b', strokeDash: '5 4' },
  { label: 'NOMINAL',  minScore: 30, radius: 180, strokeColor: '#22d3ee', strokeDash: '4 5' },
  { label: 'QUIET',    minScore: 0,  radius: 240, strokeColor: '#475569', strokeDash: '3 6' },
]

function getRing(score: number) {
  for (const ring of RING_CONFIG) {
    if (score >= ring.minScore) return ring
  }
  return RING_CONFIG[RING_CONFIG.length - 1]
}

function stateColor(state: GravityProject['state']): string {
  switch (state) {
    case 'active':       return '#00F5FF'
    case 'idle':         return '#475569'
    case 'stuck':        return '#f59e0b'
    case 'circuit-open': return '#ef4444'
  }
}

function stateBadgeStyle(state: GravityProject['state']): React.CSSProperties {
  const color = stateColor(state)
  return {
    background: `${color}22`,
    border: `1px solid ${color}55`,
    color,
    borderRadius: 4,
    padding: '1px 6px',
    fontSize: '0.6rem',
    fontFamily: 'monospace',
    fontWeight: 700,
    letterSpacing: '0.05em',
    textTransform: 'uppercase' as const,
  }
}

function SidePanel({
  project,
  onClose,
}: {
  project: GravityProject
  onClose: () => void
}) {
  return (
    <div
      className="fixed inset-y-0 right-0 z-50 w-80 sm:w-96 border-l border-cyber-cyan/20 bg-cyber-surface/95 backdrop-blur-xl flex flex-col shadow-2xl"
      style={{ boxShadow: '-10px 0 40px rgba(0,245,255,0.05)' }}
    >
      <div className="flex items-center gap-2 px-4 py-3 border-b border-white/5">
        <span className="text-xs font-mono font-bold text-cyber-cyan flex-1 truncate">
          {project.slug}
        </span>
        <button
          onClick={onClose}
          className="text-slate-500 hover:text-slate-300 text-sm font-mono px-2 py-1"
        >
          ✕
        </button>
      </div>

      <div className="p-4 flex flex-col gap-4 overflow-y-auto flex-1">
        {/* State + score */}
        <div className="rounded-lg border border-white/5 bg-cyber-surface/40 p-4 flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span style={stateBadgeStyle(project.state)}>{project.state}</span>
            <span className="text-[0.6rem] font-mono text-slate-500">{project.platform}</span>
          </div>
          <div
            className="text-5xl font-bold font-mono tabular-nums text-center py-2"
            style={{ color: stateColor(project.state) }}
          >
            {project.attentionScore}
          </div>
          <div className="text-[0.6rem] font-mono text-slate-500 text-center uppercase tracking-wider">
            attention score
          </div>
          <div className="text-[0.6rem] font-mono text-center" style={{ color: '#94a3b8' }}>
            {project.reason}
          </div>
        </div>

        {/* Factor breakdown */}
        <div className="rounded-lg border border-white/5 bg-cyber-surface/40 p-3 flex flex-col gap-3">
          <div className="text-[0.6rem] font-mono uppercase tracking-wider text-slate-500 mb-1">
            Factor Breakdown
          </div>
          {project.factors.map((f) => (
            <div key={f.key} className="flex flex-col gap-1">
              <div className="flex items-center justify-between">
                <span className="text-[0.6rem] font-mono text-slate-400">{f.label}</span>
                <span className="text-[0.6rem] font-mono tabular-nums" style={{ color: f.color }}>
                  {f.score}
                </span>
              </div>
              <div className="h-1.5 rounded-full overflow-hidden" style={{ background: '#1e293b' }}>
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${f.score}%`, background: f.color }}
                />
              </div>
            </div>
          ))}
        </div>

        {/* Queue info */}
        {project.queuedCount > 0 && (
          <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
            <div className="text-[0.6rem] font-mono text-amber-400">
              {project.queuedCount} message{project.queuedCount !== 1 ? 's' : ''} queued
            </div>
          </div>
        )}

        {/* Nav links */}
        <div className="flex flex-col gap-2 mt-auto">
          <Link
            href="/"
            className="text-[0.65rem] font-mono text-cyber-cyan hover:underline px-3 py-2 rounded border border-cyber-cyan/20 hover:border-cyber-cyan/40 transition-colors text-center"
          >
            → Fleet Detail
          </Link>
          <Link
            href="/advisor"
            className="text-[0.65rem] font-mono text-violet-400 hover:underline px-3 py-2 rounded border border-violet-500/20 hover:border-violet-500/40 transition-colors text-center"
          >
            → Advisor
          </Link>
        </div>
      </div>
    </div>
  )
}

// Group projects by ring
function groupByRing(projects: GravityProject[]): Map<number, GravityProject[]> {
  const map = new Map<number, GravityProject[]>()
  for (const ring of RING_CONFIG) {
    map.set(ring.radius, [])
  }
  for (const p of projects) {
    const ring = getRing(p.attentionScore)
    const arr = map.get(ring.radius) ?? []
    arr.push(p)
    map.set(ring.radius, arr)
  }
  return map
}

export default function AttentionGravityPage() {
  const { data, isStale, lastError } = useFreshness<AttentionGravityResponse>(
    '/api/attention-gravity',
    30_000,
  )
  const [selected, setSelected] = useState<string | null>(null)

  const projects = data?.projects ?? []
  const ringGroups = groupByRing(projects)
  const selectedProject = projects.find((p) => p.slug === selected) ?? null

  // Build SVG node positions
  type NodePos = { project: GravityProject; cx: number; cy: number; r: number }
  const nodes: NodePos[] = []

  for (const ring of RING_CONFIG) {
    const ringProjects = ringGroups.get(ring.radius) ?? []
    const count = ringProjects.length
    ringProjects.forEach((p, i) => {
      const angle = (i / Math.max(count, 1)) * 2 * Math.PI - Math.PI / 2
      nodes.push({
        project: p,
        cx: CENTER + ring.radius * Math.cos(angle),
        cy: CENTER + ring.radius * Math.sin(angle),
        r: Math.min(8 + (p.queuedCount ?? 0) * 2, 18),
      })
    })
  }

  return (
    <div className="min-h-screen bg-cyber-bg text-slate-200 flex flex-col">
      <style>{`
        @keyframes orbit-slow { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes orbit-med  { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes orbit-fast { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes orbit-vslow{ from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes core-pulse {
          0%, 100% { r: 16; opacity: 0.6; }
          50%       { r: 22; opacity: 1; }
        }
        .orbit-ring-0 { animation: orbit-vslow 60s linear infinite; transform-origin: ${CENTER}px ${CENTER}px; }
        .orbit-ring-1 { animation: orbit-slow  45s linear infinite; transform-origin: ${CENTER}px ${CENTER}px; }
        .orbit-ring-2 { animation: orbit-med   30s linear infinite; transform-origin: ${CENTER}px ${CENTER}px; }
        .orbit-ring-3 { animation: orbit-fast  18s linear infinite; transform-origin: ${CENTER}px ${CENTER}px; }
      `}</style>

      <SubPageHeader title="ATTENTION GRAVITY WELL" />

      <div className="flex-1 p-4 sm:p-6 flex flex-col items-center gap-4">
        {/* Status bar */}
        <div className="w-full max-w-3xl flex items-center gap-3 text-[0.55rem] font-mono text-slate-500">
          {isStale && (
            <span className="text-amber-400 animate-pulse">STALE</span>
          )}
          {lastError && (
            <span className="text-red-400">ERR: {lastError}</span>
          )}
          {data && (
            <span className="ml-auto">
              refreshed {new Date(data.generatedAt).toLocaleTimeString()} · {projects.length} project{projects.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>

        {/* Empty state */}
        {projects.length === 0 && !lastError && (
          <div className="text-center py-20 text-slate-600 text-sm font-mono rounded-xl border border-white/5 bg-cyber-surface/40 w-full max-w-3xl">
            No projects found.
          </div>
        )}

        {/* SVG gravity well */}
        {projects.length > 0 && (
          <div className="relative flex justify-center">
            <svg
              width={SVG_SIZE}
              height={SVG_SIZE}
              viewBox={`0 0 ${SVG_SIZE} ${SVG_SIZE}`}
              style={{ maxWidth: '100%', height: 'auto' }}
            >
              {/* Orbit rings (static dashed circles) */}
              {RING_CONFIG.map((ring, i) => (
                <g key={ring.radius}>
                  <circle
                    cx={CENTER}
                    cy={CENTER}
                    r={ring.radius}
                    fill="none"
                    stroke={ring.strokeColor}
                    strokeWidth={1}
                    strokeDasharray={ring.strokeDash}
                    opacity={0.35}
                  />
                  {/* Ring label at top */}
                  <text
                    x={CENTER}
                    y={CENTER - ring.radius - 6}
                    textAnchor="middle"
                    fontSize="9"
                    fontFamily="monospace"
                    fill={ring.strokeColor}
                    opacity={0.7}
                    letterSpacing="1"
                  >
                    {ring.label}
                  </text>
                </g>
              ))}

              {/* Attention core — pulsing circle */}
              <circle
                cx={CENTER}
                cy={CENTER}
                r={18}
                fill="#00F5FF"
                opacity={0.15}
              />
              <circle
                cx={CENTER}
                cy={CENTER}
                r={10}
                fill="#00F5FF"
                opacity={0.5}
                style={{ animation: 'core-pulse 2s ease-in-out infinite' }}
              />
              <text
                x={CENTER}
                y={CENTER + 28}
                textAnchor="middle"
                fontSize="8"
                fontFamily="monospace"
                fill="#00F5FF"
                opacity={0.6}
                letterSpacing="0.5"
              >
                CORE
              </text>

              {/* Rotating orbit groups for each ring */}
              {RING_CONFIG.map((ring, ringIdx) => {
                const ringProjects = ringGroups.get(ring.radius) ?? []
                const count = ringProjects.length
                if (count === 0) return null
                return (
                  <g key={ring.radius} className={`orbit-ring-${ringIdx}`}>
                    {ringProjects.map((p, i) => {
                      const angle = (i / Math.max(count, 1)) * 2 * Math.PI - Math.PI / 2
                      const cx = CENTER + ring.radius * Math.cos(angle)
                      const cy = CENTER + ring.radius * Math.sin(angle)
                      const r = Math.min(8 + (p.queuedCount ?? 0) * 2, 18)
                      const color = stateColor(p.state)
                      const isSelected = selected === p.slug
                      const label = p.slug.slice(0, 8)

                      return (
                        <g
                          key={p.slug}
                          style={{ cursor: 'pointer' }}
                          onClick={() => setSelected(isSelected ? null : p.slug)}
                        >
                          {/* Glow halo for high-attention */}
                          {p.attentionScore >= 60 && (
                            <circle
                              cx={cx}
                              cy={cy}
                              r={r + 5}
                              fill={color}
                              opacity={0.15}
                            />
                          )}
                          <circle
                            cx={cx}
                            cy={cy}
                            r={r}
                            fill={color}
                            opacity={isSelected ? 0.95 : 0.75}
                            stroke={isSelected ? '#ffffff' : color}
                            strokeWidth={isSelected ? 2 : 0.5}
                          />
                          <text
                            x={cx}
                            y={cy + 3}
                            textAnchor="middle"
                            fontSize="7"
                            fontFamily="monospace"
                            fill={r > 12 ? '#0f172a' : '#e2e8f0'}
                            fontWeight="bold"
                            style={{ pointerEvents: 'none', userSelect: 'none' }}
                          >
                            {label}
                          </text>
                        </g>
                      )
                    })}
                  </g>
                )
              })}
            </svg>
          </div>
        )}

        {/* Legend */}
        <div className="flex flex-wrap items-center gap-4 text-[0.55rem] font-mono text-slate-500 max-w-3xl w-full">
          {((['active', 'idle', 'stuck', 'circuit-open'] as const)).map((s) => (
            <span key={s} className="flex items-center gap-1.5">
              <span
                style={{
                  display: 'inline-block',
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: stateColor(s),
                }}
              />
              {s}
            </span>
          ))}
          <span className="ml-auto text-slate-600">circle size = queue depth · click = detail</span>
        </div>
      </div>

      {/* Side panel overlay */}
      {selected && selectedProject && (
        <>
          <div
            className="fixed inset-0 z-40"
            style={{ background: 'rgba(0,0,0,0.4)' }}
            onClick={() => setSelected(null)}
          />
          <SidePanel
            project={selectedProject}
            onClose={() => setSelected(null)}
          />
        </>
      )}
    </div>
  )
}
