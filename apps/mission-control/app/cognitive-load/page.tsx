'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import SubPageHeader from '../../components/SubPageHeader'
import type { CognitiveLoadResponse, ProjectCognitiveLoad, WorstTurn } from '../api/cognitive-load/route'

const DIMENSIONS = [
  {
    key: 'thinkingAvg' as const,
    label: 'Thinking',
    tooltip: 'Avg thinking block length (chars)',
    worstKey: 'thinking' as const,
    format: (v: number) => v >= 1000 ? `${(v / 1000).toFixed(1)}K` : String(Math.round(v)),
    unit: 'chars',
  },
  {
    key: 'toolCallsPerTurn' as const,
    label: 'Tool Calls',
    tooltip: 'Avg tool calls per turn',
    worstKey: 'toolCalls' as const,
    format: (v: number) => v.toFixed(1),
    unit: '/turn',
  },
  {
    key: 'retryRate' as const,
    label: 'Retry Rate',
    tooltip: 'Tool error / total tool calls ratio',
    worstKey: 'retries' as const,
    format: (v: number) => `${(v * 100).toFixed(1)}%`,
    unit: 'error%',
  },
  {
    key: 'subagentDepth' as const,
    label: 'Subagents',
    tooltip: 'Avg subagent call depth per turn',
    worstKey: 'subagents' as const,
    format: (v: number) => v.toFixed(1),
    unit: 'depth',
  },
]

function cellColor(normalized: number): string {
  if (normalized <= 0) return '#0f172a'
  if (normalized <= 0.25) return '#1e1b4b'
  if (normalized <= 0.5) return '#312e81'
  if (normalized <= 0.75) return '#4c1d95'
  return '#7c3aed'
}

function cellTextColor(normalized: number): string {
  return normalized > 0.4 ? '#e2e8f0' : '#94a3b8'
}

function normalizeFleet(projects: ProjectCognitiveLoad[], key: keyof Pick<ProjectCognitiveLoad, 'thinkingAvg' | 'toolCallsPerTurn' | 'retryRate' | 'subagentDepth'>): Map<string, number> {
  const vals = projects.map((p) => p[key] as number)
  const max = Math.max(...vals, 0.0001)
  const result = new Map<string, number>()
  for (const p of projects) {
    result.set(p.slug, Math.min(1, (p[key] as number) / max))
  }
  return result
}

function CompositeBar({ value }: { value: number }) {
  const color = value >= 75 ? '#EF4444' : value >= 50 ? '#F59E0B' : value >= 25 ? '#A78BFA' : '#22D3EE'
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: '#1e293b' }}>
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${value}%`, background: color }}
        />
      </div>
      <span className="text-[0.6rem] font-mono tabular-nums w-6 text-right" style={{ color }}>{value}</span>
    </div>
  )
}

function SidePanel({
  project,
  dimIdx,
  onClose,
}: {
  project: ProjectCognitiveLoad
  dimIdx: number
  onClose: () => void
}) {
  const dim = DIMENSIONS[dimIdx]
  if (!dim) return null
  const turns: WorstTurn[] = project.worstTurns[dim.worstKey]

  return (
    <div
      className="fixed inset-y-0 right-0 z-50 w-80 sm:w-96 border-l border-cyber-cyan/20 bg-cyber-surface/95 backdrop-blur-xl flex flex-col shadow-2xl"
      style={{ boxShadow: '-10px 0 40px rgba(0,245,255,0.05)' }}
    >
      <div className="flex items-center gap-2 px-4 py-3 border-b border-white/5">
        <span className="text-xs font-mono font-bold text-cyber-cyan flex-1 truncate">
          {project.slug} / {dim.label}
        </span>
        <button
          onClick={onClose}
          className="text-slate-500 hover:text-slate-300 text-sm font-mono px-2 py-1"
        >
          ✕
        </button>
      </div>

      <div className="p-4 flex flex-col gap-4 overflow-y-auto flex-1">
        <div className="rounded-lg border border-white/5 bg-cyber-surface/40 p-3">
          <div className="text-[0.55rem] font-mono text-slate-600 uppercase tracking-wider mb-1">{dim.tooltip}</div>
          <div className="text-xl font-bold font-mono text-cyber-cyan">
            {dim.format(project[dim.key] as number)}
            <span className="text-[0.6rem] text-slate-500 ml-1">{dim.unit}</span>
          </div>
          <div className="text-[0.55rem] font-mono text-slate-600 mt-1">composite score: {project.composite}</div>
        </div>

        <div>
          <div className="text-[0.6rem] font-mono uppercase tracking-wider text-slate-500 mb-2">
            Top 3 Worst Turns
          </div>
          {turns.length === 0 ? (
            <div className="text-slate-600 text-xs font-mono">No data</div>
          ) : (
            turns.map((t, i) => (
              <div key={i} className="mb-3 rounded-lg border border-white/5 bg-cyber-surface/40 p-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[0.55rem] font-mono text-slate-600">
                    {new Date(t.ts).toLocaleString()}
                  </span>
                  <span className="text-xs font-mono font-bold text-violet-400">
                    {dim.format(t.value)}
                  </span>
                </div>
                {t.sessionId && (
                  <Link
                    href={`/session-replay?session=${t.sessionId}`}
                    className="text-[0.55rem] font-mono text-cyber-cyan hover:underline"
                  >
                    → View in Session Replay
                  </Link>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

export default function CognitiveLoadPage() {
  const [data, setData] = useState<CognitiveLoadResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [windowDays, setWindowDays] = useState(7)
  const [selected, setSelected] = useState<{ slug: string; dimIdx: number } | null>(null)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/cognitive-load?window=${windowDays}`)
      .then((r) => r.json())
      .then((d: CognitiveLoadResponse) => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [windowDays])

  const projects = data?.projects ?? []

  const normMaps = {
    thinkingAvg: normalizeFleet(projects, 'thinkingAvg'),
    toolCallsPerTurn: normalizeFleet(projects, 'toolCallsPerTurn'),
    retryRate: normalizeFleet(projects, 'retryRate'),
    subagentDepth: normalizeFleet(projects, 'subagentDepth'),
  }

  const selectedProject = selected ? projects.find((p) => p.slug === selected.slug) ?? null : null

  return (
    <div className="min-h-screen bg-cyber-bg text-slate-200 flex flex-col">
      <SubPageHeader title="COGNITIVE LOAD HEATMAP">
        <select
          value={windowDays}
          onChange={(e) => setWindowDays(Number(e.target.value))}
          className="text-[0.6rem] font-mono bg-cyber-surface border border-cyber-cyan/20 text-slate-300 rounded px-2 py-1"
        >
          {[1, 3, 7, 14, 30].map((d) => (
            <option key={d} value={d}>{d}d window</option>
          ))}
        </select>
      </SubPageHeader>

      <div className="flex-1 p-4 sm:p-6 flex flex-col gap-4 max-w-5xl mx-auto w-full">
        {/* Legend */}
        <div className="flex flex-wrap items-center gap-4 text-[0.55rem] font-mono text-slate-500">
          <span className="uppercase tracking-wider">Intensity →</span>
          {[0, 0.25, 0.5, 0.75, 1].map((v) => (
            <span
              key={v}
              className="px-2 py-0.5 rounded text-[0.5rem]"
              style={{ background: cellColor(v), color: cellTextColor(v) }}
            >
              {v === 0 ? 'none' : v === 0.25 ? 'low' : v === 0.5 ? 'mid' : v === 0.75 ? 'high' : 'extreme'}
            </span>
          ))}
          <span className="ml-auto">Click cell → top-3 worst turns</span>
        </div>

        {loading && (
          <div className="text-center py-20 text-slate-600 text-sm font-mono animate-pulse">
            Scanning transcripts…
          </div>
        )}

        {!loading && projects.length === 0 && (
          <div className="text-center py-20 text-slate-600 text-sm font-mono rounded-xl border border-white/5 bg-cyber-surface/40">
            No transcript data found for the selected window.
          </div>
        )}

        {!loading && projects.length > 0 && (
          <div className="rounded-xl border border-cyber-cyan/15 bg-cyber-surface/60 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs font-mono">
                <thead>
                  <tr className="border-b border-white/5">
                    <th className="text-left px-4 py-2 text-[0.6rem] uppercase tracking-wider text-slate-500 font-normal w-32">
                      Project
                    </th>
                    {DIMENSIONS.map((d) => (
                      <th
                        key={d.key}
                        className="px-3 py-2 text-[0.6rem] uppercase tracking-wider text-slate-500 font-normal text-center"
                        title={d.tooltip}
                      >
                        {d.label}
                      </th>
                    ))}
                    <th className="px-4 py-2 text-[0.6rem] uppercase tracking-wider text-slate-500 font-normal text-right w-32">
                      Composite
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {projects.map((proj) => (
                    <tr
                      key={proj.slug}
                      className="border-b border-white/5 last:border-0 hover:bg-white/2 transition-colors"
                    >
                      <td className="px-4 py-2.5 font-bold text-cyber-cyan truncate max-w-[120px]">
                        {proj.slug}
                      </td>
                      {DIMENSIONS.map((dim, dimIdx) => {
                        const norm = normMaps[dim.key].get(proj.slug) ?? 0
                        const isSelected = selected?.slug === proj.slug && selected?.dimIdx === dimIdx
                        return (
                          <td key={dim.key} className="px-2 py-1.5 text-center">
                            <button
                              onClick={() =>
                                setSelected(
                                  isSelected ? null : { slug: proj.slug, dimIdx }
                                )
                              }
                              className="w-full rounded px-3 py-1.5 text-[0.65rem] tabular-nums transition-all duration-200 cursor-pointer"
                              style={{
                                background: cellColor(norm),
                                color: cellTextColor(norm),
                                outline: isSelected ? '2px solid #22D3EE' : 'none',
                                outlineOffset: '2px',
                              }}
                              title={`${dim.tooltip}: ${dim.format(proj[dim.key] as number)} ${dim.unit}`}
                            >
                              {dim.format(proj[dim.key] as number)}
                            </button>
                          </td>
                        )
                      })}
                      <td className="px-4 py-2.5">
                        <CompositeBar value={proj.composite} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Dimension descriptions */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {DIMENSIONS.map((d) => (
            <div key={d.key} className="rounded-lg border border-white/5 bg-cyber-surface/40 p-3">
              <div className="text-[0.6rem] font-mono font-bold text-violet-400 mb-1">{d.label}</div>
              <div className="text-[0.55rem] font-mono text-slate-500">{d.tooltip}</div>
            </div>
          ))}
        </div>
      </div>

      {selected && selectedProject && (
        <>
          <div
            className="fixed inset-0 z-40"
            style={{ background: 'rgba(0,0,0,0.4)' }}
            onClick={() => setSelected(null)}
          />
          <SidePanel
            project={selectedProject}
            dimIdx={selected.dimIdx}
            onClose={() => setSelected(null)}
          />
        </>
      )}
    </div>
  )
}
