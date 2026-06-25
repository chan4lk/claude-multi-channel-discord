'use client'

import { useState } from 'react'
import SubPageHeader from '../../components/SubPageHeader'
import { useFreshness } from '../../lib/useFreshness'
import FreshnessBadge from '../../components/FreshnessBadge'
import type { LifecycleFunnelResponse, LifecycleProject, LifecycleStage } from '../api/lifecycle-funnel/route'

const STAGE_ORDER: LifecycleStage[] = ['spawned', 'contacted', 'active', 'drifting', 'retired']

function fmtMins(mins: number | null): string {
  if (mins === null) return '—'
  if (mins < 60) return `${Math.round(mins)}m`
  if (mins < 1440) return `${(mins / 60).toFixed(1)}h`
  return `${(mins / 1440).toFixed(1)}d`
}

function fmtTs(ts?: string): string {
  if (!ts) return '—'
  return ts.slice(0, 10)
}

export default function LifecycleFunnelPage() {
  const { data, isStale, lastError, lastSuccessAt } = useFreshness<LifecycleFunnelResponse>(
    '/api/lifecycle-funnel', 120_000
  )
  const [selectedStage, setSelectedStage] = useState<LifecycleStage | null>(null)

  const stages = data?.stages ?? []
  const maxCount = Math.max(1, ...stages.map(s => s.count))
  const totalProjects = stages.reduce((s, st) => s + st.count, 0)

  const SVG_W = 800
  const SVG_H = 200
  const PADDING = 40
  const BAR_H = 100
  const BAR_GAP = 8
  const FUNNEL_W = SVG_W - PADDING * 2
  const slotW = (FUNNEL_W - BAR_GAP * (stages.length - 1)) / stages.length

  const selectedStageInfo = stages.find(s => s.name === selectedStage)

  return (
    <div className="min-h-screen p-4 md:p-6" style={{ background: '#080f1c', color: '#E2E8F0' }}>
      <SubPageHeader title="Project Lifecycle Funnel">
        <FreshnessBadge isStale={isStale} lastError={lastError} lastSuccessAt={lastSuccessAt} />
      </SubPageHeader>

      {!data && (
        <div className="text-center py-20 text-slate-600 font-mono text-sm">Loading…</div>
      )}

      {data && totalProjects === 0 && (
        <div className="text-center py-20 text-slate-600 font-mono text-sm">No projects found</div>
      )}

      {data && totalProjects > 0 && (
        <div className="max-w-4xl mx-auto">
          {/* Stats row */}
          <div className="flex gap-6 mb-6 flex-wrap">
            <div className="p-3 rounded border border-white/08" style={{ background: '#060d19' }}>
              <div className="text-[0.5rem] font-mono text-slate-500 uppercase tracking-wider">Total projects</div>
              <div className="text-2xl font-mono text-cyan-300 font-bold mt-1">{totalProjects}</div>
            </div>
            <div className="p-3 rounded border border-white/08" style={{ background: '#060d19' }}>
              <div className="text-[0.5rem] font-mono text-slate-500 uppercase tracking-wider">Median activation time</div>
              <div className="text-2xl font-mono text-green-400 font-bold mt-1">{fmtMins(data.medianActivationMinutes)}</div>
              <div className="text-[0.45rem] font-mono text-slate-600">created → first message</div>
            </div>
            <div className="p-3 rounded border border-white/08" style={{ background: '#060d19' }}>
              <div className="text-[0.5rem] font-mono text-slate-500 uppercase tracking-wider">Median first tool call</div>
              <div className="text-2xl font-mono text-violet-400 font-bold mt-1">{fmtMins(data.medianFirstToolCallMinutes)}</div>
              <div className="text-[0.45rem] font-mono text-slate-600">first message → first tool</div>
            </div>
          </div>

          {/* Funnel SVG */}
          <div
            className="mb-6 p-4 rounded border border-white/08 overflow-x-auto"
            style={{ background: '#060d19' }}
          >
            <svg width={SVG_W} height={SVG_H} style={{ display: 'block', margin: '0 auto' }}>
              {stages.map((stage, i) => {
                const frac = maxCount > 0 ? stage.count / maxCount : 0
                const barH = Math.max(8, Math.round(frac * BAR_H))
                const x = PADDING + i * (slotW + BAR_GAP)
                const y = PADDING + (BAR_H - barH)
                const isSelected = selectedStage === stage.name
                const isEmpty = stage.count === 0

                return (
                  <g key={stage.name}>
                    {/* Sankey-style connector to next bar */}
                    {i < stages.length - 1 && stage.count > 0 && (() => {
                      const nextStage = stages[i + 1]!
                      const nextFrac = maxCount > 0 ? nextStage.count / maxCount : 0
                      const nextBarH = Math.max(8, Math.round(nextFrac * BAR_H))
                      const x2 = PADDING + (i + 1) * (slotW + BAR_GAP)
                      const y2 = PADDING + (BAR_H - nextBarH)
                      // Draw a thin connecting line between bars
                      return (
                        <line
                          x1={x + slotW}
                          y1={y + barH / 2}
                          x2={x2}
                          y2={y2 + nextBarH / 2}
                          stroke="rgba(255,255,255,0.06)"
                          strokeWidth={Math.max(1, Math.min(stage.count, nextStage.count) / maxCount * 20)}
                        />
                      )
                    })()}

                    {/* Bar */}
                    <rect
                      x={x}
                      y={y}
                      width={slotW}
                      height={barH}
                      fill={isEmpty ? '#1e293b' : stage.color}
                      opacity={isSelected ? 1 : 0.75}
                      rx={4}
                      style={{ cursor: isEmpty ? 'default' : 'pointer', transition: 'opacity 0.2s' }}
                      stroke={isSelected ? '#FCD34D' : 'transparent'}
                      strokeWidth={2}
                      onClick={() => setSelectedStage(stage.count > 0 ? (isSelected ? null : stage.name) : null)}
                    />

                    {/* Count label above bar */}
                    <text
                      x={x + slotW / 2}
                      y={y - 6}
                      textAnchor="middle"
                      fontSize={12}
                      fontFamily="monospace"
                      fontWeight="bold"
                      fill={stage.count > 0 ? stage.color : '#334155'}
                    >
                      {stage.count}
                    </text>

                    {/* Stage label below */}
                    <text
                      x={x + slotW / 2}
                      y={PADDING + BAR_H + 18}
                      textAnchor="middle"
                      fontSize={9}
                      fontFamily="monospace"
                      fill={isSelected ? '#FCD34D' : '#94A3B8'}
                    >
                      {stage.label}
                    </text>

                    {/* Percentage */}
                    {stage.count > 0 && (
                      <text
                        x={x + slotW / 2}
                        y={PADDING + BAR_H + 30}
                        textAnchor="middle"
                        fontSize={7}
                        fontFamily="monospace"
                        fill="#475569"
                      >
                        {Math.round((stage.count / totalProjects) * 100)}%
                      </text>
                    )}
                  </g>
                )
              })}
            </svg>

            <p className="text-[0.5rem] font-mono text-slate-700 text-center mt-2">
              Click a bar to see project list · Spawned → Contacted → Active → Drifting → Retired
            </p>
          </div>

          {/* Selected stage project list */}
          {selectedStageInfo && selectedStageInfo.count > 0 && (
            <div
              className="p-4 rounded border border-white/08"
              style={{ background: '#060d19', borderColor: `${selectedStageInfo.color}30` }}
            >
              <div className="flex items-center gap-2 mb-3">
                <span
                  className="inline-block w-2.5 h-2.5 rounded-sm"
                  style={{ background: selectedStageInfo.color }}
                />
                <span className="text-[0.65rem] font-mono font-bold" style={{ color: selectedStageInfo.color }}>
                  {selectedStageInfo.label}
                </span>
                <span className="text-[0.6rem] font-mono text-slate-500">
                  {selectedStageInfo.count} project{selectedStageInfo.count !== 1 ? 's' : ''}
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-[0.6rem] font-mono">
                  <thead>
                    <tr className="text-slate-600 border-b border-white/06">
                      <th className="text-left pb-2 pr-4">slug</th>
                      <th className="text-left pb-2 pr-4">created</th>
                      <th className="text-left pb-2 pr-4">first message</th>
                      <th className="text-left pb-2 pr-4">first tool call</th>
                      <th className="text-left pb-2">last message</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedStageInfo.projects
                      .sort((a: LifecycleProject, b: LifecycleProject) =>
                        (b.lastMessageTs ?? '').localeCompare(a.lastMessageTs ?? '')
                      )
                      .map((proj: LifecycleProject) => (
                        <tr key={proj.slug} className="border-b border-white/04">
                          <td className="py-1.5 pr-4 text-cyan-300">{proj.slug}</td>
                          <td className="py-1.5 pr-4 text-slate-500">{fmtTs(proj.createdTs)}</td>
                          <td className="py-1.5 pr-4 text-slate-500">{fmtTs(proj.firstMessageTs)}</td>
                          <td className="py-1.5 pr-4 text-slate-500">{fmtTs(proj.firstToolCallTs)}</td>
                          <td className="py-1.5 text-slate-500">{fmtTs(proj.lastMessageTs)}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Stage summary table */}
          <div className="mt-4 grid grid-cols-5 gap-2">
            {stages.map(stage => (
              <button
                key={stage.name}
                onClick={() => setSelectedStage(stage.count > 0 ? (selectedStage === stage.name ? null : stage.name) : null)}
                className="p-2 rounded border text-center transition-colors"
                style={{
                  background: '#060d19',
                  borderColor: selectedStage === stage.name ? stage.color : 'rgba(255,255,255,0.06)',
                  cursor: stage.count > 0 ? 'pointer' : 'default',
                }}
              >
                <div className="text-lg font-mono font-bold" style={{ color: stage.count > 0 ? stage.color : '#334155' }}>
                  {stage.count}
                </div>
                <div className="text-[0.45rem] font-mono text-slate-600 uppercase tracking-wider mt-1">
                  {stage.label}
                </div>
              </button>
            ))}
          </div>

          <div className="text-[0.5rem] font-mono text-slate-700 text-right mt-4">
            generated {data.generatedAt.slice(0, 16).replace('T', ' ')} UTC
          </div>
        </div>
      )}
    </div>
  )
}
