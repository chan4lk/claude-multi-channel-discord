'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import SubPageHeader from '../../components/SubPageHeader'
import type { CapabilityMapResponse, ProjectCapability, CellState } from '../api/capability-map/route'

const CELL_SIZE = 20
const GAP = 2
const LABEL_W = 120
const COL_W = 80
const HEADER_H = 56

const STATE_COLORS: Record<CellState, string> = {
  'allowed-used':   '#10B981',  // green
  'allowed-unused': '#22D3EE',  // cyan
  'implicit-used':  '#F59E0B',  // amber
  'disallowed':     '#EF4444',  // red
  'none':           '#0d1f3c',  // dark
}

const STATE_LABELS: Record<CellState, string> = {
  'allowed-used':   'Allowed + Used',
  'allowed-unused': 'Allowed + Unused',
  'implicit-used':  'Used (implicit)',
  'disallowed':     'Disallowed',
  'none':           'No data',
}

function cellState(tool: string, proj: ProjectCapability): CellState {
  const isDisallowed = proj.disallowedTools.includes(tool)
  if (isDisallowed) return 'disallowed'

  const isUsed = (proj.usedTools[tool] ?? 0) > 0
  const isAllowed = proj.isWildcard ||
    proj.allowedTools.includes(tool) ||
    proj.allowedTools.includes('*')

  if (isAllowed && isUsed) return 'allowed-used'
  if (isAllowed && !isUsed) return 'allowed-unused'
  if (!isAllowed && isUsed) return 'implicit-used'
  return 'none'
}

function CoverageBar({ score }: { score: number }) {
  const color = score >= 70 ? '#10B981' : score >= 40 ? '#F59E0B' : '#EF4444'
  return (
    <div style={{ width: COL_W - 8, marginTop: 4 }}>
      <div style={{ background: '#1E3A5F', borderRadius: 2, height: 4, overflow: 'hidden' }}>
        <div style={{ width: `${score}%`, height: '100%', background: color, transition: 'width 0.3s' }} />
      </div>
      <div style={{ color, fontSize: 9, textAlign: 'center', marginTop: 2 }}>{score}%</div>
    </div>
  )
}

export default function CapabilityMapPage() {
  const [data, setData] = useState<CapabilityMapResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [hovered, setHovered] = useState<{ tool: string; proj: ProjectCapability } | null>(null)
  const [tooltip, setTooltip] = useState<{ x: number; y: number } | null>(null)

  useEffect(() => {
    fetch('/api/capability-map')
      .then((r) => r.json())
      .then((d: CapabilityMapResponse) => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div style={{ background: '#080F1E', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: '#00F5FF', fontFamily: 'monospace' }}>Loading capability map…</div>
      </div>
    )
  }

  if (!data || data.projects.length === 0) {
    return (
      <div style={{ background: '#080F1E', minHeight: '100vh', color: '#94A3B8', fontFamily: 'monospace', padding: 40 }}>
        <SubPageHeader title="Capability Map" />
      </div>
    )
  }

  const { tools, projects } = data

  const gridW = projects.length * (COL_W + GAP) - GAP
  const gridH = tools.length * (CELL_SIZE + GAP) - GAP

  return (
    <div style={{ background: '#080F1E', minHeight: '100vh', fontFamily: 'monospace', padding: '24px 32px' }}>
      <SubPageHeader title="Capability Map" />

      {/* Legend */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        {(Object.entries(STATE_LABELS) as [CellState, string][]).map(([state, label]) => (
          <div key={state} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 12, height: 12, background: STATE_COLORS[state], borderRadius: 2 }} />
            <span style={{ color: '#94A3B8', fontSize: 11 }}>{label}</span>
          </div>
        ))}
      </div>

      <div style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: '70vh', position: 'relative' }}>
        <div style={{ display: 'flex', minWidth: LABEL_W + gridW + 16 }}>
          {/* Tool label column */}
          <div style={{ width: LABEL_W, flexShrink: 0 }}>
            {/* Header spacer */}
            <div style={{ height: HEADER_H }} />
            {tools.map((tool) => (
              <div key={tool} style={{
                height: CELL_SIZE + GAP, display: 'flex', alignItems: 'center',
                paddingRight: 8,
              }}>
                <Link
                  href={`/permissions?tool=${encodeURIComponent(tool)}`}
                  style={{
                    color: '#94A3B8', fontSize: 11, textDecoration: 'none', overflow: 'hidden',
                    whiteSpace: 'nowrap', textOverflow: 'ellipsis', maxWidth: LABEL_W - 8,
                    display: 'block',
                  }}
                  title={tool}
                >
                  {tool}
                </Link>
              </div>
            ))}
          </div>

          {/* Grid */}
          <div style={{ position: 'relative' }}>
            {/* Column headers */}
            <div style={{ display: 'flex', gap: GAP, height: HEADER_H, alignItems: 'flex-end', paddingBottom: 4 }}>
              {projects.map((proj) => (
                <div key={proj.slug} style={{ width: COL_W, flexShrink: 0 }}>
                  <div style={{
                    color: '#CBD5E1', fontSize: 10, textAlign: 'center',
                    overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
                    transform: 'rotate(-35deg)', transformOrigin: 'center bottom',
                    marginBottom: 4,
                  }} title={proj.slug}>{proj.slug}</div>
                  <CoverageBar score={proj.coverageScore} />
                </div>
              ))}
            </div>

            {/* Cells */}
            <div style={{ position: 'relative', width: gridW, height: gridH }}>
              {tools.map((tool) => (
                <div key={tool} style={{ display: 'flex', gap: GAP, marginBottom: GAP }}>
                  {projects.map((proj, pi) => {
                    const state = cellState(tool, proj)
                    const count = proj.usedTools[tool] ?? 0
                    const isHov = hovered?.tool === tool && hovered?.proj.slug === proj.slug
                    return (
                      <div
                        key={pi}
                        onMouseEnter={(e) => {
                          setHovered({ tool, proj })
                          setTooltip({ x: e.clientX, y: e.clientY })
                        }}
                        onMouseLeave={() => { setHovered(null); setTooltip(null) }}
                        style={{
                          width: COL_W, height: CELL_SIZE, flexShrink: 0,
                          background: STATE_COLORS[state],
                          borderRadius: 3,
                          cursor: 'default',
                          border: isHov ? '2px solid #FFFFFF' : '2px solid transparent',
                          opacity: state === 'none' ? 0.4 : 1,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}
                      >
                        {count > 0 && (
                          <span style={{ color: 'rgba(0,0,0,0.7)', fontSize: 9, fontWeight: 700 }}>
                            {count > 99 ? '99+' : count}
                          </span>
                        )}
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Tooltip */}
      {hovered && tooltip && (
        <div style={{
          position: 'fixed', left: tooltip.x + 12, top: tooltip.y - 8,
          background: '#0B1628', border: '1px solid #1E3A5F', borderRadius: 6,
          padding: '8px 12px', zIndex: 100, pointerEvents: 'none', fontSize: 12,
        }}>
          <div style={{ color: '#00F5FF', fontWeight: 700 }}>{hovered.tool}</div>
          <div style={{ color: '#94A3B8' }}>{hovered.proj.slug}</div>
          <div style={{ color: STATE_COLORS[cellState(hovered.tool, hovered.proj)], marginTop: 4 }}>
            {STATE_LABELS[cellState(hovered.tool, hovered.proj)]}
          </div>
          {(hovered.proj.usedTools[hovered.tool] ?? 0) > 0 && (
            <div style={{ color: '#64748B', marginTop: 2 }}>
              {hovered.proj.usedTools[hovered.tool]} uses (7d)
            </div>
          )}
        </div>
      )}

      <div style={{ color: '#475569', fontSize: 11, marginTop: 16 }}>
        {tools.length} tools × {projects.length} projects
        {data.generatedAt && ` · cached ${new Date(data.generatedAt).toLocaleTimeString()}`}
      </div>
    </div>
  )
}
