'use client'

import { useEffect, useState } from 'react'
import SubPageHeader from '../../components/SubPageHeader'
import type { MemoryRadarResponse, MemoryRadarProject, MemoryType } from '../api/memory-radar/route'

const TYPES: MemoryType[] = ['user', 'feedback', 'project', 'reference']
const LABELS = ['User', 'Feedback', 'Project', 'Reference']

// 4-axis radar: axes at 45°, 135°, 225°, 315° (top-right, top-left, bottom-left, bottom-right)
const ANGLES = [315, 45, 135, 225].map((deg) => (deg * Math.PI) / 180)

function radarPoint(value: number, max: number, angle: number, r: number, cx: number, cy: number) {
  const ratio = max > 0 ? value / max : 0
  return {
    x: cx + Math.cos(angle) * ratio * r,
    y: cy + Math.sin(angle) * ratio * r,
  }
}

function RadarChart({
  project,
  maxCounts,
  maxWords,
  size = 60,
}: {
  project: MemoryRadarProject
  maxCounts: Record<MemoryType, number>
  maxWords: Record<MemoryType, number>
  size?: number
}) {
  const cx = size / 2
  const cy = size / 2
  const r = size * 0.38

  // Grid rings
  const rings = [0.33, 0.67, 1.0]

  // Count polygon
  const countPts = TYPES.map((t, i) =>
    radarPoint(project.typeCounts[t], maxCounts[t] || 1, ANGLES[i]!, r, cx, cy)
  )
  const countPath = countPts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ') + ' Z'

  // Words polygon
  const wordPts = TYPES.map((t, i) =>
    radarPoint(project.typeWords[t], maxWords[t] || 1, ANGLES[i]!, r, cx, cy)
  )
  const wordPath = wordPts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ') + ' Z'

  // Axis endpoints
  const axisEnds = ANGLES.map((a) => ({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r }))

  return (
    <svg width={size} height={size} className="block overflow-visible">
      {/* Grid rings */}
      {rings.map((f, ri) => {
        const pts = ANGLES.map((a) => ({
          x: cx + Math.cos(a) * r * f,
          y: cy + Math.sin(a) * r * f,
        }))
        const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ') + ' Z'
        return <path key={ri} d={d} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={0.5} />
      })}

      {/* Axes */}
      {axisEnds.map((end, i) => (
        <line key={i} x1={cx} y1={cy} x2={end.x} y2={end.y} stroke="rgba(255,255,255,0.08)" strokeWidth={0.5} />
      ))}

      {/* Axis labels */}
      {ANGLES.map((a, i) => {
        const lx = cx + Math.cos(a) * (r + 8)
        const ly = cy + Math.sin(a) * (r + 8)
        return (
          <text key={i} x={lx.toFixed(1)} y={ly.toFixed(1)}
            textAnchor="middle" dominantBaseline="middle"
            fill="#334155" fontSize="0.32rem" fontFamily="monospace">
            {LABELS[i]!.slice(0, 4)}
          </text>
        )
      })}

      {/* Word density polygon (amber outline) */}
      <path d={wordPath} fill="rgba(245,158,11,0.1)" stroke="#F59E0B" strokeWidth={1} opacity={0.7} />

      {/* Count polygon (cyan fill) */}
      <path d={countPath} fill="rgba(34,211,238,0.2)" stroke="#22D3EE" strokeWidth={1} opacity={0.85} />

      {/* Center dot */}
      <circle cx={cx} cy={cy} r={1.5} fill="rgba(255,255,255,0.2)" />
    </svg>
  )
}

interface EnlargedState { project: MemoryRadarProject; x: number; y: number }

export default function MemoryRadarPage() {
  const [data, setData] = useState<MemoryRadarResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [enlarged, setEnlarged] = useState<EnlargedState | null>(null)

  useEffect(() => {
    fetch('/api/memory-radar')
      .then((r) => r.json())
      .then((d: MemoryRadarResponse) => { setData(d); setLoading(false) })
      .catch((e) => { setError(String(e)); setLoading(false) })
  }, [])

  const projects = data?.projects ?? []

  // Global maxes across all projects per type
  const maxCounts = Object.fromEntries(
    TYPES.map((t) => [t, Math.max(1, ...projects.map((p) => p.typeCounts[t]))])
  ) as Record<MemoryType, number>
  const maxWords = Object.fromEntries(
    TYPES.map((t) => [t, Math.max(1, ...projects.map((p) => p.typeWords[t]))])
  ) as Record<MemoryType, number>

  return (
    <div className="min-h-screen p-4 md:p-6" style={{ background: '#080f1c', color: '#E2E8F0' }}>
      <SubPageHeader title="Memory Type Ratio Radar">
        <span className="text-[0.6rem] font-mono text-slate-500">
          Per-project memory file composition · 4-axis radar by type
        </span>
      </SubPageHeader>

      {loading && <div className="text-center py-20 text-slate-600 font-mono text-sm">Loading…</div>}
      {error && <div className="text-center py-20 text-red-500 font-mono text-sm">{error}</div>}

      {!loading && !error && (
        <div className="max-w-5xl mx-auto">
          {/* Legend */}
          <div className="flex items-center gap-5 mb-5 text-[0.5rem] font-mono text-slate-500">
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-0.5" style={{ background: '#22D3EE' }} />
              File count (filled cyan)
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-0.5" style={{ background: '#F59E0B' }} />
              Word density (outlined amber)
            </span>
            <span className="text-slate-600">· Axes: User / Feedback / Project / Reference</span>
          </div>

          {projects.length === 0 ? (
            <div className="text-center py-20 text-slate-600 font-mono text-sm">No projects with memory files found</div>
          ) : (
            <div className="grid grid-cols-4 sm:grid-cols-5 gap-4">
              {projects.map((p) => (
                <div
                  key={p.slug}
                  className="flex flex-col items-center gap-1 cursor-pointer hover:bg-white/5 rounded-lg p-2 transition-colors"
                  onClick={(e) => {
                    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect()
                    setEnlarged({ project: p, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 })
                  }}
                >
                  <RadarChart project={p} maxCounts={maxCounts} maxWords={maxWords} size={72} />
                  <span className="text-[0.42rem] font-mono text-slate-500 text-center truncate w-full text-center">
                    {p.slug.length > 12 ? p.slug.slice(0, 11) + '…' : p.slug}
                  </span>
                  <span className="text-[0.38rem] font-mono text-slate-700">{p.totalFiles} files</span>
                </div>
              ))}
            </div>
          )}

          {data && (
            <div className="text-[0.5rem] font-mono text-slate-700 text-right mt-4">
              Generated {new Date(data.generatedAt).toLocaleString()}
            </div>
          )}
        </div>
      )}

      {/* Enlarged overlay */}
      {enlarged && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}
          onClick={() => setEnlarged(null)}
        >
          <div
            className="rounded-xl border border-white/10 p-6"
            style={{ background: 'rgba(8,15,28,0.98)', minWidth: 280 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-[0.65rem] font-mono text-slate-300 mb-4 text-center">{enlarged.project.slug}</div>
            <div className="flex justify-center mb-4">
              <RadarChart project={enlarged.project} maxCounts={maxCounts} maxWords={maxWords} size={180} />
            </div>
            <div className="grid grid-cols-2 gap-2 text-[0.5rem] font-mono">
              {TYPES.map((t, i) => (
                <div key={t} className="flex flex-col gap-0.5 bg-white/5 rounded p-2">
                  <span className="text-slate-400 capitalize">{LABELS[i]}</span>
                  <span className="text-cyan-400">{enlarged.project.typeCounts[t]} files</span>
                  <span className="text-amber-400">{enlarged.project.typeWords[t]} words</span>
                </div>
              ))}
            </div>
            <div className="text-[0.45rem] font-mono text-slate-600 text-center mt-3">click outside to close</div>
          </div>
        </div>
      )}
    </div>
  )
}
