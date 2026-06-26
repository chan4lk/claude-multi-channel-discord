'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import ForceGraph3DLib from 'react-force-graph-3d'
import type { ConstellationNode, ConstellationEdge, ConstellationResponse } from '../app/api/constellation/route'

const PLATFORM_COLOR: Record<string, string> = {
  discord:  '#00F5FF',
  teams:    '#818CF8',
  whatsapp: '#4ADE80',
}

// Node size: 2-14 based on avg turn duration (0 = 2, 60s = 14)
function nodeSize(avgTurnMs: number): number {
  const capMs = 60_000
  const clamped = Math.min(avgTurnMs, capMs)
  return 2 + (clamped / capMs) * 12
}

interface HudState {
  slug: string
  platform: 'discord' | 'teams' | 'whatsapp'
  convergenceScore: number | null
  contextPct: number
  turnsPerHour: number
  avgTurnDurationMs: number
  activity24h: number
  isActive: boolean
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

function fmtDuration(ms: number): string {
  if (ms < 1000) return '<1s'
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`
  return `${Math.round(ms / 60_000)}m`
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
  const pulseRef = useRef(0)
  const [pulsePhase, setPulsePhase] = useState(0)

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
      const links: GraphLink[] = data.edges.map((e) => ({ ...e }))
      setGraphData({ nodes, links })
      setComputedAt(data.computedAt)
    } catch { /* skip */ }
  }, [])

  useEffect(() => {
    fetchConstellation()
    const id = setInterval(fetchConstellation, 5 * 60 * 1000)
    return () => clearInterval(id)
  }, [fetchConstellation])

  // Auto-orbit (~0.3 rpm)
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

  // Pulse animation tick (~60fps)
  useEffect(() => {
    const id = setInterval(() => {
      pulseRef.current = (pulseRef.current + 0.05) % (Math.PI * 2)
      setPulsePhase(pulseRef.current)
    }, 16)
    return () => clearInterval(id)
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
      platform: node.platform,
      convergenceScore: node.convergenceScore,
      contextPct: node.contextPct,
      turnsPerHour: node.turnsPerHour,
      avgTurnDurationMs: node.avgTurnDurationMs,
      activity24h: node.activity24h,
      isActive: node.isActive,
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
  const hudColor = hudNode ? PLATFORM_COLOR[hudNode.platform] ?? '#00F5FF' : '#00F5FF'

  // Pulse factor for active node glow: sin wave → 0.6–1.0
  const pulseFactor = 0.6 + 0.4 * Math.abs(Math.sin(pulsePhase))

  return (
    <div
      ref={containerRef}
      className="w-full h-full"
      style={{ minHeight: 400 }}
      onMouseDown={pauseRotation}
      onWheel={pauseRotation}
      onDoubleClick={handleDblClick}
    >
      {/* Platform legend */}
      <div className="absolute top-3 left-3 z-10 flex flex-col gap-1 pointer-events-none">
        <div className="text-[0.55rem] font-mono text-slate-500 uppercase tracking-widest mb-1">Platform</div>
        {[
          { label: 'Discord', color: PLATFORM_COLOR.discord },
          { label: 'Teams', color: PLATFORM_COLOR.teams },
          { label: 'WhatsApp', color: PLATFORM_COLOR.whatsapp },
        ].map(({ label, color }) => (
          <div key={label} className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full" style={{ background: color, boxShadow: `0 0 6px ${color}` }} />
            <span className="text-[0.6rem] font-mono" style={{ color }}>{label}</span>
          </div>
        ))}
        <div className="mt-2 text-[0.55rem] font-mono text-slate-600">Size = avg turn duration</div>
        <div className="text-[0.55rem] font-mono text-slate-600">Pulse = active session</div>
      </div>

      {/* Timestamp */}
      {computedAt && (
        <div className="absolute top-3 right-3 z-10 text-[0.5rem] font-mono text-slate-600 pointer-events-none">
          computed {new Date(computedAt).toLocaleTimeString()}
        </div>
      )}

      {/* Active pulse rings overlay */}
      {graphData.nodes.filter((n) => n.isActive).map((n) => (
        <div
          key={`pulse-${n.slug}`}
          className="absolute pointer-events-none rounded-full"
          style={{
            width: 24,
            height: 24,
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            border: `2px solid ${PLATFORM_COLOR[n.platform] ?? '#00F5FF'}`,
            opacity: pulseFactor * 0.5,
            boxShadow: `0 0 ${Math.round(pulseFactor * 12)}px ${PLATFORM_COLOR[n.platform] ?? '#00F5FF'}`,
          }}
        />
      ))}

      <ForceGraph3DLib
        ref={fgRef}
        graphData={graphData}
        width={containerRef.current?.clientWidth ?? 800}
        height={containerRef.current?.clientHeight ?? 500}
        backgroundColor="rgba(0,0,0,0)"
        nodeLabel={(node) => {
          const n = node as GraphNode
          const dur = n.avgTurnDurationMs > 0 ? `avg:${fmtDuration(n.avgTurnDurationMs)}` : 'avg:?'
          return `${n.slug} [${n.platform}] | ${dur} | 24h:${n.activity24h} turns | ctx:${n.contextPct}%`
        }}
        nodeColor={(node) => {
          const n = node as GraphNode
          const base = PLATFORM_COLOR[n.platform] ?? '#00F5FF'
          if (n.isActive) return base
          return base + '99'
        }}
        nodeOpacity={0.9}
        nodeResolution={16}
        nodeVal={(node) => nodeSize((node as GraphNode).avgTurnDurationMs)}
        linkColor={(link) => {
          const l = link as GraphLink
          const opacity = Math.round(l.score * 255).toString(16).padStart(2, '0')
          return `#64748B${opacity}`
        }}
        linkWidth={(link) => (link as GraphLink).score * 1.5}
        linkOpacity={1}
        onNodeClick={(node, event) => handleNodeClick(node as GraphNode, event as MouseEvent)}
        d3AlphaDecay={1}
        d3VelocityDecay={1}
      />

      {/* HUD popup */}
      {hud && (
        <div
          className="absolute pointer-events-auto z-20 rounded border px-3 py-2 text-[0.65rem] font-mono flex flex-col gap-1.5"
          style={{
            left: Math.min(hud.x, window.innerWidth - 240),
            top: Math.min(hud.y + 12, window.innerHeight - 180),
            background: 'rgba(4,10,20,0.95)',
            borderColor: `${hudColor}40`,
            backdropFilter: 'blur(8px)',
            minWidth: 200,
          }}
        >
          <div className="flex items-center justify-between gap-4">
            <span className="font-bold text-slate-200">{hud.slug}</span>
            <div className="flex items-center gap-2">
              {hud.isActive && (
                <span className="text-[0.5rem] font-mono px-1 py-0.5 rounded" style={{ color: '#4ADE80', background: '#4ADE8018', border: '1px solid #4ADE8040' }}>
                  ● LIVE
                </span>
              )}
              <button onClick={() => setHud(null)} className="text-slate-500 hover:text-slate-200 text-xs leading-none">×</button>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className="text-[0.6rem] px-1.5 py-0.5 rounded font-bold capitalize"
              style={{ color: hudColor, background: `${hudColor}18` }}
            >
              {hud.platform}
            </span>
            <span className="text-slate-500 text-[0.6rem]">ctx {hud.contextPct}%</span>
          </div>
          <div className="text-slate-400 text-[0.6rem]">
            avg turn: <span style={{ color: hudColor }}>{fmtDuration(hud.avgTurnDurationMs)}</span>
          </div>
          <div className="text-slate-400 text-[0.6rem]">
            24h turns: <span className="text-slate-300">{hud.activity24h}</span>
            &nbsp;·&nbsp;
            {hud.turnsPerHour} t/hr
          </div>
          {hud.convergenceScore !== null && (
            <div className="text-slate-500 text-[0.6rem]">conv: {hud.convergenceScore}</div>
          )}
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
