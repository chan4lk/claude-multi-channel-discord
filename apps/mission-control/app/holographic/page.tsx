'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import Link from 'next/link'
import type { FleetResponse, FleetProject, ProjectState } from '../api/fleet/route'
import type { BacklogResponse, ProjectBacklog } from '../api/backlog/route'
import { useFreshness } from '../../lib/useFreshness'
import FreshnessBadge from '../../components/FreshnessBadge'
import SubPageHeader from '../../components/SubPageHeader'

const STATE_COLOR: Record<ProjectState, string> = {
  active: '#4ADE80',
  idle: '#22D3EE',
  stalled: '#EF4444',
  autonomous: '#A78BFA',
}

function fmtAge(mins: number): string {
  if (mins < 60) return `${Math.round(mins)}m`
  if (mins < 1440) return `${(mins / 60).toFixed(1)}h`
  return `${(mins / 1440).toFixed(1)}d`
}

// ─── Force graph types ───────────────────────────────────────────────────────

interface Node {
  slug: string
  state: ProjectState
  conv: number
  x: number
  y: number
  vx: number
  vy: number
  r: number
}

// Spring physics — no d3, pure RAF loop
function runSpringStep(
  nodes: Node[],
  W: number,
  H: number,
): void {
  const REPULSION = 2800
  const DAMPING = 0.82
  const CENTER_PULL = 0.012

  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i]!
    let fx = 0
    let fy = 0

    // Repulsion between nodes
    for (let j = 0; j < nodes.length; j++) {
      if (i === j) continue
      const b = nodes[j]!
      const dx = a.x - b.x
      const dy = a.y - b.y
      const d2 = dx * dx + dy * dy + 1
      const f = REPULSION / d2
      fx += f * dx
      fy += f * dy
    }

    // Center attraction
    fx += (W / 2 - a.x) * CENTER_PULL
    fy += (H / 2 - a.y) * CENTER_PULL

    a.vx = (a.vx + fx) * DAMPING
    a.vy = (a.vy + fy) * DAMPING
    a.x = Math.max(a.r + 4, Math.min(W - a.r - 4, a.x + a.vx))
    a.y = Math.max(a.r + 4, Math.min(H - a.r - 4, a.y + a.vy))
  }
}

// ─── Sub-components ──────────────────────────────────────────────────────────

interface TooltipData { slug: string; mx: number; my: number }

function ForceGraph({
  projects,
  W,
  H,
}: {
  projects: FleetProject[]
  W: number
  H: number
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const nodesRef = useRef<Node[]>([])
  const rafRef = useRef<number>(0)
  const [tooltip, setTooltip] = useState<TooltipData | null>(null)

  // Initialise nodes once projects change (slug set)
  useEffect(() => {
    const existing = new Map(nodesRef.current.map(n => [n.slug, n]))
    nodesRef.current = projects.map(p => {
      const prev = existing.get(p.slug)
      return {
        slug: p.slug,
        state: p.state,
        conv: p.convergenceScore ?? 0,
        x: prev?.x ?? W / 2 + (Math.random() - 0.5) * 200,
        y: prev?.y ?? H / 2 + (Math.random() - 0.5) * 200,
        vx: prev?.vx ?? 0,
        vy: prev?.vy ?? 0,
        r: Math.max(8, Math.min(22, 8 + (p.convergenceScore ?? 0) * 14)),
      }
    })
  }, [projects, W, H])

  // RAF loop
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    function draw() {
      if (!canvas || !ctx) return
      runSpringStep(nodesRef.current, W, H)

      ctx.clearRect(0, 0, W, H)

      for (const node of nodesRef.current) {
        const color = STATE_COLOR[node.state] ?? '#64748B'

        // Glow
        const grd = ctx.createRadialGradient(node.x, node.y, node.r * 0.3, node.x, node.y, node.r * 1.6)
        grd.addColorStop(0, color + '33')
        grd.addColorStop(1, 'transparent')
        ctx.beginPath()
        ctx.arc(node.x, node.y, node.r * 1.6, 0, Math.PI * 2)
        ctx.fillStyle = grd
        ctx.fill()

        // Node circle
        ctx.beginPath()
        ctx.arc(node.x, node.y, node.r, 0, Math.PI * 2)
        ctx.fillStyle = color + '22'
        ctx.fill()
        ctx.strokeStyle = color
        ctx.lineWidth = 1.5
        ctx.stroke()

        // Label
        ctx.fillStyle = color
        ctx.font = `9px monospace`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        const label = node.slug.length > 10 ? node.slug.slice(0, 9) + '…' : node.slug
        ctx.fillText(label, node.x, node.y)
      }

      rafRef.current = requestAnimationFrame(draw)
    }

    rafRef.current = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(rafRef.current)
  }, [W, H])

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    const hit = nodesRef.current.find(n => {
      const dx = n.x - mx
      const dy = n.y - my
      return Math.sqrt(dx * dx + dy * dy) <= n.r + 4
    })
    setTooltip(hit ? { slug: hit.slug, mx, my } : null)
  }, [])

  const hitNode = tooltip ? nodesRef.current.find(n => n.slug === tooltip.slug) : null

  return (
    <div className="relative" style={{ width: W, height: H }}>
      <canvas
        ref={canvasRef}
        width={W}
        height={H}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setTooltip(null)}
        style={{ display: 'block', cursor: tooltip ? 'pointer' : 'default' }}
      />
      {tooltip && hitNode && (
        <div
          className="absolute z-10 pointer-events-none rounded border text-xs font-mono px-3 py-2 shadow-xl"
          style={{
            left: Math.min(tooltip.mx + 12, W - 180),
            top: Math.max(0, tooltip.my - 8),
            background: '#0f1e35',
            borderColor: STATE_COLOR[hitNode.state] ?? '#334155',
            color: '#E2E8F0',
            minWidth: 160,
          }}
        >
          <div style={{ color: STATE_COLOR[hitNode.state], fontWeight: 700 }}>{hitNode.slug}</div>
          <div>State: {hitNode.state}</div>
          <div>Conv: {(hitNode.conv * 100).toFixed(0)}%</div>
          <div style={{ color: '#475569', marginTop: 2 }}>Click → feed</div>
        </div>
      )}
    </div>
  )
}

function NarrativePanel({ projects }: { projects: FleetProject[] }) {
  return (
    <div
      className="overflow-y-auto text-xs font-mono"
      style={{ color: '#94A3B8', lineHeight: 1.8 }}
    >
      {projects.length === 0 && (
        <p style={{ color: '#334155' }}>No projects.</p>
      )}
      {projects.map(p => {
        const color = STATE_COLOR[p.state] ?? '#64748B'
        const conv = p.convergenceScore != null ? `conv ${(p.convergenceScore * 100).toFixed(0)}%` : ''
        const ctx = p.contextUsagePct != null ? `ctx ${Math.round(p.contextUsagePct)}%` : ''
        const goal = p.goalText ? ` | goal: ${p.goalText.slice(0, 60)}${p.goalText.length > 60 ? '…' : ''}` : ''
        const parts = [fmtAge(p.ageMins), conv, ctx].filter(Boolean).join(' · ')
        return (
          <Link
            key={p.slug}
            href={`/feed?slug=${encodeURIComponent(p.slug)}`}
            className="block hover:opacity-80"
            style={{ borderLeft: `2px solid ${color}`, paddingLeft: 8, marginBottom: 4 }}
          >
            <span style={{ color }}>{p.slug}</span>
            <span style={{ color: '#475569' }}> [{p.state}]</span>
            {goal && <span style={{ color: '#64748B' }}>{goal}</span>}
            {parts && <span style={{ color: '#334155' }}> · {parts}</span>}
          </Link>
        )
      })}
    </div>
  )
}

function BacklogBar({ backlogData }: { backlogData: BacklogResponse | null }) {
  const projects = backlogData?.projects ?? []
  if (projects.length === 0) return null
  return (
    <div
      className="flex gap-2 overflow-x-auto py-2 px-1"
      style={{ borderTop: '1px solid #1E293B' }}
    >
      {projects.map((pb: ProjectBacklog) => (
        <Link
          key={pb.slug}
          href={`/backlog?project=${encodeURIComponent(pb.slug)}`}
          className="flex-shrink-0 rounded border text-xs font-mono px-2 py-1 hover:opacity-80"
          style={{
            borderColor: pb.pendingCount > 0 ? '#A78BFA' : '#1E293B',
            background: pb.pendingCount > 0 ? 'rgba(167,139,250,0.08)' : 'transparent',
            color: pb.pendingCount > 0 ? '#A78BFA' : '#475569',
          }}
        >
          <span className="font-bold">{pb.slug}</span>
          <span style={{ color: '#64748B', marginLeft: 4 }}>
            {pb.pendingCount}▷ / {pb.items.filter(i => i.status === 'done').length}✓
          </span>
        </Link>
      ))}
    </div>
  )
}

// ─── Main page ───────────────────────────────────────────────────────────────

export default function HolographicPage() {
  const { data: fleetData, isStale, lastError, lastSuccessAt } = useFreshness<FleetResponse>('/api/fleet', 60_000)
  const [backlog, setBacklog] = useState<BacklogResponse | null>(null)
  const [holo, setHolo] = useState(false)

  const projects = fleetData?.projects ?? []
  const loading = fleetData === null && lastError === null

  // Fetch backlog separately (not via useFreshness — one-shot is fine here)
  useEffect(() => {
    fetch('/api/backlog')
      .then(r => r.json())
      .then((d: BacklogResponse) => setBacklog(d))
      .catch(() => {})
  }, [])

  // H key toggle
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'h' || e.key === 'H') setHolo(v => !v)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const activeCount = projects.filter(p => p.state === 'active').length
  const pendingCount = backlog?.projects.reduce((s, pb) => s + pb.pendingCount, 0) ?? 0

  const GRAPH_W = 520
  const GRAPH_H = 400

  return (
    <div className="min-h-screen p-4 md:p-6" style={{ background: '#080f1c', color: '#E2E8F0' }}>
      <SubPageHeader title="Holographic Overview">
        <FreshnessBadge isStale={isStale} lastError={lastError} lastSuccessAt={lastSuccessAt} />
      </SubPageHeader>

      {loading && (
        <div className="text-center py-20 text-slate-600 font-mono text-sm animate-pulse">Initializing hologram…</div>
      )}

      {!loading && !holo && (
        /* Compact summary mode */
        <div>
          <p className="text-xs text-slate-500 mb-5">
            Fleet command overview. Press <kbd className="px-1 py-0.5 rounded text-xs" style={{ background: '#1E293B', color: '#94A3B8', border: '1px solid #334155' }}>H</kbd> or click below to go holographic.
          </p>
          <div className="flex gap-6 mb-6 flex-wrap">
            <div className="rounded border p-4" style={{ borderColor: '#1E293B', background: '#0d1a2e', minWidth: 130 }}>
              <div className="text-2xl font-bold font-mono" style={{ color: '#22D3EE' }}>{projects.length}</div>
              <div className="text-xs text-slate-500 mt-1">Total projects</div>
            </div>
            <div className="rounded border p-4" style={{ borderColor: '#1E293B', background: '#0d1a2e', minWidth: 130 }}>
              <div className="text-2xl font-bold font-mono" style={{ color: '#4ADE80' }}>{activeCount}</div>
              <div className="text-xs text-slate-500 mt-1">Active turns</div>
            </div>
            <div className="rounded border p-4" style={{ borderColor: '#1E293B', background: '#0d1a2e', minWidth: 130 }}>
              <div className="text-2xl font-bold font-mono" style={{ color: '#A78BFA' }}>{pendingCount}</div>
              <div className="text-xs text-slate-500 mt-1">Pending proposals</div>
            </div>
          </div>
          <button
            onClick={() => setHolo(true)}
            className="rounded border px-4 py-2 text-sm font-mono hover:opacity-80 transition-opacity"
            style={{ borderColor: '#A78BFA', color: '#A78BFA', background: 'rgba(167,139,250,0.08)' }}
          >
            ⬡ Go Holographic
          </button>
        </div>
      )}

      {!loading && holo && (
        /* Holographic mode */
        <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 140px)', gap: 0 }}>
          <div className="flex items-center gap-3 mb-2">
            <button
              onClick={() => setHolo(false)}
              className="text-xs font-mono rounded border px-2 py-1 hover:opacity-80"
              style={{ borderColor: '#334155', color: '#475569' }}
            >
              ← Compact [H]
            </button>
            <span className="text-xs text-slate-600 font-mono">
              {projects.length} projects · {activeCount} active · {pendingCount} pending
            </span>
          </div>

          {/* Main split: left = force graph, right = narrative */}
          <div className="flex gap-3 flex-1 overflow-hidden">
            {/* Left: force graph */}
            <div
              className="rounded border flex-shrink-0"
              style={{
                borderColor: '#1E293B',
                background: '#080f1c',
                overflow: 'hidden',
                width: GRAPH_W,
                height: GRAPH_H,
              }}
            >
              <ForceGraph projects={projects} W={GRAPH_W} H={GRAPH_H} />
            </div>

            {/* Right: narrative */}
            <div
              className="flex-1 rounded border p-3 overflow-y-auto"
              style={{ borderColor: '#1E293B', background: '#0a1628' }}
            >
              <div className="text-xs font-mono text-slate-500 mb-3 pb-2" style={{ borderBottom: '1px solid #1E293B' }}>
                Fleet Narrative
              </div>
              <NarrativePanel projects={projects} />
            </div>
          </div>

          {/* Bottom bar: backlog chips */}
          <div className="rounded border mt-2" style={{ borderColor: '#1E293B', background: '#080f1c' }}>
            <div className="text-xs font-mono text-slate-600 px-3 pt-2">Proposal Pipeline</div>
            <BacklogBar backlogData={backlog} />
          </div>
        </div>
      )}
    </div>
  )
}
