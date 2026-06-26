'use client'

import { useEffect, useRef, useState } from 'react'
import SubPageHeader from '../../components/SubPageHeader'
import type { MemoryCorrelationResponse } from '../api/memory-correlation/route'

// ── Color helpers ─────────────────────────────────────────────────────────────

/** Interpolate from #020811 (0) to #00F5FF (1); diagonal uses #7C3AED */
function cellColor(value: number, isDiag: boolean): string {
  if (isDiag) return '#7C3AED'
  if (value <= 0) return '#020811'
  const t = Math.pow(value, 0.6) // gamma for better visual spread
  const r = Math.round(2 + t * (0 - 2))
  const g = Math.round(8 + t * (245 - 8))
  const b = Math.round(17 + t * (255 - 17))
  return `rgb(${r},${g},${b})`
}

function cellOpacity(value: number, isDiag: boolean): number {
  if (isDiag) return 0.85
  if (value <= 0) return 1
  return 0.15 + value * 0.85
}

// ── Badge palette ─────────────────────────────────────────────────────────────

const BADGE_COLORS = [
  '#22D3EE', '#A78BFA', '#34D399', '#FB923C',
  '#60A5FA', '#F472B6', '#4ADE80', '#FACC15',
  '#38BDF8', '#F87171', '#818CF8', '#6EE7B7',
]

function badgeColor(slug: string, allSlugs: string[]): string {
  const idx = allSlugs.indexOf(slug)
  return BADGE_COLORS[idx % BADGE_COLORS.length] ?? '#22D3EE'
}

// ── Tooltip ───────────────────────────────────────────────────────────────────

interface TooltipState {
  x: number
  y: number
  rowSlug: string
  colSlug: string
  value: number
  sharedConcepts: string[]
}

// ── Greedy clustering: reorder slugs so high-correlation pairs are adjacent ───

function clusterOrder(projects: string[], matrix: number[][]): number[] {
  const n = projects.length
  if (n <= 1) return projects.map((_, i) => i)

  // Compute row sums as a simple proxy for "most connected"
  const rowSums = matrix.map((row) => row.reduce((s, v) => s + v, 0))

  // Start with highest row-sum
  const remaining = new Set(Array.from({ length: n }, (_, i) => i))
  const order: number[] = []

  // Pick highest row-sum first
  let start = 0
  let maxSum = -Infinity
  for (const i of remaining) {
    if (rowSums[i]! > maxSum) { maxSum = rowSums[i]!; start = i }
  }

  order.push(start)
  remaining.delete(start)

  // Greedy nearest-neighbor
  while (remaining.size > 0) {
    const last = order[order.length - 1]!
    let bestIdx = -1
    let bestSim = -1
    for (const i of remaining) {
      const sim = matrix[last]?.[i] ?? 0
      if (sim > bestSim) { bestSim = sim; bestIdx = i }
    }
    if (bestIdx === -1) break
    order.push(bestIdx)
    remaining.delete(bestIdx)
  }

  return order
}

// ── Shared concepts between two projects ─────────────────────────────────────

function getSharedConcepts(
  rowSlug: string,
  colSlug: string,
  topConcepts: MemoryCorrelationResponse['topConcepts'],
): string[] {
  return topConcepts
    .filter((c) => c.projects.includes(rowSlug) && c.projects.includes(colSlug))
    .map((c) => c.concept)
    .slice(0, 5)
}

// ── Heatmap SVG ───────────────────────────────────────────────────────────────

const CELL = 24         // cell size px
const LABEL_W = 100     // left label column width
const HEADER_H = 90     // top header row height

interface HeatmapProps {
  projects: string[]
  matrix: number[][]
  order: number[]
  topConcepts: MemoryCorrelationResponse['topConcepts']
  onHover: (t: TooltipState | null) => void
}

function Heatmap({ projects, matrix, order, topConcepts, onHover }: HeatmapProps) {
  const n = order.length
  const svgW = LABEL_W + n * CELL + 4
  const svgH = HEADER_H + n * CELL + 4

  const orderedSlugs = order.map((i) => projects[i]!)

  return (
    <svg
      width={svgW}
      height={svgH}
      style={{ display: 'block', minWidth: svgW }}
      onMouseLeave={() => onHover(null)}
    >
      {/* Column headers (rotated) */}
      {orderedSlugs.map((slug, ci) => (
        <text
          key={`col-${slug}`}
          x={LABEL_W + ci * CELL + CELL / 2}
          y={HEADER_H - 4}
          transform={`rotate(-50, ${LABEL_W + ci * CELL + CELL / 2}, ${HEADER_H - 4})`}
          textAnchor="end"
          fill="#475569"
          fontSize="0.38rem"
          fontFamily="monospace"
        >
          {slug.length > 16 ? slug.slice(0, 15) + '…' : slug}
        </text>
      ))}

      {/* Rows */}
      {orderedSlugs.map((rowSlug, ri) => {
        const y = HEADER_H + ri * CELL
        return (
          <g key={`row-${rowSlug}`}>
            {/* Row label */}
            <text
              x={LABEL_W - 5}
              y={y + CELL / 2 + 4}
              textAnchor="end"
              fill="#64748B"
              fontSize="0.38rem"
              fontFamily="monospace"
            >
              {rowSlug.length > 16 ? rowSlug.slice(0, 15) + '…' : rowSlug}
            </text>

            {/* Cells */}
            {orderedSlugs.map((colSlug, ci) => {
              const origRow = order[ri]!
              const origCol = order[ci]!
              const value = matrix[origRow]?.[origCol] ?? 0
              const isDiag = ri === ci
              const x = LABEL_W + ci * CELL

              return (
                <g key={`cell-${rowSlug}-${colSlug}`}>
                  <rect
                    x={x}
                    y={y}
                    width={CELL}
                    height={CELL}
                    fill={cellColor(value, isDiag)}
                    opacity={cellOpacity(value, isDiag)}
                    rx={1}
                    style={{
                      cursor: isDiag ? 'default' : 'crosshair',
                      filter: !isDiag && value > 0.3
                        ? `drop-shadow(0 0 2px rgba(0,245,255,${value * 0.5}))`
                        : isDiag
                        ? 'drop-shadow(0 0 3px rgba(124,58,237,0.6))'
                        : undefined,
                    }}
                    onMouseEnter={(e) => {
                      if (isDiag) return
                      const shared = getSharedConcepts(rowSlug, colSlug, topConcepts)
                      const rect = e.currentTarget.getBoundingClientRect()
                      onHover({
                        x: rect.left + rect.width / 2,
                        y: rect.top,
                        rowSlug,
                        colSlug,
                        value,
                        sharedConcepts: shared,
                      })
                    }}
                    onMouseLeave={() => onHover(null)}
                  />
                  {/* Show value text for non-zero, non-diagonal cells large enough */}
                  {!isDiag && value > 0.1 && (
                    <text
                      x={x + CELL / 2}
                      y={y + CELL / 2 + 3}
                      textAnchor="middle"
                      fill={value > 0.5 ? '#020811' : '#00F5FF'}
                      fontSize="0.3rem"
                      fontFamily="monospace"
                      style={{ pointerEvents: 'none', userSelect: 'none' }}
                    >
                      {value.toFixed(2)}
                    </text>
                  )}
                </g>
              )
            })}
          </g>
        )
      })}
    </svg>
  )
}

// ── Tooltip portal ────────────────────────────────────────────────────────────

function Tooltip({ t }: { t: TooltipState }) {
  return (
    <div
      style={{
        position: 'fixed',
        top: t.y - 8,
        left: t.x + 12,
        transform: 'translateY(-100%)',
        background: '#0D1829',
        border: '1px solid rgba(0,245,255,0.3)',
        borderRadius: 8,
        padding: '10px 14px',
        pointerEvents: 'none',
        zIndex: 1000,
        maxWidth: 260,
        boxShadow: '0 0 16px rgba(0,245,255,0.15)',
      }}
    >
      <div style={{ color: '#00F5FF', fontSize: 11, fontFamily: 'monospace', fontWeight: 'bold', marginBottom: 4 }}>
        {t.rowSlug} × {t.colSlug}
      </div>
      <div style={{ color: '#94A3B8', fontSize: 11, fontFamily: 'monospace', marginBottom: 6 }}>
        Jaccard similarity: <span style={{ color: '#00F5FF' }}>{t.value.toFixed(3)}</span>
      </div>
      {t.sharedConcepts.length > 0 ? (
        <div style={{ fontSize: 10, fontFamily: 'monospace', color: '#64748B' }}>
          <div style={{ marginBottom: 3 }}>shared concepts:</div>
          <div style={{ color: '#CBD5E1' }}>{t.sharedConcepts.join(', ')}</div>
        </div>
      ) : (
        <div style={{ fontSize: 10, fontFamily: 'monospace', color: '#374151' }}>
          no shared [[link]] references
        </div>
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function MemoryCorrelationPage() {
  const [data, setData] = useState<MemoryCorrelationResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tooltip, setTooltip] = useState<TooltipState | null>(null)
  const [clustered, setClustered] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void fetch('/api/memory-correlation')
      .then((r) => { if (!r.ok) throw new Error(r.statusText); return r.json() })
      .then((d: MemoryCorrelationResponse) => { setData(d); setLoading(false) })
      .catch((e: Error) => { setError(e.message); setLoading(false) })
  }, [])

  const projects = data?.projects ?? []
  const matrix = data?.matrix ?? []
  const topConcepts = data?.topConcepts ?? []

  // Natural order: 0..n-1
  const naturalOrder = projects.map((_, i) => i)
  // Clustered order
  const clusteredOrder = projects.length >= 2 ? clusterOrder(projects, matrix) : naturalOrder
  const order = clustered ? clusteredOrder : naturalOrder

  if (loading) return (
    <div style={{ background: '#020811', minHeight: '100vh', fontFamily: 'monospace' }}>
      <SubPageHeader title="MEMORY CORRELATION" />
      <div style={{ padding: '40px 24px', color: '#475569', fontSize: 13 }}>Scanning memory files…</div>
    </div>
  )

  if (error) return (
    <div style={{ background: '#020811', minHeight: '100vh', fontFamily: 'monospace' }}>
      <SubPageHeader title="MEMORY CORRELATION" />
      <div style={{ padding: '40px 24px', color: '#EF4444', fontSize: 13 }}>Error: {error}</div>
    </div>
  )

  if (!data || projects.length < 2) return (
    <div style={{ background: '#020811', minHeight: '100vh', fontFamily: 'monospace' }}>
      <SubPageHeader title="MEMORY CORRELATION" />
      <div style={{
        padding: '60px 24px', textAlign: 'center',
        color: '#475569', fontSize: 13,
      }}>
        Fleet has fewer than 2 projects with memory files
      </div>
    </div>
  )

  return (
    <div style={{ background: '#020811', minHeight: '100vh', fontFamily: 'monospace' }}>
      <SubPageHeader title="MEMORY CORRELATION" />

      {tooltip && <Tooltip t={tooltip} />}

      <div style={{ padding: '16px 24px', display: 'flex', gap: 20, alignItems: 'flex-start', flexWrap: 'wrap' }}>

        {/* Left: matrix + controls */}
        <div style={{ flex: 1, minWidth: 0 }}>

          {/* Stats + controls row */}
          <div style={{ display: 'flex', gap: 12, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{
              background: '#0D1829', border: '1px solid #1E3A5F', borderRadius: 8,
              padding: '8px 14px',
            }}>
              <div style={{ color: '#475569', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Projects</div>
              <div style={{ color: '#E2E8F0', fontSize: 20, fontWeight: 'bold' }}>{projects.length}</div>
            </div>
            <div style={{
              background: '#0D1829', border: '1px solid #1E3A5F', borderRadius: 8,
              padding: '8px 14px',
            }}>
              <div style={{ color: '#475569', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Concepts</div>
              <div style={{ color: '#00F5FF', fontSize: 20, fontWeight: 'bold' }}>{topConcepts.length > 0 ? topConcepts.reduce((s, c) => s + c.count, 0) : 0}</div>
            </div>
            <div style={{
              background: '#0D1829', border: '1px solid #1E3A5F', borderRadius: 8,
              padding: '8px 14px',
            }}>
              <div style={{ color: '#475569', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Unique Links</div>
              <div style={{ color: '#A78BFA', fontSize: 20, fontWeight: 'bold' }}>{topConcepts.length}</div>
            </div>

            <button
              onClick={() => setClustered((c) => !c)}
              style={{
                background: clustered ? 'rgba(0,245,255,0.12)' : '#0D1829',
                border: `1px solid ${clustered ? 'rgba(0,245,255,0.5)' : '#1E3A5F'}`,
                color: clustered ? '#00F5FF' : '#64748B',
                borderRadius: 6, padding: '6px 14px',
                cursor: 'pointer', fontSize: 11, fontFamily: 'monospace',
                fontWeight: clustered ? 'bold' : 'normal',
                transition: 'all 0.15s',
                boxShadow: clustered ? '0 0 8px rgba(0,245,255,0.2)' : 'none',
              }}
            >
              {clustered ? '⬡ Clustered' : '⬡ Cluster'}
            </button>

            <div style={{ marginLeft: 'auto', color: '#1E3A5F', fontSize: 10 }}>
              {new Date(data.generatedAt).toLocaleString()}
            </div>
          </div>

          {/* Color legend */}
          <div style={{ display: 'flex', gap: 16, marginBottom: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{
                width: 12, height: 12, borderRadius: 2,
                background: 'linear-gradient(to right, #020811, #00F5FF)',
                border: '1px solid #1E3A5F',
              }} />
              <span style={{ color: '#475569', fontSize: 10 }}>0 → 1 correlation</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ width: 12, height: 12, borderRadius: 2, background: '#7C3AED' }} />
              <span style={{ color: '#475569', fontSize: 10 }}>self (diagonal)</span>
            </div>
            <span style={{ color: '#374151', fontSize: 9 }}>Jaccard similarity of [[link]] reference sets</span>
          </div>

          {/* Heatmap (scrollable) */}
          <div
            ref={scrollRef}
            style={{
              background: '#0A1220',
              border: '1px solid #1E3A5F',
              borderRadius: 10,
              overflowX: 'auto',
              padding: '16px',
            }}
          >
            <Heatmap
              projects={projects}
              matrix={matrix}
              order={order}
              topConcepts={topConcepts}
              onHover={setTooltip}
            />
          </div>
        </div>

        {/* Right sidebar: top concepts */}
        <div style={{
          width: 260, flexShrink: 0,
          background: '#0A1220',
          border: '1px solid #1E3A5F',
          borderRadius: 10,
          padding: '16px',
        }}>
          <div style={{
            color: '#475569', fontSize: 10,
            textTransform: 'uppercase', letterSpacing: '0.1em',
            marginBottom: 14,
          }}>
            Top Cross-Referenced Concepts
          </div>

          {topConcepts.length === 0 ? (
            <div style={{ color: '#374151', fontSize: 11 }}>No [[link]] references found</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {topConcepts.map((c, idx) => (
                <div key={c.concept} style={{
                  background: idx % 2 === 0 ? 'rgba(255,255,255,0.02)' : 'transparent',
                  borderRadius: 6, padding: '8px 10px',
                }}>
                  {/* Concept name + count */}
                  <div style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
                    marginBottom: 6,
                  }}>
                    <span style={{
                      color: '#CBD5E1', fontSize: 11, fontFamily: 'monospace',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      maxWidth: 150,
                    }}>
                      [[{c.concept}]]
                    </span>
                    <span style={{
                      color: '#00F5FF', fontSize: 10, fontFamily: 'monospace',
                      flexShrink: 0, marginLeft: 4,
                      textShadow: '0 0 6px rgba(0,245,255,0.5)',
                    }}>
                      ×{c.count}
                    </span>
                  </div>

                  {/* Count bar */}
                  <div style={{
                    background: '#0D1829', borderRadius: 2, height: 3, marginBottom: 7,
                    overflow: 'hidden',
                  }}>
                    <div style={{
                      background: '#00F5FF',
                      height: '100%',
                      width: `${Math.min(100, (c.count / (topConcepts[0]?.count ?? 1)) * 100)}%`,
                      borderRadius: 2,
                      boxShadow: '0 0 4px rgba(0,245,255,0.5)',
                    }} />
                  </div>

                  {/* Project badges */}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {c.projects.map((slug) => (
                      <span
                        key={slug}
                        style={{
                          fontSize: 8, fontFamily: 'monospace',
                          color: badgeColor(slug, projects),
                          background: `${badgeColor(slug, projects)}18`,
                          border: `1px solid ${badgeColor(slug, projects)}40`,
                          borderRadius: 3, padding: '1px 5px',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          maxWidth: 90,
                        }}
                        title={slug}
                      >
                        {slug.length > 10 ? slug.slice(0, 9) + '…' : slug}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Legend: project color map */}
          {projects.length > 0 && (
            <div style={{
              marginTop: 20,
              borderTop: '1px solid #1E293B',
              paddingTop: 14,
            }}>
              <div style={{
                color: '#374151', fontSize: 9,
                textTransform: 'uppercase', letterSpacing: '0.08em',
                marginBottom: 8,
              }}>
                Project Index
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {projects.map((slug, i) => (
                  <div key={slug} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    <div style={{
                      width: 8, height: 8, borderRadius: '50%',
                      background: badgeColor(slug, projects),
                      flexShrink: 0,
                      boxShadow: `0 0 4px ${badgeColor(slug, projects)}88`,
                    }} />
                    <span style={{
                      color: '#64748B', fontSize: 9, fontFamily: 'monospace',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {slug}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
