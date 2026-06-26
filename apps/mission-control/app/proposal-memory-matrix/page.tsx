'use client'

import { useEffect, useState } from 'react'
import SubPageHeader from '../../components/SubPageHeader'
import type { ProposalMemoryMatrixResponse } from '../api/proposal-memory-matrix/route'

function cellColor(score: number): string {
  if (score <= 0) return 'rgba(255,255,255,0.03)'
  const t = Math.pow(score, 0.5)
  const r = Math.round(8 + t * (34 - 8))
  const g = Math.round(15 + t * (211 - 15))
  const b = Math.round(28 + t * (238 - 28))
  return `rgb(${r},${g},${b})`
}

interface TooltipState {
  title: string
  project: string
  score: number
  keywords: string[]
  x: number
  y: number
}

function MatrixGrid({ data }: { data: ProposalMemoryMatrixResponse }) {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null)
  const { proposals, projects, matrix, matchedKeywords } = data

  const CELL_W = 22
  const CELL_H = 18
  const LABEL_W = 160
  const HEADER_H = 56

  const svgW = LABEL_W + projects.length * CELL_W + 4
  const svgH = HEADER_H + proposals.length * CELL_H + 4

  return (
    <div className="relative overflow-x-auto">
      <svg width={svgW} height={svgH} className="block" style={{ minWidth: svgW }}>
        {/* Project column headers */}
        {projects.map((slug, pi) => (
          <text
            key={slug}
            x={LABEL_W + pi * CELL_W + CELL_W / 2}
            y={HEADER_H - 4}
            transform={`rotate(-50, ${LABEL_W + pi * CELL_W + CELL_W / 2}, ${HEADER_H - 4})`}
            textAnchor="end"
            fill="#475569"
            fontSize="0.4rem"
            fontFamily="monospace"
          >
            {slug.length > 14 ? slug.slice(0, 13) + '…' : slug}
          </text>
        ))}

        {/* Proposal rows */}
        {proposals.map((proposal, ri) => {
          const y = HEADER_H + ri * CELL_H
          return (
            <g key={ri}>
              {/* Proposal title label */}
              <text
                x={LABEL_W - 4}
                y={y + CELL_H / 2 + 4}
                textAnchor="end"
                fill="#64748B"
                fontSize="0.42rem"
                fontFamily="monospace"
              >
                {proposal.title.length > 28 ? proposal.title.slice(0, 27) + '…' : proposal.title}
              </text>

              {/* Cells */}
              {projects.map((slug, pi) => {
                const score = matrix[ri]?.[pi] ?? 0
                const highlight = score >= 0.5
                return (
                  <g key={slug}>
                    <rect
                      x={LABEL_W + pi * CELL_W}
                      y={y}
                      width={CELL_W - 1}
                      height={CELL_H - 1}
                      fill={cellColor(score)}
                      stroke={highlight ? 'rgba(34,211,238,0.5)' : 'none'}
                      strokeWidth={highlight ? 1 : 0}
                      rx={1}
                      style={{ cursor: score > 0 ? 'pointer' : 'default' }}
                      onMouseEnter={(e) => {
                        const r = (e.target as SVGRectElement).getBoundingClientRect()
                        setTooltip({
                          title: proposal.title,
                          project: slug,
                          score,
                          keywords: matchedKeywords[ri]?.[pi] ?? [],
                          x: r.left + CELL_W / 2,
                          y: r.top,
                        })
                      }}
                      onMouseLeave={() => setTooltip(null)}
                    />
                    {highlight && (
                      <text
                        x={LABEL_W + pi * CELL_W + CELL_W / 2}
                        y={y + CELL_H / 2 + 3}
                        textAnchor="middle"
                        fill="rgba(255,255,255,0.8)"
                        fontSize="0.35rem"
                        fontFamily="monospace"
                        style={{ pointerEvents: 'none' }}
                      >
                        {score.toFixed(1)}
                      </text>
                    )}
                  </g>
                )
              })}
            </g>
          )
        })}
      </svg>

      {tooltip && (
        <div
          className="fixed z-50 pointer-events-none rounded border border-white/10 px-2 py-1.5 text-[0.5rem] font-mono"
          style={{
            left: tooltip.x,
            top: tooltip.y - 68,
            background: 'rgba(8,15,28,0.97)',
            backdropFilter: 'blur(6px)',
            transform: 'translateX(-50%)',
            maxWidth: 220,
          }}
        >
          <div className="text-slate-300 truncate">{tooltip.title}</div>
          <div className="text-slate-500">{tooltip.project}</div>
          <div className="text-cyan-400">overlap: {tooltip.score.toFixed(2)}</div>
          {tooltip.keywords.length > 0 && (
            <div className="text-slate-600 mt-0.5">{tooltip.keywords.slice(0, 6).join(', ')}</div>
          )}
        </div>
      )}
    </div>
  )
}

export default function ProposalMemoryMatrixPage() {
  const [data, setData] = useState<ProposalMemoryMatrixResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/proposal-memory-matrix')
      .then((r) => r.json())
      .then((d: ProposalMemoryMatrixResponse) => { setData(d); setLoading(false) })
      .catch((e) => { setError(String(e)); setLoading(false) })
  }, [])

  return (
    <div className="min-h-screen p-4 md:p-6" style={{ background: '#080f1c', color: '#E2E8F0' }}>
      <SubPageHeader title="Proposal × Memory Coverage Matrix">
        <span className="text-[0.6rem] font-mono text-slate-500">
          Keyword overlap between specclaw proposals and project memory · sorted by coverage desc
        </span>
      </SubPageHeader>

      {loading && <div className="text-center py-20 text-slate-600 font-mono text-sm">Loading…</div>}
      {error && <div className="text-center py-20 text-red-500 font-mono text-sm">{error}</div>}

      {!loading && !error && data && (
        <div className="max-w-full mx-auto">
          {data.proposals.length === 0 ? (
            <div className="text-center py-20 text-slate-600 font-mono text-sm">
              No specclaw proposals found across projects
            </div>
          ) : (
            <>
              <div className="flex items-center gap-4 mb-4 text-[0.55rem] font-mono text-slate-500">
                <span>
                  <span className="text-slate-300">{data.proposals.length}</span> proposals ×{' '}
                  <span className="text-slate-300">{data.projects.length}</span> projects
                </span>
                <span>bright cell = high keyword overlap · labeled when score ≥ 0.5</span>
              </div>
              <div className="rounded-lg border border-white/5 p-4 overflow-x-auto"
                style={{ background: 'rgba(255,255,255,0.02)' }}>
                <MatrixGrid data={data} />
                {/* Color scale */}
                <div className="flex items-center gap-2 mt-4">
                  <span className="text-[0.45rem] font-mono text-slate-600">0</span>
                  <div className="flex h-2 w-24 rounded overflow-hidden">
                    {Array.from({ length: 12 }, (_, i) => (
                      <div key={i} className="flex-1" style={{ background: cellColor((i + 1) / 12) }} />
                    ))}
                  </div>
                  <span className="text-[0.45rem] font-mono text-slate-600">1.0</span>
                </div>
              </div>
            </>
          )}

          {data && (
            <div className="text-[0.5rem] font-mono text-slate-700 text-right mt-3">
              Generated {new Date(data.generatedAt).toLocaleString()}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
