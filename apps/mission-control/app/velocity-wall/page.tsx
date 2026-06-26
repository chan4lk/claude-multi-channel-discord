'use client'

import { useEffect, useState, useCallback, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import SubPageHeader from '../../components/SubPageHeader'
import type { VelocityWallResponse, VelocityProject } from '../api/velocity-wall/route'

type Platform = 'all' | 'discord' | 'teams' | 'whatsapp'

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

const PLATFORM_ICON: Record<string, string> = {
  discord: '💬',
  teams: '🟦',
  whatsapp: '📱',
}

const PLATFORM_LABELS: Platform[] = ['all', 'discord', 'teams', 'whatsapp']

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
            <span className="ml-2 font-mono text-[0.6rem] text-slate-500">
              {PLATFORM_ICON[project.platform] ?? ''} {project.platform}
            </span>
            <span className="ml-2 font-mono text-xs" style={{ color }}>
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

function VelocityWallInner() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const [data, setData] = useState<VelocityWallResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<VelocityProject | null>(null)

  const platformParam = (searchParams.get('platform') ?? 'all') as Platform
  const activePlatform: Platform = PLATFORM_LABELS.includes(platformParam) ? platformParam : 'all'

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

  function setPlatform(p: Platform) {
    const params = new URLSearchParams(searchParams.toString())
    if (p === 'all') {
      params.delete('platform')
    } else {
      params.set('platform', p)
    }
    router.replace(`?${params.toString()}`, { scroll: false })
  }

  const filtered = data
    ? (activePlatform === 'all'
        ? data.projects
        : data.projects.filter((p) => p.platform === activePlatform))
    : []

  const filteredMostActive = filtered.length > 0 ? filtered[0]!.slug : null
  const filteredTotalTurns = filtered.reduce((s, p) => s + p.daily.reduce((a, d) => a + d.count, 0), 0)
  const filteredDailyAvg = filtered.length > 0 ? Math.round((filteredTotalTurns / 30) * 10) / 10 : 0

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <div className="sticky top-0 z-40 bg-slate-950/90 backdrop-blur border-b border-white/5">
        <SubPageHeader title="Turn Velocity Sparklines Wall">
          {data && (
            <div className="flex gap-4 font-mono text-[0.6rem] text-slate-400">
              <span>Most active: <span className="text-cyan-400">{filteredMostActive ?? '—'}</span></span>
              <span>Fleet avg/day: <span className="text-white">{filteredDailyAvg}</span></span>
              <span className="text-slate-500">{data.generatedAt.slice(0, 19).replace('T', ' ')}</span>
            </div>
          )}
        </SubPageHeader>
      </div>

      <div className="p-6">
        {error && <p className="font-mono text-red-400 text-xs mb-4">{error}</p>}
        {!data && !error && <p className="font-mono text-slate-500 text-xs">Loading…</p>}

        {data && (
          <>
            {/* Platform filter */}
            <div className="flex gap-2 mb-5">
              {PLATFORM_LABELS.map((p) => {
                const active = p === activePlatform
                const count = p === 'all' ? data.projects.length : data.projects.filter((proj) => proj.platform === p).length
                return (
                  <button
                    key={p}
                    onClick={() => setPlatform(p)}
                    className="font-mono text-[0.6rem] rounded-lg px-3 py-1 border transition-colors"
                    style={{
                      background: active ? 'rgba(34,211,238,0.12)' : 'rgba(255,255,255,0.03)',
                      borderColor: active ? '#22D3EE55' : 'rgba(255,255,255,0.08)',
                      color: active ? '#22D3EE' : '#64748B',
                    }}
                  >
                    {p === 'all' ? 'All' : `${PLATFORM_ICON[p]} ${p}`}
                    {' '}
                    <span style={{ opacity: 0.7 }}>({count})</span>
                  </button>
                )
              })}
            </div>

            {/* Legend */}
            <div className="flex gap-4 mb-5 font-mono text-[0.6rem]">
              <span><span style={{ color: TREND_COLOR.rising }}>■</span> rising</span>
              <span><span style={{ color: TREND_COLOR.falling }}>■</span> falling</span>
              <span><span style={{ color: TREND_COLOR.flat }}>■</span> flat</span>
            </div>

            <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))' }}>
              {filtered.map((p) => {
                const color = TREND_COLOR[p.trend] ?? '#64748B'
                return (
                  <div
                    key={p.slug}
                    className="bg-white/3 border border-white/8 rounded-lg p-3 hover:border-white/20 transition-colors cursor-pointer"
                    onClick={() => setExpanded(p)}
                  >
                    <div className="flex justify-between items-center mb-1">
                      <span className="font-mono text-[0.6rem] text-white truncate max-w-[80px]">{p.slug}</span>
                      <span className="font-mono text-[0.55rem]" style={{ color }}>
                        {p.sevenDayTotal}
                      </span>
                    </div>
                    <Sparkline daily={p.daily} trend={p.trend} onClick={() => setExpanded(p)} />
                    <div className="mt-1 flex justify-between items-center">
                      <span className="font-mono text-[0.5rem]" style={{ color }}>
                        {TREND_LABEL[p.trend]}
                      </span>
                      <span className="font-mono text-[0.5rem] text-slate-600" title={p.platform}>
                        {PLATFORM_ICON[p.platform] ?? ''}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>

            {filtered.length === 0 && (
              <p className="font-mono text-slate-500 text-xs">
                No {activePlatform === 'all' ? '' : activePlatform + ' '}projects found.
              </p>
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

export default function VelocityWallPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-slate-950 text-white p-6 font-mono text-slate-500 text-xs">Loading…</div>}>
      <VelocityWallInner />
    </Suspense>
  )
}
