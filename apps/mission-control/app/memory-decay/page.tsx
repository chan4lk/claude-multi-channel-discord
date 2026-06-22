'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import type { MemoryDecayResponse, ProjectMemoryDecay, MemoryFile } from '../api/memory-decay/route'

type SortMode = 'stale' | 'count' | 'alpha'

function decayColor(ageDays: number): string {
  if (ageDays <= 7) return '#4ADE80'
  if (ageDays <= 30) return '#F59E0B'
  return '#EF4444'
}

function DecayBar({ ageDays, decayPct }: { ageDays: number; decayPct: number }) {
  const color = decayColor(ageDays)
  return (
    <div className="h-1.5 w-full rounded-full overflow-hidden" style={{ background: '#1e293b' }}>
      <div
        className="h-full rounded-full transition-all duration-500"
        style={{
          width: `${decayPct}%`,
          background: color,
          boxShadow: `0 0 4px ${color}60`,
        }}
      />
    </div>
  )
}

function MemoryRow({ m }: { m: MemoryFile }) {
  const color = decayColor(m.ageDays)
  return (
    <div className="flex flex-col gap-1 py-1.5 border-t border-white/5 first:border-t-0">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[0.6rem] font-mono text-slate-300 truncate">{m.name}</span>
        <span className="text-[0.55rem] font-mono shrink-0 tabular-nums" style={{ color }}>
          {m.ageDays}d
        </span>
      </div>
      <DecayBar ageDays={m.ageDays} decayPct={m.decayPct} />
      {m.body && (
        <p className="text-[0.5rem] font-mono text-slate-600 truncate">{m.body}</p>
      )}
    </div>
  )
}

function ProjectCard({ project }: { project: ProjectMemoryDecay }) {
  const [expanded, setExpanded] = useState(false)

  const freshPct = project.memoryCount > 0 ? (project.freshCount / project.memoryCount) * 100 : 0
  const stalePct = project.memoryCount > 0 ? (project.staleCount / project.memoryCount) * 100 : 0
  const midPct = 100 - freshPct - stalePct

  return (
    <div
      className="rounded-lg border p-3 flex flex-col gap-2"
      style={{
        background: 'rgba(0,245,255,0.015)',
        borderColor: project.refreshNeeded ? 'rgba(239,68,68,0.25)' : 'rgba(255,255,255,0.06)',
      }}
    >
      {/* Card header */}
      <div className="flex items-center justify-between gap-2">
        <Link
          href={`/projects/${encodeURIComponent(project.slug)}`}
          className="text-[0.65rem] font-mono font-bold text-cyber-cyan hover:underline truncate"
        >
          {project.slug}
        </Link>
        <div className="flex items-center gap-1.5 shrink-0">
          {project.refreshNeeded && (
            <span
              className="text-[0.45rem] font-mono px-1 py-0.5 rounded border uppercase tracking-wider"
              style={{ color: '#EF4444', borderColor: '#EF444440', background: '#EF444410' }}
            >
              refresh needed
            </span>
          )}
          <span className="text-[0.5rem] font-mono text-slate-500">
            {project.memoryCount} mem
          </span>
        </div>
      </div>

      {/* Age stats */}
      <div className="flex items-center gap-3">
        <div className="flex flex-col items-center">
          <span className="text-[0.6rem] font-mono font-bold tabular-nums" style={{ color: '#22D3EE' }}>
            {project.avgAgeDays}d
          </span>
          <span className="text-[0.45rem] font-mono text-slate-600 uppercase tracking-wider">avg</span>
        </div>
        <div className="flex flex-col items-center">
          <span className="text-[0.6rem] font-mono tabular-nums" style={{ color: '#EF4444' }}>
            {project.oldestAgeDays}d
          </span>
          <span className="text-[0.45rem] font-mono text-slate-600 uppercase tracking-wider">oldest</span>
        </div>
        <div className="flex flex-col items-center">
          <span className="text-[0.6rem] font-mono tabular-nums" style={{ color: '#4ADE80' }}>
            {project.newestAgeDays}d
          </span>
          <span className="text-[0.45rem] font-mono text-slate-600 uppercase tracking-wider">newest</span>
        </div>
      </div>

      {/* Distribution bar: fresh | mid | stale */}
      <div className="h-2 rounded-full overflow-hidden flex" style={{ background: '#0f172a' }}>
        {freshPct > 0 && (
          <div
            className="h-full transition-all duration-500"
            style={{ width: `${freshPct}%`, background: '#4ADE80' }}
            title={`${project.freshCount} fresh (≤7d)`}
          />
        )}
        {midPct > 0 && (
          <div
            className="h-full transition-all duration-500"
            style={{ width: `${midPct}%`, background: '#F59E0B' }}
            title={`${project.memoryCount - project.freshCount - project.staleCount} moderate (7–30d)`}
          />
        )}
        {stalePct > 0 && (
          <div
            className="h-full transition-all duration-500"
            style={{ width: `${stalePct}%`, background: '#EF4444' }}
            title={`${project.staleCount} stale (>30d)`}
          />
        )}
      </div>
      <div className="flex gap-3 text-[0.45rem] font-mono text-slate-600">
        <span style={{ color: '#4ADE80' }}>■ fresh {project.freshCount}</span>
        <span style={{ color: '#F59E0B' }}>■ mid {project.memoryCount - project.freshCount - project.staleCount}</span>
        <span style={{ color: '#EF4444' }}>■ stale {project.staleCount}</span>
      </div>

      {/* Expand/collapse */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="text-[0.5rem] font-mono text-slate-600 hover:text-slate-400 transition-colors text-left"
      >
        {expanded ? '▲ hide memories' : `▼ show ${project.memories.length} memories`}
      </button>

      {expanded && (
        <div className="border-t border-white/5 pt-1">
          {project.memories.map((m) => (
            <MemoryRow key={m.filename} m={m} />
          ))}
        </div>
      )}
    </div>
  )
}

export default function MemoryDecayPage() {
  const [data, setData] = useState<MemoryDecayResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [sortMode, setSortMode] = useState<SortMode>('stale')

  useEffect(() => {
    function load() {
      setLoading(true)
      fetch('/api/memory-decay')
        .then((r) => r.json())
        .then((d: MemoryDecayResponse) => { setData(d); setLoading(false) })
        .catch(() => setLoading(false))
    }
    load()
    const id = setInterval(load, 60_000)
    return () => clearInterval(id)
  }, [])

  const sortedProjects = (data?.projects ?? []).slice().sort((a, b) => {
    if (sortMode === 'stale') return b.avgAgeDays - a.avgAgeDays
    if (sortMode === 'count') return b.memoryCount - a.memoryCount
    return a.slug.localeCompare(b.slug)
  })

  return (
    <div className="min-h-dvh flex flex-col font-mono" style={{ background: '#0a0f1e' }}>
      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-cyber-cyan/12 bg-[#0a0f1e]/90 backdrop-blur-md px-4 py-2.5">
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-cyber-cyan/40 to-transparent" />
        <div className="flex items-center gap-3 flex-wrap">
          <div>
            <span className="text-[0.65rem] font-mono font-bold text-cyber-cyan uppercase tracking-widest">
              Memory Decay
            </span>
            <p className="text-[0.5rem] font-mono text-slate-600 mt-0.5">
              Track memory staleness across all projects
            </p>
          </div>

          <div className="flex-1" />

          {/* Sort controls */}
          <div className="flex items-center gap-1">
            <span className="text-[0.5rem] font-mono text-slate-600 uppercase tracking-wider mr-1">Sort:</span>
            {([['stale', 'Most Stale'], ['count', 'Most Memories'], ['alpha', 'A–Z']] as [SortMode, string][]).map(([mode, label]) => (
              <button
                key={mode}
                onClick={() => setSortMode(mode)}
                className="text-[0.5rem] px-2 py-0.5 rounded border transition-all"
                style={{
                  borderColor: sortMode === mode ? '#22D3EE' : '#374151',
                  color: sortMode === mode ? '#22D3EE' : '#6B7280',
                  background: sortMode === mode ? 'rgba(34,211,238,0.08)' : 'transparent',
                }}
              >
                {label}
              </button>
            ))}
          </div>

          {data && (
            <span className="text-[0.5rem] font-mono text-slate-700">
              {data.projects.length} projects · {new Date(data.generatedAt).toLocaleTimeString()}
            </span>
          )}
        </div>
      </header>

      <main className="flex-1 p-4 flex flex-col gap-6">
        {loading && !data ? (
          <div className="flex items-center justify-center py-20">
            <span className="text-cyan-400/40 text-sm animate-pulse">Scanning memory files…</span>
          </div>
        ) : (
          <>
            {/* Most Stale section */}
            {(data?.mostStale ?? []).length > 0 && (
              <section>
                <div className="flex items-center gap-2 mb-3">
                  <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: '#EF4444', clipPath: 'polygon(0 0,100% 0,100% 100%,0 100%)' }} />
                  <h2 className="text-[0.55rem] font-mono uppercase tracking-widest text-slate-400 font-semibold">
                    Most Stale
                  </h2>
                  <div className="flex-1 h-px" style={{ background: 'linear-gradient(to right, rgba(239,68,68,0.2), transparent)' }} />
                </div>
                <div className="overflow-x-auto rounded-lg border border-white/8" style={{ background: 'rgba(239,68,68,0.01)' }}>
                  <table className="w-full border-collapse">
                    <thead>
                      <tr>
                        <th className="px-3 py-2 text-left text-[0.5rem] font-mono uppercase tracking-wider text-slate-600">Project</th>
                        <th className="px-3 py-2 text-left text-[0.5rem] font-mono uppercase tracking-wider text-slate-600">Memory Name</th>
                        <th className="px-3 py-2 text-right text-[0.5rem] font-mono uppercase tracking-wider text-slate-600">Age</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data!.mostStale.map((m, i) => (
                        <tr key={i} className="border-t border-white/5 hover:bg-white/[0.02] transition-colors">
                          <td className="px-3 py-2">
                            <Link
                              href={`/projects/${encodeURIComponent(m.slug)}`}
                              className="text-[0.6rem] font-mono font-bold text-cyber-cyan hover:underline"
                            >
                              {m.slug}
                            </Link>
                          </td>
                          <td className="px-3 py-2">
                            <span className="text-[0.6rem] font-mono text-slate-300">{m.name}</span>
                          </td>
                          <td className="px-3 py-2 text-right">
                            <span
                              className="text-[0.6rem] font-mono font-bold tabular-nums"
                              style={{ color: decayColor(m.ageDays) }}
                            >
                              {m.ageDays}d
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {/* Projects grid */}
            <section>
              <div className="flex items-center gap-2 mb-3">
                <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: 'rgba(0,245,255,0.6)', clipPath: 'polygon(0 0,100% 0,100% 100%,0 100%)' }} />
                <h2 className="text-[0.55rem] font-mono uppercase tracking-widest text-slate-400 font-semibold">
                  Projects
                </h2>
                <div className="flex-1 h-px" style={{ background: 'linear-gradient(to right, rgba(0,245,255,0.2), transparent)' }} />
              </div>

              {sortedProjects.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 gap-3">
                  <div className="text-4xl opacity-10">◑</div>
                  <p className="text-sm font-mono text-slate-500">No memory files found</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {sortedProjects.map((p) => (
                    <ProjectCard key={p.slug} project={p} />
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  )
}
