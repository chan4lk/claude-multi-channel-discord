'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import SubPageHeader from '../../components/SubPageHeader'
import type { ToolCooccurrenceResponse, CooccurrenceTurn } from '../api/tool-cooccurrence/route'

function cellColor(count: number, max: number): string {
  if (count === 0 || max === 0) return 'transparent'
  const t = Math.pow(count / max, 0.5)
  const r = Math.round(34 + t * (168 - 34))
  const g = Math.round(211 + t * (85 - 211))
  const b = Math.round(238 + t * (247 - 238))
  return `rgb(${r},${g},${b})`
}

function shortName(tool: string): string {
  return tool.replace('mcp__mcd__', '').replace('mcp__', '').slice(0, 12)
}

function DrawerPanel({
  pair,
  turns,
  onClose,
}: {
  pair: [string, string] | null
  turns: CooccurrenceTurn[]
  onClose: () => void
}) {
  if (!pair) return null
  const [a, b] = pair
  const filtered = a === b
    ? turns.filter((t) => t.tools.includes(a))
    : turns.filter((t) => t.tools.includes(a) && t.tools.includes(b))

  return (
    <div
      className="fixed inset-y-0 right-0 w-80 border-l border-white/10 p-4 overflow-y-auto z-40"
      style={{ background: '#0a1628' }}
    >
      <div className="flex items-center justify-between mb-4">
        <div className="text-[0.65rem] font-mono text-slate-300">
          {a === b ? shortName(a) : `${shortName(a)} × ${shortName(b)}`}
        </div>
        <button onClick={onClose} className="text-slate-500 hover:text-slate-300 text-sm">✕</button>
      </div>
      <div className="text-[0.55rem] font-mono text-slate-500 mb-3">{filtered.length} turns</div>
      {filtered.slice(0, 50).map((turn) => (
        <div
          key={turn.turnIdx}
          className="mb-2 rounded border border-white/5 p-2"
          style={{ background: 'rgba(255,255,255,0.02)' }}
        >
          <div className="text-[0.5rem] font-mono text-slate-500 mb-1">{turn.ts.slice(0, 19).replace('T', ' ')}</div>
          <div className="flex flex-wrap gap-1">
            {[...new Set(turn.tools)].map((tool) => (
              <span
                key={tool}
                className="px-1 py-0.5 rounded text-[0.45rem] font-mono"
                style={{
                  background: (tool === a || tool === b) ? 'rgba(34,211,238,0.15)' : 'rgba(255,255,255,0.05)',
                  color: (tool === a || tool === b) ? '#22D3EE' : '#64748B',
                }}
              >
                {shortName(tool)}
              </span>
            ))}
          </div>
        </div>
      ))}
      {filtered.length === 0 && (
        <div className="text-[0.6rem] font-mono text-slate-600">No turns found</div>
      )}
    </div>
  )
}

export default function ToolCooccurrencePage() {
  const [data, setData] = useState<ToolCooccurrenceResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null)
  const [includeMcd, setIncludeMcd] = useState(false)
  const [windowDays, setWindowDays] = useState(30)
  const [hoveredCell, setHoveredCell] = useState<[number, number] | null>(null)
  const [selectedPair, setSelectedPair] = useState<[string, string] | null>(null)
  const [slugOptions, setSlugOptions] = useState<string[]>([])

  const load = useCallback(() => {
    const params = new URLSearchParams({ days: String(windowDays) })
    if (selectedSlug) params.set('slug', selectedSlug)
    if (includeMcd) params.set('include_mcd', '1')
    fetch(`/api/tool-cooccurrence?${params}`)
      .then((r) => r.json())
      .then((d: ToolCooccurrenceResponse) => {
        setData(d)
        setLoading(false)
        // Infer slug options from all available slugs via channels
        fetch('/api/fleet')
          .then((r) => r.json())
          .then((f: { projects?: Array<{ slug: string }> }) => {
            setSlugOptions((f.projects ?? []).map((p) => p.slug))
          })
          .catch(() => {})
      })
      .catch(() => setLoading(false))
  }, [windowDays, selectedSlug, includeMcd])

  useEffect(() => { setLoading(true); load() }, [load])

  const N = data?.tools.length ?? 0
  const matrix = data?.matrix ?? []
  const tools = data?.tools ?? []

  const maxOff = Math.max(1, ...matrix.flatMap((row, r) => row.filter((_, c) => c !== r)))

  const CELL = 28

  return (
    <div className="min-h-screen p-4 md:p-6" style={{ background: '#080f1c', color: '#E2E8F0' }}>
      <SubPageHeader title="Tool Co-occurrence Matrix">
        <span className="text-[0.6rem] font-mono text-slate-500">
          Which tools appear together in the same turn
        </span>
      </SubPageHeader>

      {loading && (
        <div className="text-center py-20 text-slate-600 font-mono text-sm">Loading…</div>
      )}

      {!loading && data && (
        <div className="max-w-full">
          {/* Controls */}
          <div className="flex flex-wrap items-center gap-3 mb-5">
            {[7, 14, 30, 60].map((d) => (
              <button
                key={d}
                onClick={() => setWindowDays(d)}
                className="text-[0.65rem] font-mono px-3 py-1 rounded border transition-colors"
                style={{
                  borderColor: windowDays === d ? '#A855F7' : 'rgba(255,255,255,0.1)',
                  color: windowDays === d ? '#A855F7' : '#64748B',
                  background: windowDays === d ? 'rgba(168,85,247,0.08)' : 'transparent',
                }}
              >
                {d}d
              </button>
            ))}
            <select
              value={selectedSlug ?? ''}
              onChange={(e) => setSelectedSlug(e.target.value || null)}
              className="text-[0.65rem] font-mono px-2 py-1 rounded border border-white/10"
              style={{ background: '#0d1b2e', color: '#E2E8F0' }}
            >
              <option value="">All projects</option>
              {slugOptions.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <button
              onClick={() => setIncludeMcd(!includeMcd)}
              className="text-[0.65rem] font-mono px-3 py-1 rounded border transition-colors"
              style={{
                borderColor: includeMcd ? '#F59E0B' : 'rgba(255,255,255,0.1)',
                color: includeMcd ? '#F59E0B' : '#64748B',
                background: includeMcd ? 'rgba(245,158,11,0.08)' : 'transparent',
              }}
            >
              {includeMcd ? 'hide mcd tools' : 'show mcd tools'}
            </button>
          </div>

          {N < 2 ? (
            <div className="text-center py-20 text-slate-600 font-mono text-sm">
              Fewer than 2 distinct tools found — try a wider window or different project
            </div>
          ) : (
            <div className="overflow-auto">
              <div
                className="rounded-lg border border-white/5 p-4 inline-block"
                style={{ background: 'rgba(255,255,255,0.02)' }}
              >
                <div className="text-[0.6rem] font-mono text-slate-500 uppercase tracking-wider mb-3">
                  Co-occurrence count (click cell for turn list)
                </div>

                <svg
                  width={CELL * N + 100}
                  height={CELL * N + 100}
                  style={{ display: 'block' }}
                >
                  {/* Column labels */}
                  {tools.map((tool, ci) => (
                    <text
                      key={`col-${ci}`}
                      x={100 + ci * CELL + CELL / 2}
                      y={92}
                      textAnchor="end"
                      fill="#64748B"
                      fontSize="0.45rem"
                      fontFamily="monospace"
                      transform={`rotate(-45, ${100 + ci * CELL + CELL / 2}, 92)`}
                    >
                      {shortName(tool)}
                    </text>
                  ))}

                  {/* Row labels + cells */}
                  {tools.map((rowTool, ri) => (
                    <g key={`row-${ri}`}>
                      <text
                        x={95}
                        y={100 + ri * CELL + CELL / 2 + 4}
                        textAnchor="end"
                        fill="#64748B"
                        fontSize="0.45rem"
                        fontFamily="monospace"
                      >
                        {shortName(rowTool)}
                      </text>

                      {tools.map((colTool, ci) => {
                        const count = matrix[ri]?.[ci] ?? 0
                        const isDiag = ri === ci
                        const isHovered = hoveredCell && hoveredCell[0] === ri && hoveredCell[1] === ci
                        const bg = isDiag
                          ? `rgba(255,255,255,${count > 0 ? 0.06 : 0.02})`
                          : cellColor(count, maxOff)

                        return (
                          <g
                            key={`cell-${ri}-${ci}`}
                            style={{ cursor: count > 0 ? 'pointer' : 'default' }}
                            onClick={() => {
                              if (count > 0) setSelectedPair([rowTool, colTool])
                            }}
                            onMouseEnter={() => setHoveredCell([ri, ci])}
                            onMouseLeave={() => setHoveredCell(null)}
                          >
                            <rect
                              x={100 + ci * CELL}
                              y={100 + ri * CELL}
                              width={CELL - 1}
                              height={CELL - 1}
                              fill={bg}
                              stroke={isHovered ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.04)'}
                              strokeWidth={isHovered ? 1.5 : 0.5}
                              rx={2}
                            />
                            {count > 0 && (
                              <text
                                x={100 + ci * CELL + CELL / 2 - 0.5}
                                y={100 + ri * CELL + CELL / 2 + 4}
                                textAnchor="middle"
                                fill={isDiag ? '#94A3B8' : '#0f172a'}
                                fontSize="0.45rem"
                                fontFamily="monospace"
                                fontWeight="bold"
                              >
                                {count}
                              </text>
                            )}
                          </g>
                        )
                      })}
                    </g>
                  ))}

                  {/* Hover tooltip */}
                  {hoveredCell && (() => {
                    const [ri, ci] = hoveredCell
                    const count = matrix[ri]?.[ci] ?? 0
                    const label = ri === ci
                      ? `${shortName(tools[ri])}: ${count} turns`
                      : `${shortName(tools[ri])} × ${shortName(tools[ci])}: ${count} co-occur`
                    const tx = 100 + ci * CELL + CELL / 2
                    const ty = 100 + ri * CELL - 6
                    return (
                      <text
                        x={tx}
                        y={ty}
                        textAnchor="middle"
                        fill="#E2E8F0"
                        fontSize="0.5rem"
                        fontFamily="monospace"
                      >
                        {label}
                      </text>
                    )
                  })()}
                </svg>

                {/* Color scale legend */}
                <div className="flex items-center gap-2 mt-3">
                  <span className="text-[0.5rem] font-mono text-slate-600">low</span>
                  <div className="flex h-2 w-32 rounded overflow-hidden">
                    {Array.from({ length: 20 }, (_, i) => (
                      <div key={i} className="flex-1" style={{ background: cellColor(i + 1, 20) }} />
                    ))}
                  </div>
                  <span className="text-[0.5rem] font-mono text-slate-600">high</span>
                  <span className="text-[0.5rem] font-mono text-slate-700 ml-3">
                    diagonal = single-tool appearances
                  </span>
                </div>
              </div>
            </div>
          )}

          <div className="text-[0.55rem] font-mono text-slate-700 text-right mt-4">
            Generated {new Date(data.generatedAt).toLocaleString()}
          </div>
        </div>
      )}

      <DrawerPanel
        pair={selectedPair}
        turns={data?.turns ?? []}
        onClose={() => setSelectedPair(null)}
      />
    </div>
  )
}
