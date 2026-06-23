'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import * as d3 from 'd3'
import SubPageHeader from '../../components/SubPageHeader'
import type { GoalHeatmapResponse, HeatmapCell } from '../api/goal-heatmap/route'

const CELL_W = 22
const CELL_H = 26
const LABEL_W = 90
const DATE_H = 32
const PULSE_H = 48
const GAP = 2

function dayLabel(date: string): string {
  const d = new Date(date + 'T12:00:00Z')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function rateColor(rate: number): string {
  if (rate === 0) return '#0d1f3c'
  const t = Math.pow(rate, 0.6)
  return d3.interpolateRgb('#0d3a5c', '#00F5FF')(t)
}

interface DrawerProps {
  cell: HeatmapCell | null
  onClose: () => void
}

function TurnDrawer({ cell, onClose }: DrawerProps) {
  if (!cell) return null
  return (
    <div
      style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, width: 380,
        background: '#0B1628', borderLeft: '1px solid #1E3A5F',
        zIndex: 50, padding: '20px', overflowY: 'auto',
        transform: 'translateX(0)', transition: 'transform 0.2s ease',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <div style={{ color: '#00F5FF', fontWeight: 700, fontSize: 14 }}>{cell.slug}</div>
          <div style={{ color: '#64748B', fontSize: 12 }}>{cell.date}</div>
        </div>
        <button
          onClick={onClose}
          style={{ background: 'none', border: 'none', color: '#64748B', fontSize: 20, cursor: 'pointer' }}
        >×</button>
      </div>
      <div style={{ color: '#94A3B8', fontSize: 12, marginBottom: 12 }}>
        Goal-keyword hit rate: <span style={{ color: '#00F5FF', fontWeight: 700 }}>{(cell.rate * 100).toFixed(0)}%</span>
      </div>
      {cell.matchingTurns.length === 0 ? (
        <div style={{ color: '#475569', fontSize: 12, fontStyle: 'italic' }}>No matching turns this day.</div>
      ) : (
        cell.matchingTurns.map((excerpt, i) => (
          <div key={i} style={{
            background: '#0F2240', border: '1px solid #1E3A5F', borderRadius: 6,
            padding: '10px 12px', marginBottom: 10, fontSize: 12, color: '#CBD5E1', lineHeight: 1.5,
          }}>
            <div style={{ color: '#475569', fontSize: 10, marginBottom: 4 }}>Turn {i + 1}</div>
            {excerpt}{excerpt.length >= 200 ? '…' : ''}
          </div>
        ))
      )}
    </div>
  )
}

interface PulseLineProps {
  dates: string[]
  fleetAvgByDate: Record<string, number>
  width: number
}

function PulseLine({ dates, fleetAvgByDate, width }: PulseLineProps) {
  const svgRef = useRef<SVGSVGElement>(null)

  useEffect(() => {
    const svg = d3.select(svgRef.current!)
    svg.selectAll('*').remove()

    const vals = dates.map((d) => fleetAvgByDate[d] ?? 0)
    const xScale = d3.scaleLinear().domain([0, dates.length - 1]).range([0, width])
    const yScale = d3.scaleLinear().domain([0, 1]).range([PULSE_H - 8, 8])

    const line = d3.line<number>()
      .x((_, i) => xScale(i))
      .y((v) => yScale(v))
      .curve(d3.curveCatmullRom)

    svg.append('path')
      .datum(vals)
      .attr('fill', 'none')
      .attr('stroke', '#00F5FF')
      .attr('stroke-width', 2)
      .attr('d', line)

    // glow
    svg.append('path')
      .datum(vals)
      .attr('fill', 'none')
      .attr('stroke', '#00F5FF')
      .attr('stroke-width', 6)
      .attr('opacity', 0.15)
      .attr('d', line)
  }, [dates, fleetAvgByDate, width])

  return <svg ref={svgRef} width={width} height={PULSE_H} style={{ display: 'block' }} />
}

export default function GoalHeatmapPage() {
  const [data, setData] = useState<GoalHeatmapResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeCell, setActiveCell] = useState<HeatmapCell | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [containerW, setContainerW] = useState(800)

  useEffect(() => {
    fetch('/api/goal-heatmap')
      .then((r) => r.json())
      .then((d: GoalHeatmapResponse) => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!containerRef.current) return
    const ro = new ResizeObserver((entries) => {
      setContainerW(entries[0].contentRect.width)
    })
    ro.observe(containerRef.current)
    return () => ro.disconnect()
  }, [])

  const handleCellClick = useCallback((cell: HeatmapCell) => {
    setActiveCell((prev) => prev?.slug === cell.slug && prev?.date === cell.date ? null : cell)
  }, [])

  if (loading) {
    return (
      <div style={{ background: '#080F1E', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: '#00F5FF', fontFamily: 'monospace' }}>Loading goal heatmap…</div>
      </div>
    )
  }

  if (!data || data.slugs.length === 0) {
    return (
      <div style={{ background: '#080F1E', minHeight: '100vh', color: '#94A3B8', fontFamily: 'monospace', padding: 40 }}>
        <SubPageHeader title="Goal Heatmap" />
        <p style={{ color: '#475569', fontSize: 14 }}>Projects with <code>.goal</code> files appear here.</p>
      </div>
    )
  }

  const { slugs, dates, cells, fleetAvgByDate } = data

  // Build lookup: slug+date → cell
  const cellMap: Record<string, HeatmapCell> = {}
  for (const c of cells) { cellMap[`${c.slug}:${c.date}`] = c }

  const gridW = dates.length * (CELL_W + GAP) - GAP
  const pulseW = gridW

  // Show every 7th date label
  const dateLabels: Array<{ idx: number; label: string }> = dates
    .map((d, i) => ({ idx: i, label: dayLabel(d) }))
    .filter((_, i) => i % 7 === 0 || i === dates.length - 1)

  return (
    <div ref={containerRef} style={{ background: '#080F1E', minHeight: '100vh', fontFamily: 'monospace', padding: '24px 32px' }}>
      <SubPageHeader title="Goal Heatmap" />

      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 24, overflowX: 'auto', paddingBottom: 16 }}>
        {/* Label column */}
        <div style={{ flexShrink: 0, width: LABEL_W }}>
          {/* Spacer for date row */}
          <div style={{ height: DATE_H }} />
          {/* Spacer for pulse row */}
          <div style={{
            height: PULSE_H + 16, display: 'flex', alignItems: 'center',
            color: '#64748B', fontSize: 10, lineHeight: 1.2,
          }}>
            Fleet avg
          </div>
          {slugs.map((slug) => (
            <div key={slug} style={{
              height: CELL_H + GAP, display: 'flex', alignItems: 'center',
              color: '#94A3B8', fontSize: 11, overflow: 'hidden', whiteSpace: 'nowrap',
              textOverflow: 'ellipsis',
            }}>
              {slug}
            </div>
          ))}
        </div>

        {/* Grid column */}
        <div style={{ flexShrink: 0 }}>
          {/* Date labels */}
          <div style={{ position: 'relative', height: DATE_H, width: gridW }}>
            {dateLabels.map(({ idx, label }) => (
              <div key={idx} style={{
                position: 'absolute',
                left: idx * (CELL_W + GAP),
                top: 0,
                color: '#475569', fontSize: 10, whiteSpace: 'nowrap',
                transform: 'rotate(-40deg)', transformOrigin: 'left bottom',
                bottom: 0,
              }}>{label}</div>
            ))}
          </div>

          {/* Fleet pulse line */}
          <div style={{ marginBottom: 16 }}>
            <PulseLine dates={dates} fleetAvgByDate={fleetAvgByDate} width={pulseW} />
          </div>

          {/* Heatmap rows */}
          {slugs.map((slug) => (
            <div key={slug} style={{ display: 'flex', gap: GAP, marginBottom: GAP }}>
              {dates.map((date, di) => {
                const cell = cellMap[`${slug}:${date}`]
                const rate = cell?.rate ?? 0
                const isActive = activeCell?.slug === slug && activeCell?.date === date
                return (
                  <div
                    key={di}
                    onClick={() => cell && handleCellClick(cell)}
                    title={`${slug} ${date}: ${(rate * 100).toFixed(0)}% hit rate`}
                    style={{
                      width: CELL_W, height: CELL_H,
                      background: rateColor(rate),
                      borderRadius: 3,
                      cursor: cell ? 'pointer' : 'default',
                      border: isActive ? '2px solid #00F5FF' : '2px solid transparent',
                      transition: 'border-color 0.1s',
                      flexShrink: 0,
                    }}
                  />
                )
              })}
            </div>
          ))}

          {/* Legend */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 16 }}>
            <span style={{ color: '#475569', fontSize: 11 }}>0%</span>
            {[0, 0.2, 0.4, 0.6, 0.8, 1].map((v) => (
              <div key={v} style={{ width: CELL_W, height: 10, background: rateColor(v), borderRadius: 2 }} />
            ))}
            <span style={{ color: '#00F5FF', fontSize: 11 }}>100%</span>
            <span style={{ color: '#475569', fontSize: 11, marginLeft: 16 }}>
              Click cell to see matching turns
            </span>
          </div>
        </div>
      </div>

      {/* Note about container width for responsiveness */}
      <div style={{ color: '#1E3A5F', fontSize: 10, marginTop: 8 }}>
        {containerW > 0 && `viewport: ${containerW}px`}
      </div>

      <TurnDrawer cell={activeCell} onClose={() => setActiveCell(null)} />
    </div>
  )
}
