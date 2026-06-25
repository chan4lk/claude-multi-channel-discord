'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import type { FleetResponse, FleetProject, ProjectState } from '../api/fleet/route'
import { useFreshness } from '../../lib/useFreshness'
import FreshnessBadge from '../../components/FreshnessBadge'
import SubPageHeader from '../../components/SubPageHeader'

const STATE_COLOR: Record<ProjectState, string> = {
  active: '#4ADE80',
  idle: '#22D3EE',
  stalled: '#EF4444',
  autonomous: '#A78BFA',
}

const STATE_BG: Record<ProjectState, string> = {
  active: 'rgba(74,222,128,0.12)',
  idle: 'rgba(34,211,238,0.10)',
  stalled: 'rgba(239,68,68,0.15)',
  autonomous: 'rgba(167,139,250,0.12)',
}

function fmtAge(mins: number): string {
  if (mins < 60) return `${Math.round(mins)}m`
  if (mins < 1440) return `${(mins / 60).toFixed(1)}h`
  return `${(mins / 1440).toFixed(1)}d`
}

interface TileRect {
  x: number
  y: number
  w: number
  h: number
  project: FleetProject
}

function squarify(
  items: { value: number; project: FleetProject }[],
  x: number,
  y: number,
  w: number,
  h: number
): TileRect[] {
  if (items.length === 0) return []
  if (items.length === 1) {
    return [{ x, y, w, h, project: items[0].project }]
  }

  const total = items.reduce((s, i) => s + i.value, 0)
  const results: TileRect[] = []

  let remaining = [...items]
  let rx = x, ry = y, rw = w, rh = h

  while (remaining.length > 0) {
    const remainTotal = remaining.reduce((s, i) => s + i.value, 0)
    const shortSide = Math.min(rw, rh)
    const isHoriz = rw >= rh

    let row: typeof remaining = []
    let rowVal = 0
    let bestRatio = Infinity

    for (let i = 0; i < remaining.length; i++) {
      const candidate = remaining[i]
      const newRow = [...row, candidate]
      const newVal = rowVal + candidate.value
      const rowFrac = newVal / remainTotal
      const rowLen = (isHoriz ? rw : rh) * rowFrac
      const minVal = Math.min(...newRow.map(n => n.value))
      const maxVal = Math.max(...newRow.map(n => n.value))
      const minTile = (minVal / newVal) * shortSide
      const maxTile = (maxVal / newVal) * shortSide
      const ratio = Math.max(
        rowLen === 0 ? Infinity : maxTile / rowLen,
        rowLen === 0 ? Infinity : rowLen / minTile
      )
      if (ratio <= bestRatio || row.length === 0) {
        bestRatio = ratio
        row = newRow
        rowVal = newVal
      } else {
        break
      }
    }

    const rowFrac = rowVal / remainTotal
    const rowLen = isHoriz ? rw * rowFrac : rh * rowFrac
    let cursor = isHoriz ? ry : rx

    for (const item of row) {
      const tileFrac = item.value / rowVal
      const tileLen = (isHoriz ? rh : rw) * tileFrac
      if (isHoriz) {
        results.push({ x: rx, y: cursor, w: rowLen, h: tileLen, project: item.project })
        cursor += tileLen
      } else {
        results.push({ x: cursor, y: ry, w: tileLen, h: rowLen, project: item.project })
        cursor += tileLen
      }
    }

    if (isHoriz) {
      rx += rowLen
      rw -= rowLen
    } else {
      ry += rowLen
      rh -= rowLen
    }

    remaining = remaining.slice(row.length)
  }

  return results
}

interface TooltipData {
  project: FleetProject
  mx: number
  my: number
}

export default function FleetMosaicPage() {
  const { data, isStale, lastError, lastSuccessAt } = useFreshness<FleetResponse>('/api/fleet', 60_000)
  const [tooltip, setTooltip] = useState<TooltipData | null>(null)

  const W = 900
  const H = 560
  const PAD = 2

  const tiles = useMemo<TileRect[]>(() => {
    const projects = data?.projects ?? []
    if (projects.length === 0) return []
    const items = projects.map(p => ({
      value: Math.max(5, p.contextUsagePct ?? 5),
      project: p,
    }))
    items.sort((a, b) => b.value - a.value)
    return squarify(items, 0, 0, W, H)
  }, [data])

  const loading = data === null && lastError === null

  return (
    <div className="min-h-screen p-4 md:p-6" style={{ background: '#080f1c', color: '#E2E8F0' }}>
      <SubPageHeader title="Fleet Mosaic">
        <FreshnessBadge isStale={isStale} lastError={lastError} lastSuccessAt={lastSuccessAt} />
      </SubPageHeader>

      <p className="text-xs text-slate-500 mb-4">
        Tile area ∝ context fill %. Color = project state. Hover for details, click to open feed.
      </p>

      {/* Legend */}
      <div className="flex gap-4 mb-4">
        {(Object.entries(STATE_COLOR) as [ProjectState, string][]).map(([state, color]) => (
          <div key={state} className="flex items-center gap-1.5 text-xs font-mono">
            <span style={{ width: 10, height: 10, background: color, borderRadius: 2, display: 'inline-block' }} />
            <span style={{ color }}>{state}</span>
          </div>
        ))}
      </div>

      {loading && (
        <div className="text-center py-20 text-slate-600 font-mono text-sm animate-pulse">Loading fleet…</div>
      )}

      {!loading && tiles.length === 0 && (
        <div className="text-center py-20 text-slate-600 font-mono text-sm">No projects in fleet.</div>
      )}

      {tiles.length > 0 && (
        <div className="relative" style={{ maxWidth: W }}>
          <svg
            width="100%"
            viewBox={`0 0 ${W} ${H}`}
            style={{ display: 'block', cursor: 'crosshair' }}
            onMouseLeave={() => setTooltip(null)}
          >
            {tiles.map(({ x, y, w, h, project }) => {
              const color = STATE_COLOR[project.state] ?? '#64748B'
              const bg = STATE_BG[project.state] ?? 'rgba(100,116,139,0.10)'
              const conv = project.convergenceScore != null
                ? `${Math.round(project.convergenceScore * 100)}%`
                : null
              const ctx = project.contextUsagePct != null
                ? `${Math.round(project.contextUsagePct)}%`
                : null
              const hasMem = (project.memoryStatus?.sizeBytes ?? 0) > 0
              const fontSize = Math.min(13, Math.max(8, Math.min(w, h) / 6))
              const showLabels = w > 40 && h > 30
              const showSub = w > 60 && h > 50

              return (
                <g key={project.slug}>
                  <rect
                    x={x + PAD}
                    y={y + PAD}
                    width={Math.max(0, w - PAD * 2)}
                    height={Math.max(0, h - PAD * 2)}
                    fill={bg}
                    stroke={color}
                    strokeWidth={1.5}
                    rx={3}
                    style={{ cursor: 'pointer' }}
                    onMouseMove={e => {
                      const svg = (e.target as SVGElement).ownerSVGElement!
                      const rect = svg.getBoundingClientRect()
                      setTooltip({
                        project,
                        mx: e.clientX - rect.left,
                        my: e.clientY - rect.top,
                      })
                    }}
                    onClick={() => {
                      window.location.href = `/feed?slug=${encodeURIComponent(project.slug)}`
                    }}
                  />
                  {showLabels && (
                    <>
                      <text
                        x={x + PAD + 6}
                        y={y + PAD + fontSize + 4}
                        fontSize={fontSize}
                        fill={color}
                        fontFamily="monospace"
                        style={{ pointerEvents: 'none', userSelect: 'none' }}
                      >
                        {project.slug.length > 14 && w < 120
                          ? project.slug.slice(0, 12) + '…'
                          : project.slug}
                      </text>
                      {showSub && ctx && (
                        <text
                          x={x + PAD + 6}
                          y={y + PAD + fontSize * 2 + 7}
                          fontSize={Math.max(7, fontSize - 2)}
                          fill="#94A3B8"
                          fontFamily="monospace"
                          style={{ pointerEvents: 'none', userSelect: 'none' }}
                        >
                          ctx {ctx}{conv ? ` • conv ${conv}` : ''}
                        </text>
                      )}
                    </>
                  )}
                  {hasMem && showLabels && (
                    <circle
                      cx={x + w - PAD - 8}
                      cy={y + PAD + 8}
                      r={4}
                      fill={color}
                      opacity={0.7}
                      style={{ pointerEvents: 'none' }}
                    />
                  )}
                </g>
              )
            })}
          </svg>

          {tooltip && (
            <div
              className="absolute z-10 pointer-events-none rounded border text-xs font-mono px-3 py-2 shadow-xl"
              style={{
                left: Math.min(tooltip.mx + 12, W - 200),
                top: Math.max(0, tooltip.my - 8),
                background: '#0f1e35',
                borderColor: STATE_COLOR[tooltip.project.state] ?? '#334155',
                color: '#E2E8F0',
                minWidth: 180,
              }}
            >
              <div style={{ color: STATE_COLOR[tooltip.project.state], fontWeight: 700, marginBottom: 4 }}>
                {tooltip.project.slug}
              </div>
              <div>State: {tooltip.project.state}</div>
              <div>Age: {fmtAge(tooltip.project.ageMins)}</div>
              {tooltip.project.contextUsagePct != null && (
                <div>Context: {Math.round(tooltip.project.contextUsagePct)}%</div>
              )}
              {tooltip.project.convergenceScore != null && (
                <div>Convergence: {Math.round(tooltip.project.convergenceScore * 100)}%</div>
              )}
              {tooltip.project.budgetStatus && (
                <div>Budget: {tooltip.project.budgetStatus}</div>
              )}
              {tooltip.project.circuitOpen && (
                <div style={{ color: '#EF4444' }}>⚠ Circuit open</div>
              )}
              {(tooltip.project.memoryStatus?.sizeBytes ?? 0) > 0 && (
                <div>Memory: {(tooltip.project.memoryStatus!.sizeBytes / 1024).toFixed(1)} KB</div>
              )}
              <div className="mt-1" style={{ color: '#64748B' }}>Click to open feed →</div>
            </div>
          )}
        </div>
      )}

      <div className="mt-6 text-xs text-slate-600 font-mono">
        {data?.projects.length ?? 0} projects · tiles sized by context fill %
      </div>
    </div>
  )
}
