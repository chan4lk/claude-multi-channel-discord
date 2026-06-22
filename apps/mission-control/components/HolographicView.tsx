'use client'

import { useEffect, useState, useCallback } from 'react'
import dynamic from 'next/dynamic'
import type { FleetNarrativeResponse, NarrativeProject } from '../app/api/fleet-narrative/route'

const ProjectGraph = dynamic(() => import('./ProjectGraph'), { ssr: false })

function formatAge(mins: number): string {
  if (mins > 9000) return 'no turns'
  if (mins >= 60) return `${Math.floor(mins / 60)}h ago`
  if (mins >= 1) return `${Math.round(mins)}m ago`
  return 'just now'
}

function stateColor(state: string): string {
  if (state === 'active') return '#4ADE80'
  if (state === 'stalled') return '#EF4444'
  if (state === 'autonomous') return '#A855F7'
  return '#00F5FF'
}

function NarrativeRow({ p }: { p: NarrativeProject }) {
  const color = stateColor(p.state)
  return (
    <div
      className="flex items-start gap-2 px-3 py-2 rounded border border-transparent hover:border-cyber-cyan/10 hover:bg-cyber-cyan/3 transition-all"
      style={{ borderColor: `${color}12` }}
    >
      <span
        className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0"
        style={{ background: color, boxShadow: `0 0 5px ${color}` }}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-[0.7rem] font-mono font-bold" style={{ color }}>{p.slug}</span>
          <span className="text-[0.55rem] font-mono text-slate-600">{formatAge(p.ageMins)}</span>
        </div>
        {p.memoryHeadline && (
          <div className="text-[0.6rem] font-mono text-slate-400 truncate">{p.memoryHeadline}</div>
        )}
        {p.goalSnippet && (
          <div className="text-[0.55rem] font-mono text-slate-600 truncate mt-0.5">⊙ {p.goalSnippet}</div>
        )}
        {!p.memoryHeadline && !p.goalSnippet && (
          <div className="text-[0.55rem] font-mono text-slate-700 italic">no memory context</div>
        )}
      </div>
    </div>
  )
}

export default function HolographicView({ narrow }: { narrow?: boolean }) {
  const [narrative, setNarrative] = useState<FleetNarrativeResponse | null>(null)

  const fetchNarrative = useCallback(async () => {
    try {
      const res = await fetch('/api/fleet-narrative')
      if (!res.ok) return
      setNarrative(await res.json() as FleetNarrativeResponse)
    } catch { /* skip */ }
  }, [])

  useEffect(() => {
    fetchNarrative()
    const id = setInterval(fetchNarrative, 30_000)
    return () => clearInterval(id)
  }, [fetchNarrative])

  const projects = narrative?.projects ?? []
  const backlog = narrative?.backlogCounts ?? { pending: 0, done: 0, total: 0 }

  if (narrow) {
    // Stacked layout for small viewports
    return (
      <div className="flex flex-col gap-4 w-full">
        <div className="h-64 rounded-lg border border-cyber-cyan/10 overflow-hidden bg-black/30">
          <ProjectGraph showBacklog={false} />
        </div>
        <NarrativePanel projects={projects} />
        <PipelineBar backlog={backlog} />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 w-full h-full">
      {/* Main split */}
      <div className="flex gap-4 flex-1 min-h-0" style={{ height: 'calc(100vh - 200px)' }}>
        {/* Left: Force graph */}
        <div
          className="flex-1 rounded-lg border border-cyber-cyan/12 overflow-hidden bg-black/40"
          style={{ minWidth: 0 }}
        >
          <div className="px-3 py-1.5 border-b border-cyber-cyan/8 flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-sm bg-cyber-cyan/60 shrink-0" />
            <span className="text-[0.6rem] font-mono uppercase tracking-widest text-slate-500">Fleet Graph</span>
          </div>
          <div className="h-[calc(100%-32px)]">
            <ProjectGraph showBacklog={false} />
          </div>
        </div>

        {/* Right: Fleet Narrative */}
        <div
          className="w-80 shrink-0 flex flex-col rounded-lg border border-cyber-cyan/12 bg-black/40 overflow-hidden"
        >
          <div className="px-3 py-1.5 border-b border-cyber-cyan/8 flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-sm bg-purple-400/60 shrink-0" />
            <span className="text-[0.6rem] font-mono uppercase tracking-widest text-slate-500">Fleet Narrative</span>
            <span className="text-[0.55rem] font-mono text-slate-700 ml-auto">{projects.length} projects</span>
          </div>
          <div className="flex-1 overflow-y-auto scrollbar-thin py-1">
            {projects.length === 0 ? (
              <div className="px-3 py-4 text-[0.6rem] font-mono text-slate-700 italic">no projects</div>
            ) : (
              projects.map((p) => <NarrativeRow key={p.slug} p={p} />)
            )}
          </div>
        </div>
      </div>

      {/* Bottom: Pipeline bar */}
      <PipelineBar backlog={backlog} />
    </div>
  )
}

function NarrativePanel({ projects }: { projects: NarrativeProject[] }) {
  return (
    <div className="rounded-lg border border-cyber-cyan/12 bg-black/40 overflow-hidden">
      <div className="px-3 py-1.5 border-b border-cyber-cyan/8">
        <span className="text-[0.6rem] font-mono uppercase tracking-widest text-slate-500">Fleet Narrative</span>
      </div>
      <div className="py-1 max-h-60 overflow-y-auto">
        {projects.map((p) => <NarrativeRow key={p.slug} p={p} />)}
      </div>
    </div>
  )
}

function PipelineBar({ backlog }: { backlog: { pending: number; done: number; total: number } }) {
  const pct = backlog.total > 0 ? Math.round((backlog.done / backlog.total) * 100) : 0
  return (
    <div className="rounded-lg border border-cyber-cyan/12 bg-black/40 px-4 py-2.5 flex items-center gap-6 flex-wrap">
      <div className="text-[0.6rem] font-mono uppercase tracking-widest text-slate-500 shrink-0">
        Proposal Pipeline
      </div>
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-sm bg-amber-400/60" />
          <span className="text-[0.65rem] font-mono text-amber-400">{backlog.pending} pending</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-sm bg-green-400/60" />
          <span className="text-[0.65rem] font-mono text-green-400">{backlog.done} done</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[0.55rem] font-mono text-slate-600">total {backlog.total}</span>
        </div>
      </div>
      {/* Progress bar */}
      <div className="flex-1 min-w-[100px]">
        <div className="h-1.5 rounded-full overflow-hidden" style={{ background: '#1e293b' }}>
          <div
            className="h-full rounded-full transition-all duration-700"
            style={{
              width: `${pct}%`,
              background: 'linear-gradient(to right, #10B981, #00F5FF)',
            }}
          />
        </div>
      </div>
      <span className="text-[0.6rem] font-mono text-slate-500 shrink-0">{pct}% complete</span>
    </div>
  )
}
