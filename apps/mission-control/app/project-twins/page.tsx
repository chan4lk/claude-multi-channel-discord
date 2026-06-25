'use client'

import { Suspense, useState } from 'react'
import Link from 'next/link'
import type { ProjectTwinsResponse, FeatureName } from '../api/project-twins/route'
import { useFreshness } from '../../lib/useFreshness'
import FreshnessBadge from '../../components/FreshnessBadge'

const FEATURE_LABELS: Record<FeatureName, string> = {
  turns_per_day: 'Turns/day',
  tool_call_rate: 'Tool rate',
  memory_file_count: 'Memory files',
  context_pressure_pct: 'Context %',
  avg_tokens_per_turn: 'Tokens/turn',
}

const FEATURE_NAMES: FeatureName[] = [
  'turns_per_day',
  'tool_call_rate',
  'memory_file_count',
  'context_pressure_pct',
  'avg_tokens_per_turn',
]

function simColor(sim: number): string {
  if (sim >= 0.95) return '#00f5ff'
  if (sim >= 0.9) return '#22d3ee'
  if (sim >= 0.85) return '#38bdf8'
  return '#475569'
}

function cellBg(sim: number): string {
  const alpha = Math.round(((sim - 0.8) / 0.2) * 80)
  return `rgba(0,245,255,${alpha / 255})`
}

function ProjectTwinsInner() {
  const { data, isStale, lastError, lastSuccessAt } = useFreshness<ProjectTwinsResponse>(
    '/api/project-twins',
    120_000,
  )
  const [selectedPair, setSelectedPair] = useState<{ slugA: string; slugB: string } | null>(null)

  const loading = data === null && lastError === null

  if (loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center" style={{ background: '#060d1a' }}>
        <div className="text-xs font-mono text-slate-600 animate-pulse">Computing project twins…</div>
      </div>
    )
  }

  const projects = data?.projects ?? []
  const pairs = data?.pairs ?? []

  // Build lookup for sim
  const simMap = new Map<string, number>()
  for (const p of pairs) {
    simMap.set(`${p.slug_a}:${p.slug_b}`, p.similarity)
    simMap.set(`${p.slug_b}:${p.slug_a}`, p.similarity)
  }

  const selectedPairData = selectedPair
    ? pairs.find(
        (p) =>
          (p.slug_a === selectedPair.slugA && p.slug_b === selectedPair.slugB) ||
          (p.slug_a === selectedPair.slugB && p.slug_b === selectedPair.slugA)
      )
    : null

  const selectedProjectA = selectedPair
    ? projects.find((p) => p.slug === selectedPair.slugA)
    : null

  const selectedProjectB = selectedPair
    ? projects.find((p) => p.slug === selectedPair.slugB)
    : null

  return (
    <div className="min-h-dvh flex flex-col" style={{ background: '#060d1a' }}>
      <header className="sticky top-0 z-30 border-b border-cyber-cyan/12 bg-[#060d1a]/90 backdrop-blur-md px-6 py-3">
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-cyber-cyan/40 to-transparent" />
        <div className="flex items-center gap-3 flex-wrap">
          <Link href="/" className="text-[0.6rem] font-mono text-slate-500 hover:text-cyber-cyan transition-colors uppercase tracking-wider">← Dashboard</Link>
          <h1 className="text-sm font-black tracking-[0.18em] text-cyber-cyan" style={{ fontFamily: 'Orbitron, JetBrains Mono, monospace' }}>
            Project Twins
          </h1>
          <span className="text-[0.6rem] font-mono text-slate-500 border border-slate-700 px-2 py-0.5 rounded">cosine similarity ≥ 0.80</span>
          <FreshnessBadge isStale={isStale} lastError={lastError} lastSuccessAt={lastSuccessAt} />
          <div className="flex-1" />
          <div className="flex items-center gap-1.5">
            <span className="text-[0.55rem] font-mono text-slate-500 uppercase tracking-wider">twin pairs</span>
            <span className="text-lg font-black tabular-nums text-cyber-cyan" style={{ fontFamily: 'Orbitron, monospace' }}>{pairs.length}</span>
          </div>
        </div>
      </header>

      <main className="flex-1 p-6 max-w-6xl mx-auto w-full flex flex-col gap-6">
        {projects.length < 2 ? (
          <div className="h-64 flex items-center justify-center text-slate-600 text-xs font-mono text-center px-6">
            Need at least 2 projects with JSONL data to compute similarities.
          </div>
        ) : (
          <>
            {/* Similarity matrix */}
            <div className="overflow-x-auto">
              <div className="text-[0.55rem] font-mono text-slate-600 mb-2 uppercase tracking-wider">Similarity Matrix (pairs ≥ 0.80 highlighted)</div>
              <table className="text-[0.5rem] font-mono border-collapse">
                <thead>
                  <tr>
                    <th className="w-24 pr-2 text-right text-slate-600 font-normal" />
                    {projects.map((p) => (
                      <th key={p.slug} className="text-slate-500 font-normal pb-1 text-center" style={{ minWidth: 52 }}>
                        <span
                          className="inline-block"
                          style={{
                            writingMode: 'vertical-rl',
                            transform: 'rotate(180deg)',
                            maxHeight: 80,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                          title={p.slug}
                        >
                          {p.slug}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {projects.map((rowProj) => (
                    <tr key={rowProj.slug}>
                      <td
                        className="pr-2 text-right text-slate-500 truncate"
                        style={{ maxWidth: 96 }}
                        title={rowProj.slug}
                      >
                        {rowProj.slug}
                      </td>
                      {projects.map((colProj) => {
                        if (rowProj.slug === colProj.slug) {
                          return (
                            <td
                              key={colProj.slug}
                              className="text-center"
                              style={{ background: 'rgba(0,245,255,0.08)', padding: '3px 4px' }}
                            >
                              <span className="text-cyber-cyan/40">—</span>
                            </td>
                          )
                        }
                        const sim = simMap.get(`${rowProj.slug}:${colProj.slug}`)
                        const isSelected =
                          selectedPair?.slugA === rowProj.slug && selectedPair?.slugB === colProj.slug ||
                          selectedPair?.slugA === colProj.slug && selectedPair?.slugB === rowProj.slug
                        return (
                          <td
                            key={colProj.slug}
                            className="text-center cursor-pointer transition-all"
                            style={{
                              background: sim !== undefined ? cellBg(sim) : 'transparent',
                              padding: '3px 4px',
                              outline: isSelected ? `1px solid #00f5ff` : undefined,
                            }}
                            onClick={() => {
                              if (sim !== undefined) {
                                setSelectedPair(
                                  isSelected ? null : { slugA: rowProj.slug, slugB: colProj.slug }
                                )
                              }
                            }}
                            title={sim !== undefined ? `${rowProj.slug} × ${colProj.slug}: ${sim.toFixed(3)}` : undefined}
                          >
                            {sim !== undefined ? (
                              <span style={{ color: simColor(sim) }}>{sim.toFixed(2)}</span>
                            ) : (
                              <span className="text-slate-800">·</span>
                            )}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pair detail */}
            {selectedPairData && selectedProjectA && selectedProjectB ? (
              <div className="rounded-xl border border-cyber-cyan/20 p-5" style={{ background: 'rgba(0,245,255,0.03)' }}>
                <div className="flex items-center gap-3 mb-4">
                  <span className="text-xs font-mono text-cyber-cyan font-bold">{selectedProjectA.slug}</span>
                  <span className="text-[0.55rem] font-mono text-slate-500">×</span>
                  <span className="text-xs font-mono text-cyber-cyan font-bold">{selectedProjectB.slug}</span>
                  <span
                    className="ml-2 text-sm font-black tabular-nums"
                    style={{ color: simColor(selectedPairData.similarity), fontFamily: 'Orbitron, monospace' }}
                  >
                    {selectedPairData.similarity.toFixed(3)}
                  </span>
                </div>

                {/* Shared features */}
                {selectedPairData.sharedFeatures.length > 0 && (
                  <div className="mb-4 flex flex-wrap gap-1.5">
                    <span className="text-[0.5rem] font-mono text-slate-600 mr-1">Shared features:</span>
                    {selectedPairData.sharedFeatures.map((f) => (
                      <span
                        key={f}
                        className="text-[0.5rem] font-mono px-2 py-0.5 rounded"
                        style={{ background: 'rgba(0,245,255,0.12)', color: '#00f5ff' }}
                      >
                        {FEATURE_LABELS[f]}
                      </span>
                    ))}
                  </div>
                )}

                {/* Feature comparison */}
                <div className="grid grid-cols-1 gap-2">
                  {FEATURE_NAMES.map((feat) => {
                    const normA = selectedProjectA.normalized[feat]
                    const normB = selectedProjectB.normalized[feat]
                    const rawA = selectedProjectA.raw[feat]
                    const rawB = selectedProjectB.raw[feat]
                    const isShared = selectedPairData.sharedFeatures.includes(feat)
                    return (
                      <div key={feat} className="flex items-center gap-3">
                        <span
                          className="text-[0.5rem] font-mono w-24 shrink-0"
                          style={{ color: isShared ? '#00f5ff' : '#475569' }}
                        >
                          {FEATURE_LABELS[feat]}
                        </span>
                        <div className="flex-1 flex items-center gap-2">
                          {/* Bar A */}
                          <div className="flex-1 h-2.5 rounded-sm overflow-hidden" style={{ background: '#0a1628' }}>
                            <div
                              className="h-full rounded-sm"
                              style={{ width: `${normA * 100}%`, background: isShared ? '#00f5ff' : '#1e3a5f' }}
                            />
                          </div>
                          <span className="text-[0.45rem] font-mono text-slate-600 w-16 text-center tabular-nums">
                            {rawA.toFixed(1)}
                          </span>
                          <div className="flex-1 h-2.5 rounded-sm overflow-hidden" style={{ background: '#0a1628' }}>
                            <div
                              className="h-full rounded-sm"
                              style={{ width: `${normB * 100}%`, background: isShared ? '#00f5ff' : '#1e3a5f' }}
                            />
                          </div>
                          <span className="text-[0.45rem] font-mono text-slate-600 w-16 text-center tabular-nums">
                            {rawB.toFixed(1)}
                          </span>
                        </div>
                      </div>
                    )
                  })}
                </div>
                <div className="mt-3 flex gap-8 text-[0.45rem] font-mono text-slate-700">
                  <span>← Left: {selectedProjectA.slug}</span>
                  <span>Right: {selectedProjectB.slug} →</span>
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-slate-800 p-4 text-[0.55rem] font-mono text-slate-600">
                Click a highlighted cell to see feature comparison for that pair.
              </div>
            )}

            {/* Ranked pairs list */}
            {pairs.length > 0 && (
              <div>
                <div className="text-[0.55rem] font-mono text-slate-600 mb-2 uppercase tracking-wider">
                  All Twin Pairs — ranked by similarity
                </div>
                <div className="flex flex-col gap-1 max-h-64 overflow-y-auto">
                  {pairs.map((p) => {
                    const isSelected =
                      (selectedPair?.slugA === p.slug_a && selectedPair?.slugB === p.slug_b) ||
                      (selectedPair?.slugA === p.slug_b && selectedPair?.slugB === p.slug_a)
                    return (
                      <button
                        key={`${p.slug_a}:${p.slug_b}`}
                        onClick={() =>
                          setSelectedPair(
                            isSelected ? null : { slugA: p.slug_a, slugB: p.slug_b }
                          )
                        }
                        className="flex items-center gap-3 px-3 py-1.5 rounded-lg text-left transition-colors"
                        style={{
                          background: isSelected ? 'rgba(0,245,255,0.08)' : 'rgba(255,255,255,0.02)',
                          border: `1px solid ${isSelected ? 'rgba(0,245,255,0.3)' : 'rgba(255,255,255,0.04)'}`,
                        }}
                      >
                        <span className="text-[0.55rem] font-mono text-slate-400 w-36 truncate">{p.slug_a}</span>
                        <span className="text-[0.5rem] font-mono text-slate-700">×</span>
                        <span className="text-[0.55rem] font-mono text-slate-400 w-36 truncate">{p.slug_b}</span>
                        <span
                          className="ml-auto text-xs font-black tabular-nums"
                          style={{ color: simColor(p.similarity), fontFamily: 'Orbitron, monospace' }}
                        >
                          {p.similarity.toFixed(3)}
                        </span>
                        {p.sharedFeatures.length > 0 && (
                          <span className="text-[0.45rem] font-mono text-slate-700">
                            {p.sharedFeatures.length} shared
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}
          </>
        )}

        <p className="text-[0.5rem] font-mono text-slate-700">
          Features: turns/day, tool-call rate, memory file count, context pressure %, avg tokens/turn — measured over 7-day window.
          Normalized 0–1 across fleet, cosine similarity computed pairwise. Pairs ≥ 0.80 shown. Shared features = within 20% normalized distance.
          Refreshes every 2 min.
        </p>
      </main>
    </div>
  )
}

export default function ProjectTwinsPage() {
  return (
    <Suspense>
      <ProjectTwinsInner />
    </Suspense>
  )
}
