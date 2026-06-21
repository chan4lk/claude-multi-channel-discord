'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import SubPageHeader from '../../components/SubPageHeader'
import type { FleetProject, ProjectState } from '../api/fleet/route'

const STATE_COLOR: Record<ProjectState, string> = {
  active: '#4ADE80',
  idle: '#22D3EE',
  stalled: '#EF4444',
  autonomous: '#A78BFA',
}

const STATE_LABEL: Record<ProjectState, string> = {
  active: 'Active — bright green',
  idle: 'Idle — dim cyan',
  stalled: 'Stalled — red pulse',
  autonomous: 'Autonomous — purple nebula',
}

const GOLDEN_ANGLE = 2.39996323 // 2π / φ²
const FULL_ROTATION_S = 120
const MIN_STAR = 4
const MAX_STAR = 20

function formatAge(ageMins: number): string {
  if (ageMins < 60) return `${ageMins}m ago`
  if (ageMins < 1440) return `${Math.floor(ageMins / 60)}h ago`
  return `${Math.floor(ageMins / 1440)}d ago`
}

interface StarDatum {
  cx: number    // canvas pixels from canvas left
  cy: number    // canvas pixels from canvas top
  r: number     // star radius in canvas pixels
  color: string
  project: FleetProject
}

function buildStarData(projects: FleetProject[], w: number, h: number, rotation: number): StarDatum[] {
  if (projects.length === 0) return []
  const cx = w / 2
  const cy = h / 2
  const maxRadius = Math.min(w, h) * 0.42
  const maxAgeDays = Math.max(...projects.map(p => p.ageMins / 1440), 1)
  const maxMemBytes = Math.max(...projects.map(p => p.memoryStatus?.sizeBytes ?? 100), 1)

  return projects.map((proj, i) => {
    const ageDays = proj.ageMins / 1440
    const radial = Math.sqrt(ageDays / maxAgeDays) * maxRadius
    const theta = i * GOLDEN_ANGLE + rotation

    const memBytes = proj.memoryStatus?.sizeBytes ?? 100
    const logMem = Math.log(Math.max(memBytes, 1)) / Math.log(Math.max(maxMemBytes, 2))
    const starR = MIN_STAR + (MAX_STAR - MIN_STAR) * Math.max(0, Math.min(1, logMem))

    return {
      cx: cx + radial * Math.cos(theta),
      cy: cy + radial * Math.sin(theta),
      r: starR,
      color: STATE_COLOR[proj.state],
      project: proj,
    }
  })
}

interface TooltipState {
  x: number   // CSS px from canvas left
  y: number   // CSS px from canvas top
  project: FleetProject
}

function GalaxyCanvas({ projects }: { projects: FleetProject[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rotRef = useRef(0)
  const lastTRef = useRef(0)
  const hoveredIdxRef = useRef(-1)
  const pausedRef = useRef(false)
  const rafRef = useRef(0)
  const [tooltip, setTooltip] = useState<TooltipState | null>(null)
  const router = useRouter()

  // Draw loop
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    function draw(t: number) {
      if (!canvas) return
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      const w = canvas.width
      const h = canvas.height

      const dt = lastTRef.current ? (t - lastTRef.current) / 1000 : 0
      lastTRef.current = t

      if (!pausedRef.current) {
        rotRef.current += (2 * Math.PI / FULL_ROTATION_S) * dt
      }

      const rot = rotRef.current
      const stars = buildStarData(projects, w, h, rot)
      const tSec = t / 1000

      // Background
      const bg = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.min(w, h) * 0.55)
      bg.addColorStop(0, '#0b1a30')
      bg.addColorStop(0.45, '#060f1e')
      bg.addColorStop(1, '#020811')
      ctx.fillStyle = bg
      ctx.fillRect(0, 0, w, h)

      // Draw each star
      stars.forEach(({ cx, cy, r, color, project }, i) => {
        const isHovered = hoveredIdxRef.current === i
        let alpha = 1
        if (project.state === 'idle') alpha = 0.65
        if (project.state === 'stalled') alpha = 0.5 + 0.5 * Math.sin(tSec * 2.5 + i * 0.7)

        const drawR = isHovered ? r * 1.5 : r

        ctx.save()
        ctx.globalAlpha = alpha

        // Outer glow
        ctx.shadowBlur = isHovered ? 28 : 16
        ctx.shadowColor = color
        ctx.beginPath()
        ctx.arc(cx, cy, drawR, 0, 2 * Math.PI)
        ctx.fillStyle = color
        ctx.fill()

        // Inner highlight
        ctx.shadowBlur = 0
        const hl = ctx.createRadialGradient(cx - drawR * 0.25, cy - drawR * 0.25, 0, cx, cy, drawR)
        hl.addColorStop(0, 'rgba(255,255,255,0.55)')
        hl.addColorStop(0.4, color + 'aa')
        hl.addColorStop(1, color + '00')
        ctx.globalAlpha = alpha * 0.5
        ctx.beginPath()
        ctx.arc(cx, cy, drawR, 0, 2 * Math.PI)
        ctx.fillStyle = hl
        ctx.fill()

        ctx.restore()
      })

      rafRef.current = requestAnimationFrame(draw)
    }

    rafRef.current = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(rafRef.current)
  }, [projects])

  // Resize
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    function resize() {
      if (!canvas) return
      const dpr = window.devicePixelRatio ?? 1
      canvas.width = canvas.offsetWidth * dpr
      canvas.height = canvas.offsetHeight * dpr
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)
    return () => ro.disconnect()
  }, [])

  function getHitIndex(e: React.MouseEvent<HTMLCanvasElement>): number {
    const canvas = canvasRef.current
    if (!canvas) return -1
    const rect = canvas.getBoundingClientRect()
    const dpr = window.devicePixelRatio ?? 1
    const mx = (e.clientX - rect.left) * dpr
    const my = (e.clientY - rect.top) * dpr
    const stars = buildStarData(projects, canvas.width, canvas.height, rotRef.current)
    for (let i = 0; i < stars.length; i++) {
      const s = stars[i]
      const dist = Math.sqrt((mx - s.cx) ** 2 + (my - s.cy) ** 2)
      if (dist <= s.r + 8 * dpr) return i
    }
    return -1
  }

  function handleMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    const hit = getHitIndex(e)
    hoveredIdxRef.current = hit
    pausedRef.current = hit >= 0
    if (hit >= 0) {
      const canvas = canvasRef.current!
      const rect = canvas.getBoundingClientRect()
      const dpr = window.devicePixelRatio ?? 1
      const stars = buildStarData(projects, canvas.width, canvas.height, rotRef.current)
      const s = stars[hit]
      setTooltip({
        x: s.cx / dpr,
        y: s.cy / dpr,
        project: s.project,
      })
    } else {
      setTooltip(null)
    }
  }

  function handleMouseLeave() {
    hoveredIdxRef.current = -1
    pausedRef.current = false
    setTooltip(null)
  }

  function handleClick() {
    if (hoveredIdxRef.current >= 0) {
      router.push(`/projects/${projects[hoveredIdxRef.current].slug}`)
    }
  }

  return (
    <div className="relative w-full h-full">
      <canvas
        ref={canvasRef}
        className="w-full h-full"
        style={{ cursor: tooltip ? 'pointer' : 'default' }}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        onClick={handleClick}
      />
      {tooltip && (
        <div
          className="absolute z-20 pointer-events-none rounded-lg border p-3 font-mono"
          style={{
            left: tooltip.x + 18,
            top: tooltip.y - 10,
            background: 'rgba(5,12,25,0.96)',
            borderColor: STATE_COLOR[tooltip.project.state] + '55',
            boxShadow: `0 0 24px ${STATE_COLOR[tooltip.project.state]}28`,
            minWidth: 170,
            fontSize: '0.72rem',
          }}
        >
          <div className="text-white font-bold text-sm mb-1">{tooltip.project.slug}</div>
          <div style={{ color: STATE_COLOR[tooltip.project.state] }} className="capitalize mb-0.5">
            {tooltip.project.state}
          </div>
          <div className="text-slate-400 mb-0.5">{formatAge(tooltip.project.ageMins)}</div>
          {tooltip.project.memoryStatus && (
            <div className="text-slate-500">
              {(tooltip.project.memoryStatus.sizeBytes / 1024).toFixed(1)} KB memory
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function GalaxyPage() {
  const [projects, setProjects] = useState<FleetProject[]>([])
  const [loading, setLoading] = useState(true)
  const [lastUpdated, setLastUpdated] = useState('')

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/fleet')
        if (!res.ok) return
        const data = await res.json() as { projects: FleetProject[] }
        setProjects(data.projects)
        setLastUpdated(new Date().toLocaleTimeString())
      } finally {
        setLoading(false)
      }
    }
    void load()
    const id = setInterval(() => void load(), 30000)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="min-h-dvh flex flex-col" style={{ background: '#020811' }}>
      <SubPageHeader title="PROJECT GALAXY">
        <span className="text-[0.55rem] font-mono text-slate-600">
          {loading ? 'loading...' : `${projects.length} projects · ${lastUpdated}`}
        </span>
      </SubPageHeader>

      <main className="flex-1 relative overflow-hidden">
        {loading ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-cyber-cyan/40 font-mono text-sm animate-pulse">Mapping galaxy...</span>
          </div>
        ) : projects.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-slate-600 font-mono text-sm">No projects found</span>
          </div>
        ) : (
          <GalaxyCanvas projects={projects} />
        )}
      </main>

      {/* Legend */}
      <footer className="border-t border-cyber-cyan/8 px-4 sm:px-6 py-3 flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex flex-wrap gap-3 sm:gap-4">
          {(Object.entries(STATE_LABEL) as [ProjectState, string][]).map(([state, label]) => (
            <div key={state} className="flex items-center gap-1.5">
              <span
                className="inline-block rounded-full"
                style={{ width: 10, height: 10, background: STATE_COLOR[state], boxShadow: `0 0 6px ${STATE_COLOR[state]}` }}
              />
              <span className="text-[0.6rem] font-mono text-slate-500">{label}</span>
            </div>
          ))}
        </div>
        <div className="sm:ml-auto flex flex-wrap gap-3 sm:gap-4 text-[0.6rem] font-mono text-slate-600">
          <span>Size = memory file size</span>
          <span>Distance = days since last activity</span>
          <span>Rotation pauses on hover</span>
          <span>Click star → project page</span>
        </div>
      </footer>
    </div>
  )
}
