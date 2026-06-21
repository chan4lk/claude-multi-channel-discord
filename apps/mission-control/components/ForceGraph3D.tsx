'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import ForceGraph3DLib from 'react-force-graph-3d'
import type { FleetProject, ProjectState } from '../app/api/fleet/route'

const STATE_COLORS: Record<ProjectState, string> = {
  idle: '#00F5FF',
  active: '#4ADE80',
  stalled: '#EF4444',
  autonomous: '#A855F7',
}

interface GraphNode {
  id: string
  slug: string
  state: ProjectState
  ageMins: number
  color: string
}

interface GraphLink {
  source: string
  target: string
}

interface HudState {
  slug: string
  state: ProjectState
  ageMins: number
  x: number
  y: number
}

function formatAge(mins: number): string {
  if (mins > 9000) return 'no transcript'
  if (mins >= 60) return `${Math.floor(mins / 60)}h ${mins % 60}m ago`
  return `${mins}m ago`
}

export default function ForceGraph3D() {
  const containerRef = useRef<HTMLDivElement>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fgRef = useRef<any>(null)
  const [graphData, setGraphData] = useState<{ nodes: GraphNode[]; links: GraphLink[] }>({ nodes: [], links: [] })
  const [hud, setHud] = useState<HudState | null>(null)
  const autoRotateRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const userInteractRef = useRef(false)
  const resumeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const fetchFleet = useCallback(async () => {
    try {
      const res = await fetch('/api/fleet')
      if (!res.ok) return
      const projects: FleetProject[] = await res.json()
      const nodes: GraphNode[] = projects.map((p) => ({
        id: p.slug,
        slug: p.slug,
        state: p.state,
        ageMins: p.ageMins,
        color: STATE_COLORS[p.state] ?? '#475569',
      }))
      setGraphData({ nodes, links: [] })
    } catch {}
  }, [])

  useEffect(() => {
    fetchFleet()
    const id = setInterval(fetchFleet, 30_000)
    return () => clearInterval(id)
  }, [fetchFleet])

  // Slow auto-rotation (~0.3 rpm = 1.8 deg/s)
  useEffect(() => {
    autoRotateRef.current = setInterval(() => {
      if (userInteractRef.current) return
      const fg = fgRef.current
      if (!fg) return
      try {
        // Orbit camera around Y axis
        const camera = (fg as unknown as { camera(): { position: { x: number; y: number; z: number }; applyQuaternion?: unknown } }).camera()
        const angle = 0.003
        const { x, z } = camera.position
        const cos = Math.cos(angle)
        const sin = Math.sin(angle)
        camera.position.x = x * cos - z * sin
        camera.position.z = x * sin + z * cos
        ;(fg as unknown as { cameraPosition(pos: object): void }).cameraPosition(camera.position)
      } catch {}
    }, 16)
    return () => { if (autoRotateRef.current) clearInterval(autoRotateRef.current) }
  }, [])

  function pauseRotation() {
    userInteractRef.current = true
    if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current)
    resumeTimerRef.current = setTimeout(() => { userInteractRef.current = false }, 3000)
  }

  function handleNodeClick(node: GraphNode, event: MouseEvent) {
    pauseRotation()
    setHud({
      slug: node.slug,
      state: node.state,
      ageMins: node.ageMins,
      x: event.clientX,
      y: event.clientY,
    })
  }

  function handleDblClick() {
    pauseRotation()
    setHud(null)
    const fg = fgRef.current
    if (fg) {
      try {
        ;(fg as unknown as { cameraPosition(pos: object, lookAt: object, ms: number): void })
          .cameraPosition({ x: 0, y: 0, z: 300 }, { x: 0, y: 0, z: 0 }, 1000)
      } catch {}
    }
  }

  return (
    <div
      ref={containerRef}
      className="w-full h-full"
      style={{ minHeight: 400 }}
      onMouseDown={pauseRotation}
      onWheel={pauseRotation}
      onDoubleClick={handleDblClick}
    >
      {/* Legend */}
      <div className="absolute top-3 left-3 z-10 flex flex-col gap-1 pointer-events-none">
        {(Object.entries(STATE_COLORS) as [ProjectState, string][]).map(([state, color]) => (
          <div key={state} className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full" style={{ background: color, boxShadow: `0 0 6px ${color}` }} />
            <span className="text-[0.6rem] font-mono uppercase tracking-wider" style={{ color }}>{state}</span>
          </div>
        ))}
      </div>

      <ForceGraph3DLib
        ref={fgRef}
        graphData={graphData}
        width={containerRef.current?.clientWidth ?? 800}
        height={containerRef.current?.clientHeight ?? 500}
        backgroundColor="rgba(0,0,0,0)"
        nodeLabel={(node) => (node as GraphNode).slug}
        nodeColor={(node) => (node as GraphNode).color}
        nodeOpacity={0.9}
        nodeResolution={16}
        nodeVal={(node) => {
          const state = (node as GraphNode).state
          return state === 'active' ? 8 : state === 'stalled' ? 10 : 6
        }}
        nodeThreeObjectExtend={false}
        linkColor={() => 'rgba(0,245,255,0.15)'}
        linkWidth={0.5}
        onNodeClick={(node, event) => handleNodeClick(node as GraphNode, event as MouseEvent)}
      />

      {/* HUD panel */}
      {hud && (
        <div
          className="absolute pointer-events-auto z-20 rounded border px-3 py-2 text-[0.65rem] font-mono flex flex-col gap-1"
          style={{
            left: Math.min(hud.x, window.innerWidth - 200),
            top: Math.min(hud.y + 12, window.innerHeight - 100),
            background: 'rgba(4,10,20,0.95)',
            borderColor: `${STATE_COLORS[hud.state]}40`,
            backdropFilter: 'blur(8px)',
            minWidth: 160,
          }}
        >
          <div className="flex items-center justify-between gap-4">
            <span className="font-bold text-slate-200">{hud.slug}</span>
            <button onClick={() => setHud(null)} className="text-slate-500 hover:text-slate-200 text-xs">×</button>
          </div>
          <span
            className="text-[0.6rem] px-1.5 py-0.5 rounded uppercase font-bold w-fit"
            style={{ color: STATE_COLORS[hud.state], background: `${STATE_COLORS[hud.state]}18` }}
          >
            {hud.state}
          </span>
          <span className="text-slate-500">{formatAge(hud.ageMins)}</span>
        </div>
      )}
    </div>
  )
}
