'use client'

import { useEffect, useState, useCallback } from 'react'
import SubPageHeader from '../../components/SubPageHeader'
import type { HealthScorecardResponse, ProjectHealth, ScoreBreakdown } from '../api/health-scorecard/route'

type SortKey = 'score' | 'slug' | 'lastActive'

const BAND_COLOR = (score: number) =>
  score >= 70 ? '#22D3EE' : score >= 40 ? '#F59E0B' : '#EF4444'

const BAND_LABEL = (score: number) =>
  score >= 70 ? 'Healthy' : score >= 40 ? 'At Risk' : 'Critical'

function ArcGauge({ score, size = 80 }: { score: number; size?: number }) {
  const cx = size / 2
  const cy = size / 2
  const r = size * 0.38
  const stroke = size * 0.1

  // Arc: 220° sweep from -200° to +40°
  const startAngle = (-200 * Math.PI) / 180
  const totalAngle = (220 * Math.PI) / 180
  const fillAngle = totalAngle * (score / 100)

  function arcPath(start: number, sweep: number) {
    const ex = cx + Math.cos(start + sweep) * r
    const ey = cy + Math.sin(start + sweep) * r
    const sx = cx + Math.cos(start) * r
    const sy = cy + Math.sin(start) * r
    const large = sweep > Math.PI ? 1 : 0
    return `M${sx.toFixed(2)},${sy.toFixed(2)} A${r},${r} 0 ${large},1 ${ex.toFixed(2)},${ey.toFixed(2)}`
  }

  const color = BAND_COLOR(score)

  return (
    <svg width={size} height={size} className="block">
      {/* Track */}
      <path
        d={arcPath(startAngle, totalAngle)}
        fill="none"
        stroke="rgba(255,255,255,0.08)"
        strokeWidth={stroke}
        strokeLinecap="round"
      />
      {/* Fill */}
      {score > 0 && (
        <path
          d={arcPath(startAngle, fillAngle)}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          style={{ filter: `drop-shadow(0 0 4px ${color}88)` }}
        />
      )}
      {/* Score label */}
      <text
        x={cx}
        y={cy - 2}
        textAnchor="middle"
        dominantBaseline="middle"
        fill={color}
        fontSize={size * 0.22}
        fontFamily="monospace"
        fontWeight="bold"
      >
        {score}
      </text>
      <text
        x={cx}
        y={cy + size * 0.14}
        textAnchor="middle"
        dominantBaseline="middle"
        fill={color}
        fontSize={size * 0.1}
        fontFamily="monospace"
        opacity={0.7}
      >
        /100
      </text>
    </svg>
  )
}

function BreakdownRow({ label, value, max }: { label: string; value: number; max: number }) {
  const pct = max > 0 ? (value / max) * 100 : 0
  return (
    <div className="flex items-center gap-2">
      <span className="font-mono text-[0.55rem] text-slate-500 w-20 shrink-0">{label}</span>
      <div className="flex-1 h-1 rounded-full bg-white/5">
        <div
          className="h-full rounded-full"
          style={{ width: `${pct}%`, background: '#22D3EE', opacity: 0.7 }}
        />
      </div>
      <span className="font-mono text-[0.55rem] text-slate-400 w-6 text-right">{value}</span>
    </div>
  )
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-center py-0.5">
      <span className="font-mono text-[0.55rem] text-slate-600">{label}</span>
      <span className="font-mono text-[0.6rem] text-slate-300">{value}</span>
    </div>
  )
}

function ProjectCard({ project }: { project: ProjectHealth }) {
  const [hovered, setHovered] = useState(false)
  const color = BAND_COLOR(project.score)
  const lastActiveStr = project.lastActiveDaysAgo === null
    ? 'never'
    : project.lastActiveDaysAgo < 1 ? 'today'
    : project.lastActiveDaysAgo < 2 ? 'yesterday'
    : `${Math.floor(project.lastActiveDaysAgo)}d ago`

  return (
    <div
      className="relative rounded-lg border transition-all duration-200 p-3 cursor-default"
      style={{
        background: hovered ? '#0d1829' : '#080f1c',
        borderColor: hovered ? `${color}40` : `${color}18`,
        boxShadow: hovered ? `0 0 16px ${color}22` : 'none',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Band badge */}
      <div
        className="absolute top-2 right-2 font-mono text-[0.5rem] px-1.5 py-0.5 rounded"
        style={{ background: `${color}18`, color }}
      >
        {BAND_LABEL(project.score)}
      </div>

      {/* Slug */}
      <div className="font-mono text-[0.65rem] text-slate-300 mb-2 pr-14 truncate">{project.slug}</div>

      {/* Arc gauge */}
      <div className="flex justify-center mb-2">
        <ArcGauge score={project.score} size={72} />
      </div>

      {/* Stats */}
      <div className="border-t border-white/5 pt-2 mt-1">
        <StatRow label="Memory files" value={String(project.memoryFiles)} />
        <StatRow label="Sessions" value={String(project.sessions)} />
        <StatRow label="Last active" value={lastActiveStr} />
        <StatRow label="Open proposals" value={String(project.openProposals)} />
        <StatRow label="Kills (7d)" value={String(project.recentKills)} />
      </div>

      {/* Breakdown (hover only) */}
      {hovered && (
        <div className="mt-2 border-t border-white/5 pt-2 space-y-1">
          <div className="font-mono text-[0.5rem] text-slate-600 mb-1.5 uppercase tracking-widest">Score breakdown</div>
          <BreakdownRow label="Memory" value={project.breakdown.memoryScore} max={25} />
          <BreakdownRow label="Activity" value={project.breakdown.activityScore} max={25} />
          <BreakdownRow label="Recency" value={project.breakdown.recencyScore} max={20} />
          <BreakdownRow label="Stability" value={project.breakdown.stabilityScore} max={20} />
          <BreakdownRow label="Proposals" value={project.breakdown.proposalScore} max={10} />
        </div>
      )}
    </div>
  )
}

export default function HealthScorecardPage() {
  const [data, setData] = useState<HealthScorecardResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [sortKey, setSortKey] = useState<SortKey>('score')

  const load = useCallback(() => {
    setLoading(true)
    fetch('/api/health-scorecard')
      .then((r) => r.json())
      .then((d) => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  const sorted = data
    ? [...data.projects].sort((a, b) => {
        if (sortKey === 'score') return b.score - a.score
        if (sortKey === 'slug') return a.slug.localeCompare(b.slug)
        // lastActive: null = never = worst
        const aD = a.lastActiveDaysAgo ?? 99999
        const bD = b.lastActiveDaysAgo ?? 99999
        return aD - bD
      })
    : []

  const healthy = data ? data.projects.filter((p) => p.score >= 70).length : 0
  const atRisk = data ? data.projects.filter((p) => p.score >= 40 && p.score < 70).length : 0
  const critical = data ? data.projects.filter((p) => p.score < 40).length : 0
  const avg = data && data.projects.length > 0
    ? Math.round(data.projects.reduce((s, p) => s + p.score, 0) / data.projects.length)
    : 0

  return (
    <div className="min-h-screen bg-[#050b15] text-slate-100">
      <SubPageHeader title="Project Health Scorecard" />

      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* Summary bar */}
        {data && (
          <div className="flex flex-wrap gap-4 mb-6">
            {[
              { label: 'Fleet avg', value: String(avg), color: BAND_COLOR(avg) },
              { label: 'Healthy ≥70', value: String(healthy), color: '#22D3EE' },
              { label: 'At risk 40–69', value: String(atRisk), color: '#F59E0B' },
              { label: 'Critical <40', value: String(critical), color: '#EF4444' },
              { label: 'Total projects', value: String(data.projects.length), color: '#64748B' },
            ].map(({ label, value, color }) => (
              <div
                key={label}
                className="rounded-lg border border-white/5 px-4 py-2 flex flex-col items-center gap-0.5"
                style={{ background: '#080f1c' }}
              >
                <span className="font-mono text-[0.55rem] text-slate-600 uppercase tracking-wider">{label}</span>
                <span className="font-mono text-lg font-bold" style={{ color }}>{value}</span>
              </div>
            ))}
          </div>
        )}

        {/* Sort controls */}
        {data && data.projects.length > 0 && (
          <div className="flex gap-2 mb-4">
            <span className="font-mono text-[0.55rem] text-slate-600 self-center">Sort:</span>
            {(['score', 'slug', 'lastActive'] as SortKey[]).map((k) => (
              <button
                key={k}
                onClick={() => setSortKey(k)}
                className="font-mono text-[0.6rem] px-2 py-1 rounded border transition-colors"
                style={{
                  background: sortKey === k ? '#22D3EE18' : 'transparent',
                  borderColor: sortKey === k ? '#22D3EE40' : '#ffffff18',
                  color: sortKey === k ? '#22D3EE' : '#64748B',
                }}
              >
                {k === 'score' ? 'Score' : k === 'slug' ? 'Name' : 'Last Active'}
              </button>
            ))}
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="font-mono text-slate-600 text-sm">Loading...</div>
        )}

        {/* Empty state */}
        {!loading && data && data.projects.length === 0 && (
          <div className="font-mono text-slate-600 text-sm">No projects found.</div>
        )}

        {/* Card grid */}
        {!loading && sorted.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
            {sorted.map((p) => (
              <ProjectCard key={p.slug} project={p} />
            ))}
          </div>
        )}

        {data && (
          <div className="mt-6 font-mono text-[0.5rem] text-slate-700">
            Generated {new Date(data.generatedAt).toLocaleString()}
          </div>
        )}
      </div>
    </div>
  )
}
