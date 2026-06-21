'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import SubPageHeader from '../../components/SubPageHeader'
import type { FleetResponse } from '../api/fleet/route'
import type { FlamegraphResponse, TurnFlame, ToolCallFlame, ToolCategory } from '../api/flamegraph/[slug]/route'

// ─── color mapping ────────────────────────────────────────────────────────────
const CAT_COLOR: Record<ToolCategory, string> = {
  bash:  '#F97316',
  read:  '#3B82F6',
  write: '#06B6D4',
  agent: '#A78BFA',
  mcp:   '#22D3EE',
  other: '#64748B',
}
const CAT_LABEL: Record<ToolCategory, string> = {
  bash:  'Bash',
  read:  'Read',
  write: 'Write/Edit',
  agent: 'Agent',
  mcp:   'MCP',
  other: 'Other',
}

// ─── tooltip state ────────────────────────────────────────────────────────────
interface Tooltip {
  x: number
  y: number
  tool: ToolCallFlame
  turnIdx: number
}

// ─── layout constants ─────────────────────────────────────────────────────────
const ROW_H = 28
const LABEL_W = 160
const AXIS_H = 20
const MIN_BLOCK_W = 4
const BLOCK_H = 18
const BLOCK_Y_OFFSET = (ROW_H - BLOCK_H) / 2
const PADDING_RIGHT = 16

function fmtMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`
}

function FlameTurn({
  turn,
  width,
  rowIdx,
  onTooltip,
}: {
  turn: TurnFlame
  width: number
  rowIdx: number
  onTooltip: (t: Tooltip | null) => void
}) {
  const drawW = width - LABEL_W - PADDING_RIGHT
  const scale = drawW / Math.max(turn.durationMs, 1)
  const y = rowIdx * ROW_H

  return (
    <g>
      {/* row bg */}
      <rect x={0} y={y} width={width} height={ROW_H}
        fill={rowIdx % 2 === 0 ? '#0d1525' : '#0a1020'} />

      {/* label */}
      <text x={8} y={y + ROW_H / 2 + 4}
        fill="#475569" fontSize={9} fontFamily="monospace"
        clipPath={`url(#lbl-clip-${rowIdx})`}>
        T{turn.turnIndex + 1} {turn.userSnippet || '—'}
      </text>
      <clipPath id={`lbl-clip-${rowIdx}`}>
        <rect x={0} y={y} width={LABEL_W - 8} height={ROW_H} />
      </clipPath>

      {/* tool call blocks */}
      {turn.toolCalls.map((tc, ci) => {
        const bx = LABEL_W + tc.startMs * scale
        const bw = Math.max(MIN_BLOCK_W, tc.durationMs * scale)
        const color = CAT_COLOR[tc.category]
        const isErr = tc.status === 'error'
        return (
          <g key={`${tc.toolUseId}-${ci}`}>
            <rect
              x={bx} y={y + BLOCK_Y_OFFSET}
              width={Math.min(bw, drawW - (bx - LABEL_W))}
              height={BLOCK_H}
              fill={isErr ? '#EF4444' : color}
              fillOpacity={isErr ? 0.85 : 0.75}
              rx={2}
              style={{ cursor: 'pointer' }}
              onMouseEnter={(e) => {
                const rect = (e.target as SVGElement).closest('svg')?.getBoundingClientRect()
                onTooltip({
                  x: e.clientX - (rect?.left ?? 0),
                  y: e.clientY - (rect?.top ?? 0),
                  tool: tc,
                  turnIdx: turn.turnIndex,
                })
              }}
              onMouseLeave={() => onTooltip(null)}
            />
            {bw > 30 && (
              <text
                x={bx + 3} y={y + BLOCK_Y_OFFSET + 12}
                fill="#fff" fillOpacity={0.8} fontSize={8} fontFamily="monospace"
                pointerEvents="none"
                clipPath={`url(#blk-clip-${rowIdx}-${ci})`}>
                {tc.name.replace('mcp__', '')}
              </text>
            )}
            <clipPath id={`blk-clip-${rowIdx}-${ci}`}>
              <rect x={bx} y={y + BLOCK_Y_OFFSET} width={Math.min(bw, drawW - (bx - LABEL_W))} height={BLOCK_H} />
            </clipPath>
          </g>
        )
      })}
    </g>
  )
}

export default function FlamegraphPage() {
  const [slugs, setSlugs] = useState<string[]>([])
  const [selected, setSelected] = useState<string>('')
  const [data, setData] = useState<FlamegraphResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [tooltip, setTooltip] = useState<Tooltip | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const [svgWidth, setSvgWidth] = useState(900)

  // load slugs
  useEffect(() => {
    fetch('/api/fleet')
      .then((r) => r.json())
      .then((d: FleetResponse) => {
        const ss = d.projects.map((p) => p.slug).sort()
        setSlugs(ss)
        if (ss.length > 0) setSelected(ss[0])
      })
      .catch(() => {})
  }, [])

  // load flamegraph data
  const loadData = useCallback((slug: string) => {
    if (!slug) return
    setLoading(true)
    fetch(`/api/flamegraph/${encodeURIComponent(slug)}?turns=20`)
      .then((r) => r.json())
      .then((d: FlamegraphResponse) => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  useEffect(() => { if (selected) loadData(selected) }, [selected, loadData])

  // track svg width
  useEffect(() => {
    const obs = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width
      if (w) setSvgWidth(w)
    })
    if (svgRef.current?.parentElement) obs.observe(svgRef.current.parentElement)
    return () => obs.disconnect()
  }, [data])

  const turns = data?.turns ?? []
  const svgH = turns.length * ROW_H + AXIS_H + 4

  // x-axis ticks: find max duration
  const maxDur = turns.length > 0 ? Math.max(...turns.map((t) => t.durationMs)) : 1
  const tickCount = 5
  const drawW = svgWidth - LABEL_W - PADDING_RIGHT

  return (
    <div className="min-h-screen flex flex-col" style={{ background: '#060d18', color: '#CBD5E1' }}>
      <SubPageHeader title="Turn Flame Graph">
        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          className="text-xs font-mono rounded px-2 py-1"
          style={{ background: '#0d1525', color: '#94A3B8', border: '1px solid #1e3a5f' }}
        >
          {slugs.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <button
          onClick={() => loadData(selected)}
          disabled={loading}
          className="text-[0.6rem] font-mono px-2 py-1 rounded border transition-colors"
          style={{
            borderColor: '#1e3a5f', color: '#64748B',
            background: loading ? '#0d1525' : 'transparent',
          }}
        >
          {loading ? '...' : '↺ Refresh'}
        </button>
      </SubPageHeader>

      <div className="flex-1 p-4 sm:p-6 overflow-x-auto">
        {/* legend */}
        <div className="flex flex-wrap gap-3 mb-4">
          {(Object.keys(CAT_COLOR) as ToolCategory[]).map((cat) => (
            <div key={cat} className="flex items-center gap-1.5 text-[0.6rem] font-mono">
              <span className="w-3 h-3 rounded" style={{ background: CAT_COLOR[cat] }} />
              <span style={{ color: '#64748B' }}>{CAT_LABEL[cat]}</span>
            </div>
          ))}
          <div className="flex items-center gap-1.5 text-[0.6rem] font-mono">
            <span className="w-3 h-3 rounded" style={{ background: '#EF4444' }} />
            <span style={{ color: '#64748B' }}>Error</span>
          </div>
        </div>

        {turns.length === 0 && !loading && (
          <div className="text-center py-20" style={{ color: '#334155' }}>
            <div className="text-4xl mb-3">⌬</div>
            <div className="text-sm font-mono">No turn data for <span style={{ color: '#22D3EE' }}>{selected || '—'}</span></div>
            <div className="text-xs mt-1" style={{ color: '#1e3a5f' }}>Select a project with transcript history</div>
          </div>
        )}

        {turns.length > 0 && (
          <div className="relative" style={{ minWidth: 600 }}>
            <svg
              ref={svgRef}
              width="100%"
              height={svgH}
              style={{ display: 'block' }}
            >
              {/* x-axis */}
              {Array.from({ length: tickCount + 1 }, (_, ti) => {
                const frac = ti / tickCount
                const ms = frac * maxDur
                const x = LABEL_W + frac * drawW
                return (
                  <g key={ti}>
                    <line x1={x} y1={0} x2={x} y2={turns.length * ROW_H}
                      stroke="#1e3a5f" strokeWidth={1} strokeDasharray="2,4" />
                    <text x={x} y={turns.length * ROW_H + AXIS_H - 4}
                      fill="#334155" fontSize={8} fontFamily="monospace" textAnchor="middle">
                      {fmtMs(Math.round(ms))}
                    </text>
                  </g>
                )
              })}

              {/* turns */}
              {turns.map((turn, ri) => (
                <FlameTurn
                  key={turn.turnIndex}
                  turn={turn}
                  width={svgWidth}
                  rowIdx={ri}
                  onTooltip={setTooltip}
                />
              ))}

              {/* separator line between label area and blocks */}
              <line x1={LABEL_W} y1={0} x2={LABEL_W} y2={turns.length * ROW_H}
                stroke="#1e3a5f" strokeWidth={1} />
            </svg>

            {/* tooltip */}
            {tooltip && (
              <div
                className="absolute z-50 rounded text-[0.6rem] font-mono pointer-events-none"
                style={{
                  left: tooltip.x + 12,
                  top: tooltip.y - 10,
                  background: '#0d1525',
                  border: '1px solid #1e3a5f',
                  padding: '6px 8px',
                  color: '#CBD5E1',
                  maxWidth: 200,
                  boxShadow: '0 4px 20px rgba(0,0,0,0.6)',
                }}
              >
                <div style={{ color: CAT_COLOR[tooltip.tool.category], fontWeight: 700 }}>
                  {tooltip.tool.name}
                </div>
                <div style={{ color: '#64748B' }}>turn {tooltip.turnIdx + 1}</div>
                <div>
                  <span style={{ color: '#94A3B8' }}>start: </span>
                  {fmtMs(tooltip.tool.startMs)}
                </div>
                <div>
                  <span style={{ color: '#94A3B8' }}>duration: </span>
                  <span style={{ color: tooltip.tool.status === 'error' ? '#EF4444' : '#4ADE80' }}>
                    {fmtMs(tooltip.tool.durationMs)}
                  </span>
                </div>
                {tooltip.tool.status === 'error' && (
                  <div style={{ color: '#EF4444' }}>⚠ error</div>
                )}
                <div style={{ color: '#334155' }}>{CAT_LABEL[tooltip.tool.category]}</div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
