'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import ForceGraph3DLib from 'react-force-graph-3d'
import type { Graph3DResponse, GraphNode, GraphLink, ProjectState } from '../app/api/3d-graph/route'

const STATE_COLORS: Record<ProjectState, string> = {
  idle: '#00F5FF',
  active: '#4ADE80',
  stalled: '#EF4444',
  autonomous: '#A855F7',
}

const STATE_LABELS: Record<ProjectState, string> = {
  idle: 'Idle',
  active: 'Active',
  stalled: 'Stalled',
  autonomous: 'Autonomous',
}

interface HudState {
  slug: string
  state: ProjectState
  turnCount24h: number
  x: number
  y: number
}

function nodeVal(node: GraphNode): number {
  const base = Math.max(3, Math.min(15, node.turnCount24h * 1.5 + 4))
  return node.state === 'stalled' ? base + 2 : base
}

export default function Fleet3DForceGraph() {
  const router = useRouter()
  const containerRef = useRef<HTMLDivElement>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fgRef = useRef<any>(null)
  const [graphData, setGraphData] = useState<{ nodes: GraphNode[]; links: GraphLink[] }>({ nodes: [], links: [] })
  const [meta, setMeta] = useState({ nodeCount: 0, edgeCount: 0 })
  const [hud, setHud] = useState<HudState | null>(null)
  const userInteractRef = useRef(false)
  const resumeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const rotateRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchGraph = useCallback(async () => {
    try {
      const res = await fetch('/api/3d-graph')
      if (!res.ok) return
      const data = await res.json() as Graph3DResponse
      setGraphData({ nodes: data.nodes, links: data.links })
      setMeta({ nodeCount: data.nodes.length, edgeCount: data.links.length })
    } catch {}
  }, [])

  useEffect(() => {
    fetchGraph()
    const id = setInterval(fetchGraph, 60_000)
    return () => clearInterval(id)
  }, [fetchGraph])

  // Auto-orbit 0.1 deg/s ≈ 0.00175 rad/frame @60fps → 0.003 rad per 16ms
  useEffect(() => {
    rotateRef.current = setInterval(() => {
      if (userInteractRef.current) return
      const fg = fgRef.current
      if (!fg) return
      try {
        const camera = (fg as unknown as { camera(): { position: { x: number; y: number; z: number } } }).camera()
        const angle = 0.003
        const { x, z } = camera.position
        const cos = Math.cos(angle)
        const sin = Math.sin(angle)
        ;(fg as unknown as { cameraPosition(pos: object): void }).cameraPosition({
          x: x * cos - z * sin,
          y: camera.position.y,
          z: x * sin + z * cos,
        })
      } catch {}
    }, 16)
    return () => { if (rotateRef.current) clearInterval(rotateRef.current) }
  }, [])

  function pauseRotation() {
    userInteractRef.current = true
    if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current)
    resumeTimerRef.current = setTimeout(() => { userInteractRef.current = false }, 4000)
  }

  function handleNodeClick(node: GraphNode, event: MouseEvent) {
    pauseRotation()
    setHud({ slug: node.slug, state: node.state, turnCount24h: node.turnCount24h, x: event.clientX, y: event.clientY })
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
      className="w-full h-full relative"
      style={{ minHeight: 400 }}
      onMouseDown={pauseRotation}
      onWheel={pauseRotation}
      onDoubleClick={handleDblClick}
    >
      {/* Legend — bottom-left per spec */}
      <div
        className="absolute bottom-4 left-4 z-10 flex flex-col gap-1.5 pointer-events-none"
        style={{
          background: 'rgba(2,8,17,0.82)',
          border: '1px solid rgba(0,245,255,0.12)',
          borderRadius: 6,
          padding: '8px 12px',
          backdropFilter: 'blur(6px)',
        }}
      >
        {(Object.entries(STATE_COLORS) as [ProjectState, string][]).map(([state, color]) => (
          <div key={state} className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: color, boxShadow: `0 0 5px ${color}` }} />
            <span className="text-[0.6rem] font-mono uppercase tracking-wider" style={{ color }}>{STATE_LABELS[state]}</span>
          </div>
        ))}
        <div className="border-t border-slate-700 mt-0.5 pt-1 flex flex-col gap-0.5">
          <span className="text-[0.55rem] font-mono text-slate-500">{meta.nodeCount} nodes · {meta.edgeCount} edges</span>
          <span className="text-[0.55rem] font-mono text-slate-600">edge = &gt;2 shared keywords</span>
        </div>
      </div>

      <ForceGraph3DLib
        ref={fgRef}
        graphData={graphData}
        width={containerRef.current?.clientWidth ?? 800}
        height={containerRef.current?.clientHeight ?? 500}
        backgroundColor="rgba(0,0,0,0)"
        nodeLabel={(node) => `${(node as GraphNode).slug} (${(node as GraphNode).turnCount24h} turns/24h)`}
        nodeColor={(node) => (node as GraphNode).color}
        nodeOpacity={0.9}
        nodeResolution={16}
        nodeVal={(node) => nodeVal(node as GraphNode)}
        linkColor={() => 'rgba(0,245,255,0.18)'}
        linkWidth={0.4}
        linkOpacity={0.6}
        onNodeClick={(node, event) => handleNodeClick(node as GraphNode, event as MouseEvent)}
      />

      {/* HUD panel */}
      {hud && (
        <div
          className="absolute pointer-events-auto z-20 rounded border px-3 py-2 text-[0.65rem] font-mono flex flex-col gap-1.5"
          style={{
            left: Math.min(hud.x + 8, (containerRef.current?.clientWidth ?? 800) - 180),
            top: Math.min(hud.y + 12, (containerRef.current?.clientHeight ?? 500) - 120),
            background: 'rgba(4,10,20,0.95)',
            borderColor: `${STATE_COLORS[hud.state]}40`,
            backdropFilter: 'blur(8px)',
            minWidth: 160,
          }}
        >
          <div className="flex items-center justify-between gap-4">
            <span className="font-bold text-slate-200">{hud.slug}</span>
            <button onClick={() => setHud(null)} className="text-slate-500 hover:text-slate-200 text-xs leading-none">×</button>
          </div>
          <span
            className="text-[0.6rem] px-1.5 py-0.5 rounded uppercase font-bold w-fit"
            style={{ color: STATE_COLORS[hud.state], background: `${STATE_COLORS[hud.state]}18` }}
          >
            {hud.state}
          </span>
          <span className="text-slate-500">{hud.turnCount24h} turns in 24h</span>
          <button
            onClick={() => { setHud(null); router.push(`?spotlight=${encodeURIComponent(hud.slug)}`) }}
            className="text-[0.6rem] font-mono px-2 py-1 rounded border w-full text-left transition-colors"
            style={{ borderColor: `${STATE_COLORS[hud.state]}40`, color: STATE_COLORS[hud.state], background: `${STATE_COLORS[hud.state]}10` }}
          >
            ◎ Open Spotlight
          </button>
        </div>
      )}
    </div>
  )
}
