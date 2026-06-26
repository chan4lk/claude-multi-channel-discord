'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import SubPageHeader from '../../components/SubPageHeader'
import type { VelocityWallResponse, VelocityProject } from '../api/velocity-wall/route'

const TREND_COLOR: Record<string, string> = {
  rising: '#22D3EE',
  falling: '#F59E0B',
  flat: '#64748B',
}

const TREND_LABEL: Record<string, string> = {
  rising: '↑ rising',
  falling: '↓ falling',
  flat: '→ flat',
}

const W = 80
const H = 30

function Sparkline({
  daily,
  trend,
  onClick,
}: {
  daily: { date: string; count: number }[]
  trend: string
  onClick: () => void
}) {
  const max = Math.max(...daily.map((d) => d.count), 1)
  const color = TREND_COLOR[trend] ?? '#64748B'
  const pts = daily
    .map((d, i) => {
      const x = (i / (daily.length - 1)) * (W - 2) + 1
      const y = H - 2 - ((d.count / max) * (H - 4))
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')

  return (
    <svg
      width={W}
      height={H}
      className="cursor-pointer block"
      onClick={onClick}
      style={{ filter: `drop-shadow(0 0 3px ${color}66)` }}
    >
      <polyline
        points={pts}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  )
}

function ExpandedModal({
  project,
  onClose,
}: {
  project: VelocityProject
  onClose: () => void
}) {
  const color = TREND_COLOR[project.trend] ?? '#64748B'
  const max = Math.max(...project.daily.map((d) => d.count), 1)
  const MW = 400
  const MH = 120

  const pts = project.daily
    .map((d, i) => {
      const x = (i / (project.daily.length - 1)) * (MW - 20) + 10
      const y = MH - 10 - ((d.count / max) * (MH - 20))
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={onClose}
    >
      <div
        className="bg-slate-900 border border-white/10 rounded-xl p-6 shadow-2xl w-[480px]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-4">
          <div>
            <span className="font-mono text-sm text-white">{project.slug}</span>
            <span
              className="ml-2 font-mono text-xs"
              style={{ color }}
            >
              {TREND_LABEL[project.trend]}
            </span>
          </div>
          <button
            className="font-mono text-slate-500 hover:text-white text-sm"
            onClick={onClose}
          >
            ✕
          </button>
        </div>
        <svg width={MW} height={MH} className="block">
          <polyline
            points={pts}
            fill="none"
            stroke={color}
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        </svg>
        <div className="mt-3 flex justify-between font-mono text-[0.6rem] text-slate-500">
          <span>{project.daily[0]?.date}</span>
          <span>30d total: {project.daily.reduce((s, d) => s + d.count, 0)}</span>
          <span>{project.daily[project.daily.length - 1]?.date}</span>
        </div>
      </div>
    </div>
  )
}

export default function VelocityWallPage() {
  const [data, setData] = useState<VelocityWallResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<VelocityProject | null>(null)

  const load = useCallback(() => {
    fetch('/api/velocity-wall')
      .then((r) => r.json())
      .then((d) => setData(d as VelocityWallResponse))
      .catch((e) => setError(String(e)))
  }, [])

  useEffect(() => {
    load()
    const t = setInterval(load, 60_000)
    return () => clearInterval(t)
  }, [load])

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <div className="sticky top-0 z-40 bg-slate-950/90 backdrop-blur border-b border-white/5">
        <SubPageHeader title="Turn Velocity Sparklines Wall">
          {data && (
            <div className="flex gap-4 font-mono text-[0.6rem] text-slate-400">
              <span>Most active: <span className="text-cyan-400">{data.mostActive ?? '—'}</span></span>
              <span>Fleet avg/day: <span className="text-white">{data.fleetDailyAvg}</span></span>
              <span className="text-slate-500">{data.generatedAt.slice(0, 19).replace('T', ' ')}</span>
            </div>
          )}
        </SubPageHeader>
      </div>

      <div className="p-6">
        {error && (
          <p className="font-mono text-red-400 text-xs">{error}</p>
        )}
        {!data && !error && (
          <p className="font-mono text-slate-500 text-xs">Loading…</p>
        )}

        {data && (
          <>
            <div className="flex gap-4 mb-6 font-mono text-[0.6rem]">
              <span><span style={{ color: TREND_COLOR.rising }}>■</span> rising</span>
              <span><span style={{ color: TREND_COLOR.falling }}>■</span> falling</span>
              <span><span style={{ color: TREND_COLOR.flat }}>■</span> flat</span>
            </div>

            <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))' }}>
              {data.projects.map((p) => {
                const color = TREND_COLOR[p.trend] ?? '#64748B'
                return (
                  <div
                    key={p.slug}
                    className="bg-white/3 border border-white/8 rounded-lg p-3 hover:border-white/20 transition-colors"
                    onClick={() => setExpanded(p)}
                  >
                    <div className="flex justify-between items-center mb-1">
                      <span className="font-mono text-[0.6rem] text-white truncate max-w-[80px]">{p.slug}</span>
                      <span className="font-mono text-[0.55rem]" style={{ color }}>
                        {p.sevenDayTotal}
                      </span>
                    </div>
                    <Sparkline daily={p.daily} trend={p.trend} onClick={() => setExpanded(p)} />
                    <div className="mt-1 font-mono text-[0.5rem]" style={{ color }}>
                      {TREND_LABEL[p.trend]}
                    </div>
                  </div>
                )
              })}
            </div>

            {data.projects.length === 0 && (
              <p className="font-mono text-slate-500 text-xs">No projects found.</p>
            )}
          </>
        )}
      </div>

      {expanded && (
        <ExpandedModal project={expanded} onClose={() => setExpanded(null)} />
      )}
    </div>
  )
}
