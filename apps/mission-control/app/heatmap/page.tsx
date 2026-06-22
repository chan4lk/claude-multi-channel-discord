'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import type { FleetDensityHeatmapResponse, ProjectDensity } from '../api/fleet-density-heatmap/route'

const HOURS = Array.from({ length: 24 }, (_, i) => i)

function HeatmapRow({ project, p75Threshold }: { project: ProjectDensity; p75Threshold: number }) {
  const maxVal = Math.max(...project.hourly, 1)
  return (
    <tr className="border-b border-cyber-cyan/6 group">
      <td className="py-1.5 pr-3 w-28">
        <span className="text-[0.65rem] font-mono text-cyber-cyan truncate block" title={project.slug}>
          {project.slug}
        </span>
      </td>
      {project.hourly.map((val, hour) => {
        const intensity = val / maxVal
        const isPulsing = val >= p75Threshold && val > 0
        const alpha = val === 0 ? 0.05 : 0.12 + intensity * 0.88
        return (
          <td key={hour} className="py-1 px-0.5" style={{ width: 24 }}>
            <div
              title={`${project.slug} · ${hour}:00 UTC · ${val} turn${val !== 1 ? 's' : ''}`}
              className={isPulsing ? 'animate-pulse' : ''}
              style={{
                height: 18,
                borderRadius: 2,
                background: val === 0
                  ? 'rgba(255,255,255,0.04)'
                  : isPulsing
                    ? `rgba(245,158,11,${alpha.toFixed(2)})`
                    : `rgba(0,245,255,${alpha.toFixed(2)})`,
              }}
            />
          </td>
        )
      })}
      <td className="py-1 pl-2 text-right">
        <span className="text-[0.55rem] font-mono text-slate-500">{project.total}</span>
      </td>
    </tr>
  )
}

function p75(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const idx = Math.floor(sorted.length * 0.75)
  return sorted[idx] ?? 0
}

export default function HeatmapPage() {
  const [data, setData] = useState<FleetDensityHeatmapResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [stale, setStale] = useState(false)

  const load = useCallback(() => {
    setStale(false)
    fetch('/api/fleet-density-heatmap')
      .then((r) => r.json())
      .then((d: FleetDensityHeatmapResponse) => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  useEffect(() => {
    load()
    const id = setInterval(() => { setStale(true); load() }, 30_000)
    return () => clearInterval(id)
  }, [load])

  const projects = data?.projects ?? []
  const sortedProjects = [...projects].sort((a, b) => b.total - a.total)

  const allValues = projects.flatMap((p) => p.hourly).filter((v) => v > 0)
  const threshold = p75(allValues)

  return (
    <div className="min-h-dvh flex flex-col" style={{ background: '#060d1a' }}>
      <header className="relative border-b border-cyber-cyan/12 bg-cyber-surface/70 backdrop-blur-md px-6 py-3">
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-cyber-cyan/40 to-transparent" />
        <div className="flex items-center gap-4">
          <Link href="/" className="text-[0.6rem] font-mono text-slate-500 hover:text-cyber-cyan transition-colors uppercase tracking-wider">
            ← Dashboard
          </Link>
          <h1 className="text-lg font-black tracking-[0.18em] text-cyber-cyan" style={{ fontFamily: 'Orbitron, JetBrains Mono, monospace' }}>
            TURN DENSITY HEATMAP
          </h1>
          {stale && (
            <span className="text-[0.55rem] font-mono text-amber-400 border border-amber-400/30 px-1.5 py-0.5 rounded">REFRESHING…</span>
          )}
          <div className="flex-1" />
          <button
            onClick={load}
            className="text-[0.6rem] font-mono text-slate-500 hover:text-cyber-cyan transition-colors uppercase tracking-wider border border-slate-700 hover:border-cyber-cyan/30 px-2 py-1 rounded"
          >
            Refresh
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-auto p-6">
        <div className="max-w-6xl mx-auto space-y-6">
          {/* Legend */}
          <div className="flex items-center gap-6 text-[0.6rem] font-mono text-slate-500">
            <span>Rows = projects · Cols = hours (UTC) · Last 7 days</span>
            <div className="flex items-center gap-2">
              <div className="w-4 h-3 rounded-sm" style={{ background: 'rgba(0,245,255,0.15)' }} />
              <span>low</span>
              <div className="w-4 h-3 rounded-sm" style={{ background: 'rgba(0,245,255,0.7)' }} />
              <span>high</span>
              <div className="w-4 h-3 rounded-sm animate-pulse" style={{ background: 'rgba(245,158,11,0.7)' }} />
              <span>≥ p75 (amber pulse)</span>
            </div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center h-64">
              <div className="text-xs font-mono text-slate-600 animate-pulse">Loading heatmap…</div>
            </div>
          ) : projects.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 gap-3 text-slate-600">
              <div className="text-4xl opacity-20">◎</div>
              <span className="text-xs font-mono">No project data available</span>
            </div>
          ) : (
            <div className="rounded-lg border border-cyber-cyan/12 overflow-x-auto" style={{ background: 'rgba(0,245,255,0.02)' }}>
              <table className="w-full border-collapse" style={{ minWidth: 720 }}>
                <thead>
                  <tr className="border-b border-cyber-cyan/12" style={{ background: 'rgba(0,245,255,0.04)' }}>
                    <th className="py-2 pr-3 text-left w-28">
                      <span className="text-[0.55rem] font-mono text-slate-500 uppercase tracking-wider">Project</span>
                    </th>
                    {HOURS.map((h) => (
                      <th key={h} className="py-2 text-center" style={{ width: 24 }}>
                        <span
                          className="text-[0.45rem] font-mono"
                          style={{ color: h % 6 === 0 ? '#64748b' : '#1e293b' }}
                        >
                          {h}
                        </span>
                      </th>
                    ))}
                    <th className="py-2 pl-2 text-right">
                      <span className="text-[0.55rem] font-mono text-slate-500 uppercase tracking-wider">Total</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sortedProjects.map((p) => (
                    <HeatmapRow key={p.slug} project={p} p75Threshold={threshold} />
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {data && (
            <p className="text-[0.5rem] font-mono text-slate-700">
              {projects.length} projects · Refreshes every 30s · Generated {new Date(data.generatedAt).toLocaleTimeString()}
            </p>
          )}
        </div>
      </main>
    </div>
  )
}
