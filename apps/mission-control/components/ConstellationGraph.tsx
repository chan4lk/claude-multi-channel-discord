'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import ForceGraph3DLib from 'react-force-graph-3d'
import type { ConstellationNode, ConstellationEdge, ConstellationResponse } from '../app/api/constellation/route'

// Color by convergence score
function convergenceColor(score: number | null): string {
  if (score === null) return '#94A3B8'
  if (score >= 60) return '#10B981'
  if (score >= 30) return '#F59E0B'
  return '#EF4444'
}

// Node size by context pressure (1–12)
function nodeSize(contextPct: number): number {
  return 2 + (contextPct / 100) * 10
}

interface HudState {
  slug: string
  convergenceScore: number | null
  contextPct: number
  turnsPerHour: number
  x: number
  y: number
}

interface GraphNode extends ConstellationNode {
  id: string
  fx: number
  fy: number
  fz: number
}

interface GraphLink extends ConstellationEdge {
  source: string
  target: string
}

export default function ConstellationGraph() {
  const router = useRouter()
  const containerRef = useRef<HTMLDivElement>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fgRef = useRef<any>(null)
  const [graphData, setGraphData] = useState<{ nodes: GraphNode[]; links: GraphLink[] }>({
    nodes: [],
    links: [],
  })
  const [hud, setHud] = useState<HudState | null>(null)
  const [computedAt, setComputedAt] = useState<string>('')
  const autoRotateRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const userInteractRef = useRef(false)
  const resumeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const fetchConstellation = useCallback(async () => {
    try {
      const res = await fetch('/api/constellation')
      if (!res.ok) return
      const data = await res.json() as ConstellationResponse
      const nodes: GraphNode[] = data.nodes.map((n) => ({
        ...n,
        id: n.slug,
        fx: n.x,
        fy: n.y,
        fz: n.z,
      }))
      const links: GraphLink[] = data.edges.map((e) => ({
        ...e,
      }))
      setGraphData({ nodes, links })
      setComputedAt(data.computedAt)
    } catch { /* skip */ }
  }, [])

  useEffect(() => {
    fetchConstellation()
    const id = setInterval(fetchConstellation, 5 * 60 * 1000)
    return () => clearInterval(id)
  }, [fetchConstellation])

  // Slow auto-orbit (~0.3 rpm)
  useEffect(() => {
    autoRotateRef.current = setInterval(() => {
      if (userInteractRef.current) return
      const fg = fgRef.current
      if (!fg) return
      try {
        const camera = (fg as unknown as {
          camera(): { position: { x: number; y: number; z: number } }
        }).camera()
        const angle = 0.003
        const { x, z } = camera.position
        const cos = Math.cos(angle)
        const sin = Math.sin(angle)
        camera.position.x = x * cos - z * sin
        camera.position.z = x * sin + z * cos
        ;(fg as unknown as { cameraPosition(pos: object): void }).cameraPosition(camera.position)
      } catch { /* skip */ }
    }, 16)
    return () => {
      if (autoRotateRef.current) clearInterval(autoRotateRef.current)
    }
  }, [])

  function pauseRotation() {
    userInteractRef.current = true
    if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current)
    resumeTimerRef.current = setTimeout(() => {
      userInteractRef.current = false
    }, 3000)
  }

  function handleNodeClick(node: GraphNode, event: MouseEvent) {
    pauseRotation()
    setHud({
      slug: node.slug,
      convergenceScore: node.convergenceScore,
      contextPct: node.contextPct,
      turnsPerHour: node.turnsPerHour,
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
          .cameraPosition({ x: 0, y: 0, z: 350 }, { x: 0, y: 0, z: 0 }, 1000)
      } catch { /* skip */ }
    }
  }

  const hudNode = hud ? graphData.nodes.find((n) => n.slug === hud.slug) : null
  const hudColor = hudNode ? convergenceColor(hudNode.convergenceScore) : '#00F5FF'

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
        <div className="text-[0.55rem] font-mono text-slate-500 uppercase tracking-widest mb-1">Convergence</div>
        {[
          { label: '≥60 high', color: '#10B981' },
          { label: '30–60 mid', color: '#F59E0B' },
          { label: '<30 low', color: '#EF4444' },
          { label: 'unknown', color: '#94A3B8' },
        ].map(({ label, color }) => (
          <div key={label} className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full" style={{ background: color, boxShadow: `0 0 6px ${color}` }} />
            <span className="text-[0.6rem] font-mono" style={{ color }}>{label}</span>
          </div>
        ))}
        <div className="mt-2 text-[0.55rem] font-mono text-slate-600">Size = context pressure</div>
      </div>

      {/* Timestamp */}
      {computedAt && (
        <div className="absolute top-3 right-3 z-10 text-[0.5rem] font-mono text-slate-600 pointer-events-none">
          computed {new Date(computedAt).toLocaleTimeString()}
        </div>
      )}

      <ForceGraph3DLib
        ref={fgRef}
        graphData={graphData}
        width={containerRef.current?.clientWidth ?? 800}
        height={containerRef.current?.clientHeight ?? 500}
        backgroundColor="rgba(0,0,0,0)"
        nodeLabel={(node) => {
          const n = node as GraphNode
          const conv = n.convergenceScore !== null ? `conv:${n.convergenceScore}` : 'conv:?'
          return `${n.slug} | ${conv} | ctx:${n.contextPct}% | ${n.turnsPerHour}t/h`
        }}
        nodeColor={(node) => convergenceColor((node as GraphNode).convergenceScore)}
        nodeOpacity={0.85}
        nodeResolution={16}
        nodeVal={(node) => nodeSize((node as GraphNode).contextPct)}
        linkColor={(link) => {
          const l = link as GraphLink
          const opacity = Math.round(l.score * 255).toString(16).padStart(2, '0')
          return `#00F5FF${opacity}`
        }}
        linkWidth={(link) => (link as GraphLink).score * 2}
        linkOpacity={1}
        onNodeClick={(node, event) => handleNodeClick(node as GraphNode, event as MouseEvent)}
        // Disable force simulation — nodes use fixed positions (fx/fy/fz)
        d3AlphaDecay={1}
        d3VelocityDecay={1}
      />

      {/* HUD popup */}
      {hud && (
        <div
          className="absolute pointer-events-auto z-20 rounded border px-3 py-2 text-[0.65rem] font-mono flex flex-col gap-1.5"
          style={{
            left: Math.min(hud.x, window.innerWidth - 220),
            top: Math.min(hud.y + 12, window.innerHeight - 140),
            background: 'rgba(4,10,20,0.95)',
            borderColor: `${hudColor}40`,
            backdropFilter: 'blur(8px)',
            minWidth: 180,
          }}
        >
          <div className="flex items-center justify-between gap-4">
            <span className="font-bold text-slate-200">{hud.slug}</span>
            <button onClick={() => setHud(null)} className="text-slate-500 hover:text-slate-200 text-xs leading-none">
              ×
            </button>
          </div>
          <div className="flex items-center gap-2">
            <span
              className="text-[0.6rem] px-1.5 py-0.5 rounded font-bold"
              style={{ color: hudColor, background: `${hudColor}18` }}
            >
              conv: {hud.convergenceScore ?? '—'}
            </span>
            <span className="text-slate-500 text-[0.6rem]">ctx {hud.contextPct}%</span>
          </div>
          <div className="text-slate-500 text-[0.6rem]">{hud.turnsPerHour} turns/hr</div>
          <button
            onClick={() => {
              setHud(null)
              router.push(`/session-health/${encodeURIComponent(hud.slug)}`)
            }}
            className="text-[0.6rem] font-mono px-2 py-1 rounded border w-full text-left transition-colors mt-0.5"
            style={{ borderColor: `${hudColor}40`, color: hudColor, background: `${hudColor}10` }}
          >
            ◎ Session Health
          </button>
        </div>
      )}
    </div>
  )
}
