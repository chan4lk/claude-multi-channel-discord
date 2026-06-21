'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense } from 'react'
import Link from 'next/link'
import type { FleetProject, ProjectState } from '../api/fleet/route'

const STATE_COLOR: Record<ProjectState, string> = {
  idle: '#22D3EE',
  active: '#4ADE80',
  stalled: '#EF4444',
  autonomous: '#A855F7',
}

function slugHash(s: string): number {
  let h = 5381
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(33, h) ^ s.charCodeAt(i)) >>> 0
  }
  return h
}

function seededLcg(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0
    return s / 0xffffffff
  }
}

interface ParticleDef {
  slug: string
  state: ProjectState
  baseAngle: number
  baseRadiusFrac: number
  orbitFrac: number
  phase: number
  size: number
}

function buildParticles(projects: FleetProject[]): ParticleDef[] {
  return projects.map((p) => {
    const rng = seededLcg(slugHash(p.slug))
    return {
      slug: p.slug,
      state: p.state,
      baseAngle: rng() * Math.PI * 2,
      baseRadiusFrac: 0.10 + rng() * 0.72,
      orbitFrac: 0.008 + rng() * 0.018,
      phase: rng() * Math.PI * 2,
      size: 5 + rng() * 9,
    }
  })
}

function orbitSpeed(state: ProjectState): number {
  if (state === 'active') return 0.12
  if (state === 'autonomous') return 0.06
  if (state === 'stalled') return 0.02
  return 0.03
}

interface HitParticle {
  slug: string
  x: number
  y: number
}

function AmbientCanvas({ projects, onHit }: { projects: FleetProject[]; onHit: (h: HitParticle | null) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rafRef = useRef<number>(0)
  const hoveredRef = useRef<number>(-1)
  const particlesRef = useRef<ParticleDef[]>([])
  const projectsRef = useRef<FleetProject[]>(projects)

  useEffect(() => { projectsRef.current = projects }, [projects])

  const getPositions = useCallback((w: number, h: number, tSec: number) => {
    const cx = w / 2, cy = h / 2
    const maxR = Math.min(w, h) * 0.46
    return particlesRef.current.map((p) => {
      const r = p.baseRadiusFrac * maxR
      const speed = orbitSpeed(p.state)
      const angle = p.baseAngle + tSec * speed
      const orbitR = p.orbitFrac * maxR
      const x = cx + r * Math.cos(angle) + orbitR * Math.cos(tSec * 0.61 + p.phase)
      const y = cy + r * Math.sin(angle) + orbitR * Math.sin(tSec * 0.43 + p.phase * 1.3)
      return { x, y, size: p.size }
    })
  }, [])

  useEffect(() => {
    particlesRef.current = buildParticles(projects)
  }, [projects])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let startTs = 0

    function draw(ts: number) {
      if (!ctx || !canvas) return
      if (!startTs) startTs = ts
      const tSec = (ts - startTs) / 1000
      const w = canvas.width, h = canvas.height
      const dpr = window.devicePixelRatio ?? 1
      const cx = w / 2, cy = h / 2

      ctx.fillStyle = '#020810'
      ctx.fillRect(0, 0, w, h)

      // Subtle radial gradient background
      const bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.min(w, h) * 0.5)
      bg.addColorStop(0, 'rgba(10,20,45,0.8)')
      bg.addColorStop(1, 'rgba(2,8,16,0)')
      ctx.fillStyle = bg
      ctx.fillRect(0, 0, w, h)

      const positions = getPositions(w, h, tSec)

      particlesRef.current.forEach((p, i) => {
        const { x, y, size } = positions[i]
        const color = STATE_COLOR[p.state]
        const isHovered = hoveredRef.current === i
        const drawSize = isHovered ? size * 1.6 : size

        // Stalled: ripple ring
        if (p.state === 'stalled') {
          const ripplePhase = (tSec * 1.5 + p.phase) % 1
          const rippleR = drawSize + ripplePhase * drawSize * 3
          const rippleAlpha = (1 - ripplePhase) * 0.4
          ctx.save()
          ctx.beginPath()
          ctx.arc(x, y, rippleR, 0, Math.PI * 2)
          ctx.strokeStyle = `${color}${Math.round(rippleAlpha * 255).toString(16).padStart(2, '0')}`
          ctx.lineWidth = 1.5 * dpr
          ctx.stroke()
          ctx.restore()
        }

        // Autonomous: orbit trail
        if (p.state === 'autonomous') {
          for (let t = 1; t <= 5; t++) {
            const trailSec = tSec - t * 0.08
            if (trailSec < 0) continue
            const tp = getPositions(w, h, trailSec)[i]
            const alpha = (1 - t / 6) * 0.25
            ctx.save()
            ctx.globalAlpha = alpha
            ctx.beginPath()
            ctx.arc(tp.x, tp.y, size * 0.6, 0, Math.PI * 2)
            ctx.fillStyle = color
            ctx.fill()
            ctx.restore()
          }
        }

        // Pulse for active
        let alpha = 1
        if (p.state === 'idle') alpha = 0.55 + 0.2 * Math.sin(tSec * 0.8 + p.phase)
        if (p.state === 'active') alpha = 0.8 + 0.2 * Math.sin(tSec * 3 + p.phase)
        if (p.state === 'stalled') alpha = 0.5 + 0.5 * Math.sin(tSec * 2.2 + p.phase)

        ctx.save()
        ctx.globalAlpha = alpha

        // Glow
        ctx.shadowBlur = isHovered ? 32 : 18
        ctx.shadowColor = color

        ctx.beginPath()
        ctx.arc(x, y, drawSize, 0, Math.PI * 2)
        ctx.fillStyle = color
        ctx.fill()

        // Inner highlight
        ctx.shadowBlur = 0
        const hl = ctx.createRadialGradient(x - drawSize * 0.3, y - drawSize * 0.3, 0, x, y, drawSize)
        hl.addColorStop(0, 'rgba(255,255,255,0.5)')
        hl.addColorStop(0.5, color + '88')
        hl.addColorStop(1, color + '00')
        ctx.globalAlpha = alpha * 0.5
        ctx.beginPath()
        ctx.arc(x, y, drawSize, 0, Math.PI * 2)
        ctx.fillStyle = hl
        ctx.fill()

        ctx.restore()
      })

      rafRef.current = requestAnimationFrame(draw)
    }

    rafRef.current = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(rafRef.current)
  }, [getPositions])

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

  function getHit(e: React.MouseEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current
    if (!canvas) return -1
    const rect = canvas.getBoundingClientRect()
    const dpr = window.devicePixelRatio ?? 1
    const mx = (e.clientX - rect.left) * dpr
    const my = (e.clientY - rect.top) * dpr
    const w = canvas.width, h = canvas.height
    // Use current raf time estimate (rough)
    const tSec = performance.now() / 1000
    const positions = getPositions(w, h, tSec)
    for (let i = 0; i < positions.length; i++) {
      const { x, y, size } = positions[i]
      if (Math.hypot(mx - x, my - y) <= size + 10 * dpr) return i
    }
    return -1
  }

  function handleMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    const idx = getHit(e)
    hoveredRef.current = idx
    if (idx >= 0) {
      onHit({ slug: particlesRef.current[idx].slug, x: e.clientX, y: e.clientY })
    } else {
      onHit(null)
    }
  }

  function handleClick(e: React.MouseEvent<HTMLCanvasElement>) {
    const idx = getHit(e)
    if (idx >= 0) {
      const slug = particlesRef.current[idx].slug
      const params = new URLSearchParams(window.location.search)
      params.set('spotlight', slug)
      window.history.pushState(null, '', `?${params.toString()}`)
      window.dispatchEvent(new PopStateEvent('popstate'))
    }
  }

  return (
    <canvas
      ref={canvasRef}
      className="w-full h-full block"
      style={{ cursor: 'crosshair' }}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => { hoveredRef.current = -1; onHit(null) }}
      onClick={handleClick}
    />
  )
}

interface Tooltip {
  slug: string
  x: number
  y: number
}

function AmbientInner() {
  const [projects, setProjects] = useState<FleetProject[]>([])
  const [tooltip, setTooltip] = useState<Tooltip | null>(null)
  const [overlayVisible, setOverlayVisible] = useState(false)
  const overlayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const searchParams = useSearchParams()

  const fetchFleet = useCallback(() => {
    fetch('/api/fleet')
      .then((r) => r.json())
      .then((d: { projects?: FleetProject[] }) => { if (d.projects) setProjects(d.projects) })
      .catch(() => {})
  }, [])

  useEffect(() => {
    fetchFleet()
    const id = setInterval(fetchFleet, 30_000)
    return () => clearInterval(id)
  }, [fetchFleet])

  function showOverlay() {
    setOverlayVisible(true)
    if (overlayTimerRef.current) clearTimeout(overlayTimerRef.current)
    overlayTimerRef.current = setTimeout(() => setOverlayVisible(false), 3000)
  }

  function handleHit(h: HitParticle | null) {
    setTooltip(h)
    showOverlay()
  }

  const active = projects.filter((p) => p.state === 'active').length
  const stalled = projects.filter((p) => p.state === 'stalled').length
  const autonomous = projects.filter((p) => p.state === 'autonomous').length

  const spotlightSlug = searchParams.get('spotlight')

  return (
    <div
      className="fixed inset-0"
      style={{ background: '#020810' }}
      onMouseMove={showOverlay}
    >
      {/* Full-screen canvas */}
      <AmbientCanvas projects={projects} onHit={handleHit} />

      {/* Tooltip */}
      {tooltip && (
        <div
          className="fixed pointer-events-none font-mono text-[0.65rem] px-2 py-1 rounded border z-30"
          style={{
            left: tooltip.x + 14,
            top: tooltip.y - 10,
            background: 'rgba(4,10,22,0.92)',
            borderColor: 'rgba(0,245,255,0.25)',
            color: '#CBD5E1',
            backdropFilter: 'blur(4px)',
          }}
        >
          {tooltip.slug}
        </div>
      )}

      {/* Overlay — auto-hides after 3s of no mouse movement */}
      <div
        className="fixed top-0 left-0 right-0 z-20 transition-opacity duration-500"
        style={{ opacity: overlayVisible ? 1 : 0, pointerEvents: overlayVisible ? 'auto' : 'none' }}
      >
        <div
          className="flex items-center gap-4 px-5 py-3"
          style={{ background: 'rgba(2,8,16,0.72)', backdropFilter: 'blur(8px)' }}
        >
          <span className="text-[0.6rem] font-mono uppercase tracking-widest text-slate-600">Fleet Ambient</span>
          <div className="flex items-center gap-3 text-[0.65rem] font-mono">
            <span style={{ color: '#4ADE80' }}>● {active} active</span>
            {stalled > 0 && <span style={{ color: '#EF4444' }}>● {stalled} stalled</span>}
            {autonomous > 0 && <span style={{ color: '#A855F7' }}>● {autonomous} autonomous</span>}
            <span style={{ color: '#334155' }}>{projects.length} total</span>
          </div>
          <div className="ml-auto flex items-center gap-3">
            {/* State legend */}
            <div className="hidden sm:flex items-center gap-3 text-[0.55rem] font-mono text-slate-700">
              {(['idle', 'active', 'stalled', 'autonomous'] as ProjectState[]).map((s) => (
                <span key={s} className="flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: STATE_COLOR[s] }} />
                  {s}
                </span>
              ))}
            </div>
            <Link
              href="/"
              className="text-[0.6rem] font-mono px-2.5 py-1 rounded border transition-colors"
              style={{ borderColor: 'rgba(0,245,255,0.2)', color: '#64748B' }}
            >
              × Dashboard
            </Link>
          </div>
        </div>
      </div>

      {/* Empty state */}
      {projects.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="text-center font-mono">
            <div className="text-4xl mb-3 opacity-10">◉</div>
            <div className="text-xs text-slate-700">No projects in fleet</div>
          </div>
        </div>
      )}

      {/* Click hint — shown before first spotlight open */}
      {!spotlightSlug && projects.length > 0 && overlayVisible && (
        <div
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-20 text-[0.55rem] font-mono text-slate-700 pointer-events-none"
        >
          Click a particle to inspect
        </div>
      )}
    </div>
  )
}

export default function AmbientPage() {
  return (
    <Suspense>
      <AmbientInner />
    </Suspense>
  )
}
