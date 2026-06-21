'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import * as d3 from 'd3'
import type { FleetProject, ProjectState } from '../app/api/fleet/route'
import type { ProjectBacklog } from '../app/api/backlog/route'
import type { HealthScore } from '../app/api/health/[slug]/route'
import type { PipelineCard, PipelineStage } from '../app/api/pipeline/route'
import TokenBudgetGauge from './TokenBudgetGauge'
import { useFleet, type ToolEvent } from './FleetContext'

const STATE_COLORS: Record<ProjectState, string> = {
  idle: '#00F5FF',
  active: '#4ADE80',
  stalled: '#EF4444',
  autonomous: '#A855F7',
}

const NODE_RADIUS = 22
const HALO_OFFSET = 8

interface GraphNode extends FleetProject {
  x: number
  y: number
  vx?: number
  vy?: number
  fx?: number | null
  fy?: number | null
}

interface DetailDrawer {
  slug: string
  state: ProjectState
  ageMins: number
  backlog: ProjectBacklog | null
}

interface Props {
  showBacklog: boolean
  onNodeClick?: (slug: string) => void
}

const STORAGE_KEY = 'mc_graph_positions'
const THOUGHT_STORAGE_KEY = 'mc_graph_thought'
const PARTICLE_LIFETIME_MS = 3000
const MAX_PARTICLES_PER_NODE = 3

const TOOL_CATEGORIES: Record<string, { color: string; short: string }> = {
  Read: { color: '#22D3EE', short: 'Read' },
  Edit: { color: '#22D3EE', short: 'Edit' },
  Write: { color: '#22D3EE', short: 'Write' },
  Glob: { color: '#22D3EE', short: 'Glob' },
  Grep: { color: '#22D3EE', short: 'Grep' },
  NotebookEdit: { color: '#22D3EE', short: 'NbEdit' },
  WebFetch: { color: '#F59E0B', short: 'Fetch' },
  WebSearch: { color: '#F59E0B', short: 'Search' },
  Agent: { color: '#A78BFA', short: 'Agent' },
  Workflow: { color: '#A78BFA', short: 'Workflow' },
  Task: { color: '#A78BFA', short: 'Task' },
}

function getToolStyle(toolName: string): { color: string; short: string } {
  return TOOL_CATEGORIES[toolName] ?? { color: '#6B7280', short: toolName.slice(0, 6) }
}

interface ThoughtParticle {
  id: number
  slug: string
  toolName: string
  x: number
  y: number
  spawnedAt: number
  color: string
  short: string
}

const HEALTH_TIERS: [string, string][] = [
  ['#4ADE80', '≥80'],
  ['#F59E0B', '50–79'],
  ['#EF4444', '<50'],
]

const PIPELINE_STAGE_COLOR: Record<PipelineStage, string> = {
  propose:   '#F59E0B',
  plan:      '#60A5FA',
  build:     '#F97316',
  verify:    '#34D399',
  pr:        '#4ADE80',
  completed: '#22D3EE',
}

interface ProposalDatum {
  key: string
  slug: string
  name: string
  stage: PipelineStage
  x: number
  y: number
}

function PulseRingLegend() {
  return (
    <div className="mt-1 flex flex-col gap-0.5 pl-0.5">
      <span className="text-[0.5rem] font-mono text-slate-600 uppercase tracking-wider mb-0.5">health ring</span>
      {HEALTH_TIERS.map(([c, label]) => (
        <div key={label} className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full border" style={{ borderColor: c, background: 'transparent' }} />
          <span className="text-[0.5rem] font-mono" style={{ color: c, opacity: 0.75 }}>{label}</span>
        </div>
      ))}
      <span className="text-[0.5rem] font-mono text-slate-600 mt-0.5">inner ring = activity</span>
    </div>
  )
}

function loadPositions(): Record<string, { x: number; y: number }> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
  } catch {
    return {}
  }
}

function savePositions(nodes: GraphNode[]) {
  const pos: Record<string, { x: number; y: number }> = {}
  for (const n of nodes) {
    if (n.x && n.y) pos[n.slug] = { x: n.x, y: n.y }
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(pos))
}

export default function ProjectGraph({ showBacklog }: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [projects, setProjects] = useState<FleetProject[]>([])
  const [backlogMap, setBacklogMap] = useState<Map<string, ProjectBacklog>>(new Map())
  const [healthMap, setHealthMap] = useState<Map<string, HealthScore>>(new Map())
  const [showPulse, setShowPulse] = useState<boolean>(() => {
    try { return localStorage.getItem('mc_graph_pulse') === '1' } catch { return false }
  })
  const [showThought, setShowThought] = useState<boolean>(() => {
    try { return localStorage.getItem(THOUGHT_STORAGE_KEY) === '1' } catch { return false }
  })
  const [particles, setParticles] = useState<ThoughtParticle[]>([])
  const particleIdRef = useRef(0)
  const { toolEvents } = useFleet()
  const [drawer, setDrawer] = useState<DetailDrawer | null>(null)
  const [drawerTab, setDrawerTab] = useState<'info' | 'diff' | 'prompt'>('info')
  const [diffData, setDiffData] = useState<{ log: string; diff: string } | null>(null)
  const [diffLoading, setDiffLoading] = useState(false)
  const [promptContent, setPromptContent] = useState<string>('')
  const [promptDraft, setPromptDraft] = useState<string>('')
  const [promptLastModified, setPromptLastModified] = useState<string | null>(null)
  const [promptSaving, setPromptSaving] = useState(false)
  const [promptSaveMsg, setPromptSaveMsg] = useState<string | null>(null)
  const [promptLoading, setPromptLoading] = useState(false)
  const [dims, setDims] = useState({ w: 800, h: 500 })
  const simRef = useRef<d3.Simulation<GraphNode, undefined> | null>(null)
  const nodesRef = useRef<GraphNode[]>([])
  const pipelineCardsRef = useRef<PipelineCard[]>([])
  const [budgetInput, setBudgetInput] = useState('')
  const [budgetSaving, setBudgetSaving] = useState(false)
  const [showActionMenu, setShowActionMenu] = useState(false)
  const actionMenuRef = useRef<HTMLDivElement | null>(null)

  // Measure container
  useEffect(() => {
    const el = svgRef.current?.parentElement
    if (!el) return
    const obs = new ResizeObserver((entries) => {
      const { width, height } = entries[0]!.contentRect
      setDims({ w: Math.floor(width), h: Math.max(400, Math.floor(height)) })
    })
    obs.observe(el)
    setDims({ w: Math.floor(el.clientWidth), h: Math.max(400, Math.floor(el.clientHeight || 500)) })
    return () => obs.disconnect()
  }, [])

  // Fetch fleet data
  const fetchFleet = useCallback(async () => {
    try {
      const res = await fetch('/api/fleet')
      if (res.ok) {
        const data = await res.json()
        setProjects(data.projects ?? [])
      }
    } catch {}
  }, [])

  // Fetch health data for pulse mode
  const fetchHealth = useCallback(async () => {
    try {
      const res = await fetch('/api/health')
      if (res.ok) {
        const data = await res.json()
        const map = new Map<string, HealthScore>()
        for (const h of data.projects ?? []) {
          map.set(h.slug, h)
        }
        setHealthMap(map)
      }
    } catch {}
  }, [])

  // Fetch backlog data
  const fetchBacklog = useCallback(async () => {
    try {
      const res = await fetch('/api/backlog')
      if (res.ok) {
        const data = await res.json()
        const map = new Map<string, ProjectBacklog>()
        for (const p of data.projects ?? []) {
          map.set(p.slug, p)
        }
        setBacklogMap(map)
      }
    } catch {}
  }, [])

  // Fetch pipeline cards
  const fetchPipeline = useCallback(async () => {
    try {
      const res = await fetch('/api/pipeline')
      if (res.ok) {
        const data: PipelineCard[] = await res.json()
        pipelineCardsRef.current = data
        if (nodesRef.current.length > 0) renderFrame(nodesRef.current)
      }
    } catch {}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    fetchFleet()
    fetchBacklog()
    fetchPipeline()
    const i1 = setInterval(fetchFleet, 30_000)
    const i2 = setInterval(fetchBacklog, 30_000)
    const i3 = setInterval(fetchPipeline, 60_000)
    return () => { clearInterval(i1); clearInterval(i2); clearInterval(i3) }
  }, [fetchFleet, fetchBacklog, fetchPipeline])

  // Fetch health data when pulse mode enabled; clear rings when disabled
  useEffect(() => {
    if (!showPulse) {
      if (svgRef.current) {
        d3.select(svgRef.current).selectAll('.node-activity-ring').remove()
        d3.select(svgRef.current).selectAll('.node-health-ring').remove()
      }
      return
    }
    fetchHealth()
    const i = setInterval(fetchHealth, 30_000)
    return () => clearInterval(i)
  }, [showPulse, fetchHealth])

  // Re-render when pulse state or health data changes
  useEffect(() => {
    if (nodesRef.current.length > 0) renderFrame(nodesRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showPulse, healthMap])

  // Spawn thought particles on tool events (P54)
  const lastProcessedToolEventId = useRef(-1)
  useEffect(() => {
    if (!showThought || toolEvents.length === 0) return
    const latest = toolEvents[toolEvents.length - 1]
    if (!latest || latest.id <= lastProcessedToolEventId.current) return
    lastProcessedToolEventId.current = latest.id

    const node = nodesRef.current.find((n) => n.slug === latest.slug)
    if (!node || node.x == null || node.y == null) return

    const { color, short } = getToolStyle(latest.toolName)
    const now = Date.now()

    setParticles((prev) => {
      const nodeParticles = prev.filter((p) => p.slug === latest.slug)
      let next = prev
      if (nodeParticles.length >= MAX_PARTICLES_PER_NODE) {
        // Drop oldest for this node
        const oldestId = nodeParticles[0].id
        next = prev.filter((p) => p.id !== oldestId)
      }
      return [
        ...next,
        {
          id: ++particleIdRef.current,
          slug: latest.slug,
          toolName: latest.toolName,
          x: node.x,
          y: node.y,
          spawnedAt: now,
          color,
          short,
        },
      ]
    })

    // Auto-remove after lifetime
    const timer = setTimeout(() => {
      setParticles((prev) => prev.filter((p) => p.spawnedAt !== now || p.slug !== latest.slug))
    }, PARTICLE_LIFETIME_MS + 100)
    return () => clearTimeout(timer)
  }, [toolEvents, showThought])

  // Prune expired particles every second
  useEffect(() => {
    if (!showThought) { setParticles([]); return }
    const i = setInterval(() => {
      const cutoff = Date.now() - PARTICLE_LIFETIME_MS - 200
      setParticles((prev) => prev.filter((p) => p.spawnedAt > cutoff))
    }, 1000)
    return () => clearInterval(i)
  }, [showThought])

  // 'T' key toggles thought stream
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (
        (e.key === 't' || e.key === 'T') &&
        !e.ctrlKey && !e.metaKey && !e.altKey &&
        !(document.activeElement instanceof HTMLInputElement) &&
        !(document.activeElement instanceof HTMLTextAreaElement)
      ) {
        setShowThought((prev) => {
          const next = !prev
          try { localStorage.setItem(THOUGHT_STORAGE_KEY, next ? '1' : '0') } catch {}
          return next
        })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Build / update D3 simulation
  useEffect(() => {
    if (!svgRef.current || projects.length === 0) return

    const saved = loadPositions()

    // Merge incoming projects with existing node positions
    const prevMap = new Map(nodesRef.current.map((n) => [n.slug, n]))
    const nodes: GraphNode[] = projects.map((p) => {
      const prev = prevMap.get(p.slug)
      const s = saved[p.slug]
      return {
        ...p,
        x: prev?.x ?? s?.x ?? dims.w / 2 + (Math.random() - 0.5) * 200,
        y: prev?.y ?? s?.y ?? dims.h / 2 + (Math.random() - 0.5) * 200,
        vx: prev?.vx ?? 0,
        vy: prev?.vy ?? 0,
      }
    })
    nodesRef.current = nodes

    // Stop old simulation
    simRef.current?.stop()

    const sim = d3
      .forceSimulation(nodes)
      .force('charge', d3.forceManyBody().strength(-220))
      .force('center', d3.forceCenter(dims.w / 2, dims.h / 2).strength(0.08))
      .force('collision', d3.forceCollide(NODE_RADIUS + HALO_OFFSET + 12))
      .alphaDecay(0.04)
      .on('tick', () => {
        // Clamp to bounds
        for (const n of nodes) {
          n.x = Math.max(NODE_RADIUS + 20, Math.min(dims.w - NODE_RADIUS - 20, n.x))
          n.y = Math.max(NODE_RADIUS + 20, Math.min(dims.h - NODE_RADIUS - 20, n.y))
        }
        renderFrame(nodes)
      })
      .on('end', () => {
        savePositions(nodes)
      })

    simRef.current = sim

    // Drag behavior
    const svg = d3.select(svgRef.current)
    svg.selectAll<SVGCircleElement, GraphNode>('.node-hit')
      .data(nodes, (d) => d.slug)
      .call(
        d3.drag<SVGCircleElement, GraphNode>()
          .on('start', (event, d) => {
            if (!event.active) sim.alphaTarget(0.3).restart()
            d.fx = d.x
            d.fy = d.y
          })
          .on('drag', (event, d) => {
            d.fx = event.x
            d.fy = event.y
          })
          .on('end', (event, d) => {
            if (!event.active) sim.alphaTarget(0)
            d.fx = null
            d.fy = null
            savePositions(nodes)
          })
      )

    return () => { sim.stop() }
  }, [projects, dims])

  function renderFrame(nodes: GraphNode[]) {
    const svg = d3.select(svgRef.current!)

    // Activity pulse rings (P46)
    if (showPulse) {
      svg.selectAll<SVGCircleElement, GraphNode>('.node-activity-ring')
        .data(nodes, (d) => d.slug)
        .join(
          (enter) => enter.append('circle').attr('class', 'node-activity-ring').attr('pointer-events', 'none'),
          (update) => update,
          (exit) => exit.remove()
        )
        .attr('cx', (d) => d.x)
        .attr('cy', (d) => d.y)
        .attr('r', NODE_RADIUS + 6)
        .attr('fill', 'none')
        .attr('stroke', (d) => STATE_COLORS[d.state])
        .attr('stroke-width', 1.5)
        .attr('style', (d) => {
          const speed = d.ageMins < 5 ? 0.6 : d.ageMins < 30 ? 1.2 : 2.8
          return `animation: activity-pulse ${speed}s ease-in-out infinite;`
        })

      svg.selectAll<SVGCircleElement, GraphNode>('.node-health-ring')
        .data(nodes, (d) => d.slug)
        .join(
          (enter) => enter.append('circle').attr('class', 'node-health-ring').attr('pointer-events', 'none'),
          (update) => update,
          (exit) => exit.remove()
        )
        .attr('cx', (d) => d.x)
        .attr('cy', (d) => d.y)
        .attr('r', (d) => {
          const h = healthMap.get(d.slug)
          if (!h || h.insufficientData) return NODE_RADIUS + 13
          return NODE_RADIUS + 8 + (h.score / 100) * 8
        })
        .attr('fill', 'none')
        .attr('stroke', (d) => {
          const h = healthMap.get(d.slug)
          if (!h || h.insufficientData) return '#64748B'
          if (h.score >= 80) return '#4ADE80'
          if (h.score >= 50) return '#F59E0B'
          return '#EF4444'
        })
        .attr('stroke-width', 1)
        .attr('opacity', 0.55)
    } else {
      svg.selectAll('.node-activity-ring').remove()
      svg.selectAll('.node-health-ring').remove()
    }

    // Halos (P5)
    svg.selectAll<SVGCircleElement, GraphNode>('.node-halo')
      .data(nodes, (d) => d.slug)
      .join(
        (enter) => enter.append('circle').attr('class', 'node-halo'),
        (update) => update,
        (exit) => exit.remove()
      )
      .attr('cx', (d) => d.x)
      .attr('cy', (d) => d.y)
      .attr('r', (d) => {
        const b = backlogMap.get(d.slug)
        if (!showBacklog || !b || b.pendingCount === 0) return 0
        return NODE_RADIUS + HALO_OFFSET + Math.min(b.pendingCount * 2, 12)
      })
      .attr('fill', 'none')
      .attr('stroke', (d) => {
        const b = backlogMap.get(d.slug)
        const count = b?.pendingCount ?? 0
        if (count >= 5) return '#F59E0B'
        if (count >= 2) return '#A855F780'
        return '#A855F740'
      })
      .attr('stroke-width', (d) => {
        const b = backlogMap.get(d.slug)
        const count = b?.pendingCount ?? 0
        return count >= 5 ? 2.5 : 1.5
      })

    // Node circles
    svg.selectAll<SVGCircleElement, GraphNode>('.node-circle')
      .data(nodes, (d) => d.slug)
      .join(
        (enter) => enter.append('circle').attr('class', 'node-circle').attr('cursor', 'pointer'),
        (update) => update,
        (exit) => exit.remove()
      )
      .attr('cx', (d) => d.x)
      .attr('cy', (d) => d.y)
      .attr('r', NODE_RADIUS)
      .attr('fill', (d) => `${STATE_COLORS[d.state]}18`)
      .attr('stroke', (d) => STATE_COLORS[d.state])
      .attr('stroke-width', 2)
      .on('click', (_, d) => {
        const b = backlogMap.get(d.slug) ?? null
        setDrawer({ slug: d.slug, state: d.state, ageMins: d.ageMins, backlog: b })
      })

    // Pulse ring for stalled
    svg.selectAll<SVGCircleElement, GraphNode>('.node-pulse')
      .data(nodes.filter((n) => n.state === 'stalled'), (d) => d.slug)
      .join(
        (enter) => enter.append('circle').attr('class', 'node-pulse').attr('pointer-events', 'none'),
        (update) => update,
        (exit) => exit.remove()
      )
      .attr('cx', (d) => d.x)
      .attr('cy', (d) => d.y)
      .attr('r', NODE_RADIUS + 4)
      .attr('fill', 'none')
      .attr('stroke', '#EF4444')
      .attr('stroke-width', 1.5)
      .attr('opacity', 0.5)

    // Labels
    svg.selectAll<SVGTextElement, GraphNode>('.node-label')
      .data(nodes, (d) => d.slug)
      .join(
        (enter) => enter.append('text').attr('class', 'node-label').attr('pointer-events', 'none'),
        (update) => update,
        (exit) => exit.remove()
      )
      .attr('x', (d) => d.x)
      .attr('y', (d) => d.y + NODE_RADIUS + 14)
      .attr('text-anchor', 'middle')
      .attr('fill', (d) => STATE_COLORS[d.state])
      .attr('font-size', '9px')
      .attr('font-family', 'JetBrains Mono, monospace')
      .attr('opacity', 0.85)
      .text((d) => d.slug.length > 12 ? d.slug.slice(0, 10) + '…' : d.slug)

    // State letter inside node
    svg.selectAll<SVGTextElement, GraphNode>('.node-state')
      .data(nodes, (d) => d.slug)
      .join(
        (enter) => enter.append('text').attr('class', 'node-state').attr('pointer-events', 'none'),
        (update) => update,
        (exit) => exit.remove()
      )
      .attr('x', (d) => d.x)
      .attr('y', (d) => d.y + 5)
      .attr('text-anchor', 'middle')
      .attr('fill', (d) => STATE_COLORS[d.state])
      .attr('font-size', '11px')
      .attr('font-family', 'JetBrains Mono, monospace')
      .attr('font-weight', 'bold')
      .text((d) => d.state[0]!.toUpperCase())

    // Proposal diamond nodes — small diamonds orbiting project nodes
    const proposalData: ProposalDatum[] = []
    const activePipeline = pipelineCardsRef.current.filter((c) => c.stage !== 'completed')
    for (const node of nodes) {
      const cards = activePipeline.filter((c) => c.slug === node.slug)
      const count = cards.length
      if (count === 0) continue
      cards.slice(0, 5).forEach((card, i) => {
        const angle = (i / count) * Math.PI * 2 - Math.PI / 2
        const dist = NODE_RADIUS + 22
        proposalData.push({
          key: `${node.slug}::${card.name}`,
          slug: node.slug,
          name: card.name,
          stage: card.stage,
          x: node.x + Math.cos(angle) * dist,
          y: node.y + Math.sin(angle) * dist,
        })
      })
    }

    svg.selectAll<SVGRectElement, ProposalDatum>('.proposal-diamond')
      .data(proposalData, (d) => d.key)
      .join(
        (enter) => enter.append('rect').attr('class', 'proposal-diamond').attr('pointer-events', 'all').attr('cursor', 'pointer'),
        (update) => update,
        (exit) => exit.remove()
      )
      .attr('width', 9)
      .attr('height', 9)
      .attr('rx', 1)
      .attr('x', (d) => d.x - 4.5)
      .attr('y', (d) => d.y - 4.5)
      .attr('transform', (d) => `rotate(45, ${d.x}, ${d.y})`)
      .attr('fill', (d) => PIPELINE_STAGE_COLOR[d.stage] + '22')
      .attr('stroke', (d) => PIPELINE_STAGE_COLOR[d.stage])
      .attr('stroke-width', 1.5)
      .on('click', (event, d) => {
        event.stopPropagation()
        const params = new URLSearchParams(window.location.search)
        params.set('spotlight', d.slug)
        window.history.pushState(null, '', `?${params.toString()}`)
        window.dispatchEvent(new PopStateEvent('popstate'))
      })

    svg.selectAll<SVGTitleElement, ProposalDatum>('.proposal-title')
      .data(proposalData, (d) => d.key)
      .join(
        (enter) => enter.append('title').attr('class', 'proposal-title'),
        (update) => update,
        (exit) => exit.remove()
      )
      .text((d) => `${d.name} [${d.stage}]`)

    // Edges from project node to proposal diamonds
    svg.selectAll<SVGLineElement, ProposalDatum>('.proposal-edge')
      .data(proposalData, (d) => d.key)
      .join(
        (enter) => enter.append('line').attr('class', 'proposal-edge').lower().attr('pointer-events', 'none'),
        (update) => update,
        (exit) => exit.remove()
      )
      .attr('x1', (d) => {
        const node = nodes.find((n) => n.slug === d.slug)
        return node?.x ?? d.x
      })
      .attr('y1', (d) => {
        const node = nodes.find((n) => n.slug === d.slug)
        return node?.y ?? d.y
      })
      .attr('x2', (d) => d.x)
      .attr('y2', (d) => d.y)
      .attr('stroke', (d) => PIPELINE_STAGE_COLOR[d.stage] + '40')
      .attr('stroke-width', 0.8)

    // Hit-area for drag (transparent, on top)
    svg.selectAll<SVGCircleElement, GraphNode>('.node-hit')
      .data(nodes, (d) => d.slug)
      .join(
        (enter) => enter.append('circle').attr('class', 'node-hit').attr('cursor', 'grab'),
        (update) => update,
        (exit) => exit.remove()
      )
      .attr('cx', (d) => d.x)
      .attr('cy', (d) => d.y)
      .attr('r', NODE_RADIUS)
      .attr('fill', 'transparent')
      .attr('stroke', 'none')
      .on('click', (_, d) => {
        const b = backlogMap.get(d.slug) ?? null
        setDrawer({ slug: d.slug, state: d.state, ageMins: d.ageMins, backlog: b })
      })
  }

  useEffect(() => {
    if (!drawer || drawerTab !== 'diff') return
    setDiffLoading(true)
    setDiffData(null)
    fetch(`/api/diff/${encodeURIComponent(drawer.slug)}`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => setDiffData(data))
      .catch(() => setDiffData(null))
      .finally(() => setDiffLoading(false))
  }, [drawer?.slug, drawerTab])

  useEffect(() => {
    if (!drawer || drawerTab !== 'prompt') return
    setPromptLoading(true)
    fetch(`/api/projects/${encodeURIComponent(drawer.slug)}/claude-md`)
      .then((r) => r.ok ? r.json() : null)
      .then((data: { content: string; lastModified: string } | null) => {
        if (data) {
          setPromptContent(data.content)
          setPromptDraft(data.content)
          setPromptLastModified(data.lastModified)
        }
      })
      .catch(() => {})
      .finally(() => setPromptLoading(false))
  }, [drawer?.slug, drawerTab])

  async function savePrompt() {
    if (!drawer || promptSaving) return
    setPromptSaving(true)
    setPromptSaveMsg(null)
    try {
      const r = await fetch(`/api/projects/${encodeURIComponent(drawer.slug)}/claude-md`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: promptDraft }),
      })
      if (r.ok) {
        setPromptContent(promptDraft)
        setPromptSaveMsg('Saved ✓')
        setTimeout(() => setPromptSaveMsg(null), 2000)
      } else {
        setPromptSaveMsg('Save failed')
      }
    } catch {
      setPromptSaveMsg('Save failed')
    } finally {
      setPromptSaving(false)
    }
  }

  function formatAge(mins: number): string {
    if (mins >= 60) return `${Math.floor(mins / 60)}h ${mins % 60}m`
    if (mins > 9000) return 'no transcript'
    return `${mins}m`
  }

  useEffect(() => {
    if (!showActionMenu) return
    function onClickOutside(e: MouseEvent) {
      if (actionMenuRef.current && !actionMenuRef.current.contains(e.target as Node)) {
        setShowActionMenu(false)
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setShowActionMenu(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClickOutside)
      document.removeEventListener('keydown', onKey)
    }
  }, [showActionMenu])

  return (
    <div className="relative w-full h-full min-h-[400px]">
      {/* Legend */}
      <div className="absolute top-3 left-3 flex flex-col gap-1 z-10">
        {(Object.entries(STATE_COLORS) as [ProjectState, string][]).map(([state, color]) => (
          <div key={state} className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full border" style={{ borderColor: color, background: `${color}20` }} />
            <span className="text-[0.6rem] font-mono uppercase tracking-wider" style={{ color, opacity: 0.8 }}>{state}</span>
          </div>
        ))}
        {showBacklog && (
          <div className="flex items-center gap-1.5 mt-1">
            <span className="w-2.5 h-2.5 rounded-full border border-purple-400/60" style={{ background: 'transparent' }} />
            <span className="text-[0.6rem] font-mono uppercase tracking-wider text-purple-400/70">backlog</span>
          </div>
        )}

        {/* Pulse mode toggle */}
        <button
          onClick={() => setShowPulse((v) => {
            const next = !v
            try { localStorage.setItem('mc_graph_pulse', next ? '1' : '0') } catch {}
            return next
          })}
          className="mt-2 flex items-center gap-1.5 group"
          title="Toggle activity pulse rings"
        >
          <span
            className="w-2.5 h-2.5 rounded-full border transition-colors"
            style={{
              borderColor: showPulse ? '#A855F7' : '#334155',
              background: showPulse ? '#A855F720' : 'transparent',
            }}
          />
          <span
            className="text-[0.6rem] font-mono uppercase tracking-wider transition-colors"
            style={{ color: showPulse ? '#A855F7' : '#334155' }}
          >
            pulse
          </span>
        </button>

        {/* Pulse ring mini-legend */}
        {showPulse && <PulseRingLegend />}

        {/* Thought stream toggle (P54) */}
        <button
          onClick={() => setShowThought((v) => {
            const next = !v
            try { localStorage.setItem(THOUGHT_STORAGE_KEY, next ? '1' : '0') } catch {}
            return next
          })}
          className="mt-1 flex items-center gap-1.5 group"
          title="Toggle thought stream (T)"
        >
          <span
            className="w-2.5 h-2.5 rounded-full border transition-colors"
            style={{
              borderColor: showThought ? '#22D3EE' : '#334155',
              background: showThought ? '#22D3EE20' : 'transparent',
            }}
          />
          <span
            className="text-[0.6rem] font-mono uppercase tracking-wider transition-colors"
            style={{ color: showThought ? '#22D3EE' : '#334155' }}
          >
            thought
          </span>
        </button>
        {showThought && (
          <div className="mt-0.5 flex flex-col gap-0.5 pl-0.5">
            <span className="text-[0.5rem] font-mono text-slate-600 uppercase tracking-wider mb-0.5">tool stream</span>
            {[
              { color: '#22D3EE', label: 'file ops' },
              { color: '#F59E0B', label: 'web' },
              { color: '#A78BFA', label: 'agent' },
              { color: '#6B7280', label: 'other' },
            ].map(({ color, label }) => (
              <div key={label} className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />
                <span className="text-[0.5rem] font-mono" style={{ color, opacity: 0.75 }}>{label}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {projects.length === 0 ? (
        <div className="flex items-center justify-center h-full min-h-[400px] text-slate-600 flex-col gap-2">
          <div className="text-3xl opacity-20">⬡</div>
          <span className="text-xs font-mono">No projects to display</span>
        </div>
      ) : (
        <>
          <svg
            ref={svgRef}
            width={dims.w}
            height={dims.h}
            className="w-full h-full"
            style={{ background: 'transparent' }}
          >
            <defs>
              <filter id="glow-cyan">
                <feGaussianBlur stdDeviation="3" result="blur" />
                <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
              </filter>
              <filter id="glow-red">
                <feGaussianBlur stdDeviation="4" result="blur" />
                <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
              </filter>
            </defs>
            {/* Pulse animation via CSS keyframe injected inline */}
            <style>{`
              .node-pulse { animation: graph-pulse 1.5s ease-in-out infinite; }
              @keyframes graph-pulse {
                0%, 100% { opacity: 0.15; r: ${NODE_RADIUS + 4}; }
                50% { opacity: 0.6; r: ${NODE_RADIUS + 9}; }
              }
              .node-activity-ring { animation: activity-pulse 1.5s ease-in-out infinite; }
              @keyframes activity-pulse {
                0%, 100% { opacity: 0.12; }
                50% { opacity: 0.55; }
              }
            `}</style>
          </svg>

          {/* Thought stream particles (P54) */}
          {showThought && particles.map((p) => {
            const elapsed = Date.now() - p.spawnedAt
            const progress = Math.min(elapsed / PARTICLE_LIFETIME_MS, 1)
            return (
              <div
                key={p.id}
                className="pointer-events-none absolute"
                style={{
                  left: p.x - 16,
                  top: p.y - NODE_RADIUS - 8,
                  animation: `thought-rise ${PARTICLE_LIFETIME_MS}ms ease-out forwards`,
                  color: p.color,
                  fontSize: '0.55rem',
                  fontFamily: 'JetBrains Mono, monospace',
                  fontWeight: 700,
                  letterSpacing: '0.05em',
                  textShadow: `0 0 6px ${p.color}`,
                  opacity: 1 - progress * 0.8,
                  zIndex: 15,
                  whiteSpace: 'nowrap',
                  userSelect: 'none',
                }}
              >
                → {p.short}
              </div>
            )
          })}
          <style>{`
            @keyframes thought-rise {
              0% { transform: translateY(0); opacity: 1; }
              100% { transform: translateY(-32px); opacity: 0; }
            }
          `}</style>
        </>
      )}

      {/* Detail Drawer */}
      {drawer && (
        <div
          className="absolute inset-y-0 right-0 w-72 flex flex-col z-20"
          style={{
            background: 'rgba(4,10,20,0.97)',
            borderLeft: `1px solid ${STATE_COLORS[drawer.state]}30`,
            backdropFilter: 'blur(8px)',
          }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b shrink-0" style={{ borderColor: `${STATE_COLORS[drawer.state]}20` }}>
            <span className="text-xs font-bold font-mono text-slate-200">{drawer.slug}</span>
            <div className="flex items-center gap-2">
              {/* Action menu */}
              <div className="relative" ref={actionMenuRef}>
                <button
                  onClick={() => setShowActionMenu((v) => !v)}
                  className="text-slate-500 hover:text-slate-200 text-sm leading-none px-1"
                  title="Actions"
                >
                  ⋯
                </button>
                {showActionMenu && (
                  <div
                    className="absolute right-0 top-6 z-30 flex flex-col rounded border py-1 text-[0.65rem] font-mono"
                    style={{ background: 'rgba(4,10,20,0.98)', borderColor: `${STATE_COLORS[drawer.state]}30`, minWidth: '160px' }}
                  >
                    <a
                      href={`/metrics?slug=${encodeURIComponent(drawer.slug)}`}
                      className="px-3 py-1.5 text-slate-400 hover:text-cyber-cyan hover:bg-white/5 transition-colors"
                      onClick={() => setShowActionMenu(false)}
                    >
                      View Metrics →
                    </a>
                    <a
                      href={`/timeline?slug=${encodeURIComponent(drawer.slug)}`}
                      className="px-3 py-1.5 text-slate-400 hover:text-cyber-cyan hover:bg-white/5 transition-colors"
                      onClick={() => setShowActionMenu(false)}
                    >
                      View Timeline →
                    </a>
                    <a
                      href={`/reports#${encodeURIComponent(drawer.slug)}`}
                      className="px-3 py-1.5 text-slate-400 hover:text-cyber-cyan hover:bg-white/5 transition-colors"
                      onClick={() => setShowActionMenu(false)}
                    >
                      View in Report →
                    </a>
                  </div>
                )}
              </div>
              <button onClick={() => { setDrawer(null); setDrawerTab('info'); setShowActionMenu(false) }} className="text-slate-500 hover:text-slate-200">×</button>
            </div>
          </div>
          {/* Tabs */}
          <div className="flex border-b shrink-0" style={{ borderColor: `${STATE_COLORS[drawer.state]}15` }}>
            {(['info', 'diff', 'prompt'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setDrawerTab(tab)}
                className="flex-1 py-1.5 text-[0.6rem] font-mono uppercase tracking-wider transition-colors"
                style={{
                  color: drawerTab === tab ? STATE_COLORS[drawer.state] : '#475569',
                  borderBottom: drawerTab === tab ? `1px solid ${STATE_COLORS[drawer.state]}` : '1px solid transparent',
                }}
              >
                {tab}
              </button>
            ))}
          </div>

          {/* Info tab */}
          {drawerTab === 'info' && (
            <div className="p-4 flex flex-col gap-3 overflow-y-auto">
              <div className="flex items-center gap-2">
                <span
                  className="text-[0.6rem] font-mono font-bold px-1.5 py-0.5 rounded uppercase"
                  style={{
                    color: STATE_COLORS[drawer.state],
                    background: `${STATE_COLORS[drawer.state]}18`,
                    border: `1px solid ${STATE_COLORS[drawer.state]}40`,
                  }}
                >
                  {drawer.state}
                </span>
                <span className="text-[0.6rem] font-mono text-slate-500">{formatAge(drawer.ageMins)} ago</span>
              </div>

              {drawer.backlog && drawer.backlog.items.length > 0 && (
                <div>
                  <p className="text-[0.6rem] font-mono text-slate-500 uppercase tracking-wider mb-2">
                    Backlog ({drawer.backlog.pendingCount} pending)
                  </p>
                  <div className="flex flex-col gap-1">
                    {drawer.backlog.items.slice(0, 10).map((item, i) => (
                      <div key={i} className="flex items-start gap-1.5">
                        <span className="text-[0.6rem] mt-0.5" style={{ color: item.status === 'done' ? '#4ADE80' : '#F59E0B' }}>
                          {item.status === 'done' ? '✓' : '○'}
                        </span>
                        <span className="text-[0.6rem] font-mono text-slate-400 leading-tight">{item.title}</span>
                      </div>
                    ))}
                    {drawer.backlog.items.length > 10 && (
                      <span className="text-[0.55rem] font-mono text-slate-600">+{drawer.backlog.items.length - 10} more</span>
                    )}
                  </div>
                </div>
              )}
              {(!drawer.backlog || drawer.backlog.items.length === 0) && (
                <p className="text-[0.6rem] font-mono text-slate-600">No backlog items found</p>
              )}

              {/* Monthly Budget section */}
              {(() => {
                const drawerFleetProject = projects.find((p) => p.slug === drawer.slug)
                return (
                  <div>
                    <p className="text-[0.55rem] font-mono text-slate-600 uppercase tracking-wider mb-1">Monthly Budget</p>
                    {drawerFleetProject?.monthlyTokenBudget ? (
                      <div className="flex items-center gap-3">
                        <TokenBudgetGauge
                          used={drawerFleetProject.monthlyTokensUsed ?? 0}
                          budget={drawerFleetProject.monthlyTokenBudget}
                          size={48}
                        />
                        <div className="text-xs font-mono text-slate-500">
                          <p>{(drawerFleetProject.monthlyTokensUsed ?? 0).toLocaleString()} / {drawerFleetProject.monthlyTokenBudget.toLocaleString()} tokens</p>
                          <p className="text-[0.55rem] text-slate-600">Resets 1st of each month</p>
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs font-mono text-slate-700 italic">no budget configured</p>
                    )}
                    {/* Set / clear budget */}
                    <div className="flex items-center gap-1.5 mt-2">
                      <input
                        type="number"
                        min={0}
                        placeholder="tokens"
                        value={budgetInput}
                        onChange={(e) => setBudgetInput(e.target.value)}
                        className="w-24 text-[0.6rem] font-mono bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-slate-300 focus:outline-none focus:border-slate-500"
                      />
                      <button
                        disabled={budgetSaving}
                        onClick={async () => {
                          const val = budgetInput.trim() === '' ? null : Number(budgetInput)
                          if (val !== null && (isNaN(val) || val < 0)) return
                          setBudgetSaving(true)
                          try {
                            await fetch(`/api/projects/${encodeURIComponent(drawer.slug)}/budget`, {
                              method: 'PATCH',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ budget: val }),
                            })
                            setBudgetInput('')
                            // Refresh fleet data to update gauge
                            fetchFleet()
                          } finally {
                            setBudgetSaving(false)
                          }
                        }}
                        className="text-[0.6rem] font-mono px-2 py-0.5 rounded border border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-500 transition-colors disabled:opacity-50"
                      >
                        {budgetSaving ? '…' : budgetInput.trim() === '' ? 'Clear' : 'Set'}
                      </button>
                    </div>
                  </div>
                )
              })()}
            </div>
          )}

          {/* Diff tab */}
          {drawerTab === 'diff' && (
            <div className="flex flex-col gap-2 p-3 overflow-y-auto flex-1">
              {diffLoading && (
                <p className="text-[0.6rem] font-mono text-slate-500 text-center py-4">Loading diff…</p>
              )}
              {!diffLoading && diffData && (
                <>
                  {diffData.log && (
                    <div className="mb-2">
                      <p className="text-[0.55rem] font-mono text-slate-600 uppercase tracking-wider mb-1">Recent commits</p>
                      <pre className="text-[0.55rem] font-mono text-slate-400 whitespace-pre-wrap break-all leading-relaxed">
                        {diffData.log}
                      </pre>
                    </div>
                  )}
                  {diffData.diff ? (
                    <div>
                      <p className="text-[0.55rem] font-mono text-slate-600 uppercase tracking-wider mb-1">Diff (HEAD~5..HEAD)</p>
                      <pre className="text-[0.5rem] font-mono whitespace-pre-wrap break-all leading-relaxed">
                        {diffData.diff.split('\n').map((line, i) => {
                          let color = '#475569'
                          if (line.startsWith('+') && !line.startsWith('+++')) color = '#4ADE80'
                          else if (line.startsWith('-') && !line.startsWith('---')) color = '#EF4444'
                          else if (line.startsWith('@@')) color = '#A855F7'
                          else if (line.startsWith('diff ') || line.startsWith('index ') || line.startsWith('+++') || line.startsWith('---')) color = '#00F5FF'
                          return <span key={i} style={{ color, display: 'block' }}>{line || ' '}</span>
                        })}
                      </pre>
                    </div>
                  ) : (
                    <p className="text-[0.6rem] font-mono text-slate-600 text-center py-4">
                      {diffData.log ? 'No changes in last 5 commits' : 'Not a git repository or no commits'}
                    </p>
                  )}
                </>
              )}
              {!diffLoading && !diffData && (
                <p className="text-[0.6rem] font-mono text-cyber-crimson/70 text-center py-4">Failed to load diff</p>
              )}
            </div>
          )}

          {/* Prompt tab */}
          {drawerTab === 'prompt' && (
            <div className="flex flex-col gap-2 p-3 overflow-y-auto flex-1">
              {promptLoading && (
                <p className="text-[0.6rem] font-mono text-slate-500 text-center py-4">Loading…</p>
              )}
              {!promptLoading && (
                <>
                  {promptLastModified && (
                    <p className="text-[0.5rem] font-mono text-slate-600">
                      Last modified: {new Date(promptLastModified).toLocaleString()}
                    </p>
                  )}
                  <textarea
                    value={promptDraft}
                    onChange={(e) => setPromptDraft(e.target.value)}
                    onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); savePrompt() } }}
                    className="flex-1 min-h-[300px] text-[0.6rem] font-mono bg-slate-900 border border-slate-700 rounded p-2 text-slate-300 focus:outline-none focus:border-slate-500 resize-none leading-relaxed"
                    placeholder="CLAUDE.md content…"
                    spellCheck={false}
                  />
                  <div className="flex items-center justify-between">
                    <span
                      className="text-[0.5rem] font-mono"
                      style={{
                        color: promptDraft.length > 8000 ? '#EF4444' : promptDraft.length > 6000 ? '#F59E0B' : '#475569'
                      }}
                    >
                      {promptDraft.length.toLocaleString()} chars
                      {promptDraft.length > 8000 && ' — very large'}
                      {promptDraft.length > 6000 && promptDraft.length <= 8000 && ' — large'}
                    </span>
                    <div className="flex items-center gap-2">
                      {promptSaveMsg && (
                        <span
                          className="text-[0.55rem] font-mono"
                          style={{ color: promptSaveMsg.includes('✓') ? '#4ADE80' : '#EF4444' }}
                        >
                          {promptSaveMsg}
                        </span>
                      )}
                      <button
                        disabled={promptSaving || promptDraft === promptContent}
                        onClick={savePrompt}
                        className="text-[0.6rem] font-mono px-2 py-0.5 rounded border border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-500 transition-colors disabled:opacity-40"
                      >
                        {promptSaving ? '…' : 'Save'}
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
