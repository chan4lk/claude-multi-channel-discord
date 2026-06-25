'use client'

import { useEffect, useRef, useState } from 'react'
import * as d3 from 'd3'
import SubPageHeader from '../../components/SubPageHeader'

interface AlignmentMatrix {
  slugs: string[]
  matrix: number[][]
  goals: Record<string, string>
  statuses: Record<string, 'active' | 'paused' | 'completed'>
  outliers: string[]
}

function simColor(v: number): string {
  if (v <= 0) return '#0d1a2e'
  if (v >= 1) return '#00F5FF'
  return d3.interpolateRgb('#0d3a5c', '#00F5FF')(v)
}

function statusDot(s: 'active' | 'paused' | 'completed'): string {
  if (s === 'active') return '#22C55E'
  if (s === 'paused') return '#F59E0B'
  return '#64748B'
}

export default function GoalAlignmentPage() {
  const [data, setData] = useState<AlignmentMatrix | null>(null)
  const [loading, setLoading] = useState(true)
  const [tooltip, setTooltip] = useState<{ x: number; y: number; text: string } | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    const load = () => {
      fetch('/api/goal-alignment')
        .then((r) => r.json())
        .then((d: AlignmentMatrix) => { setData(d); setLoading(false) })
        .catch(() => setLoading(false))
    }
    load()
    const id = setInterval(() => { setTick((t) => t + 1); load() }, 60_000)
    return () => clearInterval(id)
  }, [])

  void tick // suppress lint warning

  const CELL = 28
  const GAP = 2
  const LABEL_W = 100

  if (loading) {
    return (
      <div style={{ background: '#080F1E', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: '#00F5FF', fontFamily: 'monospace' }}>Loading goal alignment…</div>
      </div>
    )
  }

  if (!data || data.slugs.length === 0) {
    return (
      <div style={{ background: '#080F1E', minHeight: '100vh', color: '#94A3B8', fontFamily: 'monospace', padding: 40 }}>
        <SubPageHeader title="Goal Alignment Matrix" />
        <div style={{ marginTop: 40, color: '#475569', fontSize: 14 }}>
          No projects with GOAL.md found. Add goal files to see alignment.
        </div>
      </div>
    )
  }

  const { slugs, matrix, goals, statuses, outliers } = data
  const n = slugs.length
  const gridSize = n * (CELL + GAP) - GAP

  return (
    <div ref={containerRef} style={{ background: '#080F1E', minHeight: '100vh', fontFamily: 'monospace', padding: '0 0 48px 0' }}>
      <SubPageHeader title="Goal Alignment Matrix" />

      <div style={{ padding: '24px 32px' }}>
        <div style={{ color: '#475569', fontSize: 12, marginBottom: 24 }}>
          Pairwise Jaccard similarity of goal keyword sets across {n} projects. Brighter = more overlap.
        </div>

        {/* Heatmap */}
        <div style={{ display: 'flex', gap: 0, overflowX: 'auto', overflowY: 'auto', maxHeight: '70vh' }}>
          {/* Row labels */}
          <div style={{ flexShrink: 0 }}>
            {/* Spacer for column label row */}
            <div style={{ height: LABEL_W }} />
            {slugs.map((slug) => (
              <div key={slug} style={{
                height: CELL + GAP,
                width: LABEL_W,
                display: 'flex',
                alignItems: 'center',
                paddingRight: 8,
                justifyContent: 'flex-end',
                gap: 4,
              }}>
                <div style={{
                  width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
                  background: statusDot(statuses[slug] ?? 'active'),
                }} />
                <span style={{
                  color: '#94A3B8', fontSize: 10, overflow: 'hidden',
                  textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  maxWidth: LABEL_W - 20,
                }}>{slug}</span>
              </div>
            ))}
          </div>

          {/* Grid */}
          <div style={{ flexShrink: 0 }}>
            {/* Column labels (rotated) */}
            <div style={{ position: 'relative', height: LABEL_W, width: gridSize }}>
              {slugs.map((slug, j) => (
                <div key={j} style={{
                  position: 'absolute',
                  left: j * (CELL + GAP) + CELL / 2,
                  bottom: 0,
                  transform: 'rotate(-45deg)',
                  transformOrigin: 'left bottom',
                  color: '#94A3B8',
                  fontSize: 10,
                  whiteSpace: 'nowrap',
                }}>{slug}</div>
              ))}
            </div>

            {/* Cells */}
            {slugs.map((rowSlug, i) => (
              <div key={rowSlug} style={{ display: 'flex', gap: GAP, marginBottom: GAP }}>
                {slugs.map((colSlug, j) => {
                  const v = matrix[i][j]
                  const isDiag = i === j
                  return (
                    <div
                      key={j}
                      onMouseEnter={(e) => {
                        const rect = (e.target as HTMLElement).getBoundingClientRect()
                        setTooltip({
                          x: rect.left + CELL / 2,
                          y: rect.top - 8,
                          text: isDiag
                            ? `${rowSlug}: ${goals[rowSlug] ?? '(no goal)'}`
                            : `${rowSlug} ↔ ${colSlug}: ${(v * 100).toFixed(0)}% overlap`,
                        })
                      }}
                      onMouseLeave={() => setTooltip(null)}
                      style={{
                        width: CELL,
                        height: CELL,
                        background: isDiag ? '#1E3A5F' : simColor(v),
                        borderRadius: 3,
                        flexShrink: 0,
                        cursor: 'default',
                        border: isDiag ? '1px solid #2D5A8E' : '1px solid transparent',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      {isDiag && (
                        <div style={{ width: 8, height: 8, background: '#3B82F6', borderRadius: '50%' }} />
                      )}
                    </div>
                  )
                })}
              </div>
            ))}

            {/* Legend */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 16 }}>
              <span style={{ color: '#475569', fontSize: 11 }}>0%</span>
              {[0, 0.2, 0.4, 0.6, 0.8, 1].map((v) => (
                <div key={v} style={{ width: CELL, height: 10, background: simColor(v), borderRadius: 2 }} />
              ))}
              <span style={{ color: '#00F5FF', fontSize: 11 }}>100%</span>
            </div>
          </div>
        </div>

        {/* Outlier panel */}
        {outliers.length > 0 && (
          <div style={{
            marginTop: 32, background: '#0B1628', border: '1px solid #1E3A5F',
            borderRadius: 8, padding: '16px 20px',
          }}>
            <div style={{ color: '#F59E0B', fontSize: 12, fontWeight: 700, marginBottom: 12 }}>
              ⚠ Outlier Projects ({outliers.length})
            </div>
            <div style={{ color: '#64748B', fontSize: 11, marginBottom: 12 }}>
              No goal file or &lt;5% keyword overlap with all other projects.
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {outliers.map((slug) => (
                <div key={slug} style={{
                  background: '#0F2240', border: '1px solid #F59E0B40',
                  borderRadius: 4, padding: '4px 10px', color: '#F59E0B', fontSize: 11,
                }}>
                  {slug}
                  {goals[slug] && (
                    <span style={{ color: '#475569', marginLeft: 8 }}>
                      {goals[slug].slice(0, 50)}{goals[slug].length > 50 ? '…' : ''}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Tooltip */}
      {tooltip && (
        <div style={{
          position: 'fixed',
          left: tooltip.x,
          top: tooltip.y,
          transform: 'translate(-50%, -100%)',
          background: '#0B1628',
          border: '1px solid #1E3A5F',
          borderRadius: 6,
          padding: '6px 10px',
          fontSize: 11,
          color: '#CBD5E1',
          whiteSpace: 'nowrap',
          zIndex: 100,
          pointerEvents: 'none',
          maxWidth: 320,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}>
          {tooltip.text}
        </div>
      )}
    </div>
  )
}
