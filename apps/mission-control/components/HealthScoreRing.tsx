'use client'

import { useEffect, useRef, useState } from 'react'

interface Props {
  score: number
  insufficientData?: boolean
  recency?: number
  stallRate?: number
  efficiency?: number
  freshness?: number
  size?: number
}

interface BreakdownRow {
  label: string
  raw: number
  contribution: number
  weight: number
}

function computeBreakdown(
  score: number,
  recency: number | undefined,
  stallRate: number | undefined,
  efficiency: number | undefined,
  freshness: number | undefined,
): BreakdownRow[] {
  const rows: BreakdownRow[] = []
  if (recency !== undefined)   rows.push({ label: 'Recency',     raw: recency,    contribution: Math.round(recency * 0.4),    weight: 40 })
  if (stallRate !== undefined) rows.push({ label: 'Stall rate',  raw: stallRate,  contribution: Math.round(stallRate * 0.3),  weight: 30 })
  if (efficiency !== undefined) rows.push({ label: 'Efficiency', raw: efficiency, contribution: Math.round(efficiency * 0.2), weight: 20 })
  if (freshness !== undefined) rows.push({ label: 'Freshness',   raw: freshness,  contribution: Math.round(freshness * 0.1),  weight: 10 })
  return rows
}

export default function HealthScoreRing({
  score,
  insufficientData = false,
  recency,
  stallRate,
  efficiency,
  freshness,
  size = 42,
}: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false) }
    function onClick(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onClick)
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onClick) }
  }, [open])

  const cx = size / 2
  const cy = size / 2
  const r = size / 2 - 4
  const circumference = 2 * Math.PI * r
  const trackLen = circumference * 0.75

  const trackDasharray = `${trackLen} ${circumference - trackLen}`

  let fillColor: string
  let displayScore: string

  if (insufficientData || score < 0) {
    fillColor = '#4b5563'
    displayScore = '?'
  } else if (score >= 70) {
    fillColor = '#4ADE80'
    displayScore = String(score)
  } else if (score >= 40) {
    fillColor = '#F59E0B'
    displayScore = String(score)
  } else {
    fillColor = '#EF4444'
    displayScore = String(score)
  }

  const pct = insufficientData || score < 0 ? 0 : score / 100
  const fillDasharray = `${pct * trackLen} ${circumference}`

  const glowId = `health-glow-${fillColor.replace('#', '')}-${size}`

  const breakdown = computeBreakdown(score, recency, stallRate, efficiency, freshness)

  return (
    <div ref={ref} style={{ position: 'relative', flexShrink: 0, display: 'inline-block' }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        aria-label={`Health: ${insufficientData ? 'insufficient data' : `${score}/100`}`}
        style={{ cursor: 'pointer', flexShrink: 0 }}
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v) }}
      >
        <defs>
          <filter id={glowId} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="1.5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Track */}
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke="#1e2a3a"
          strokeWidth={3}
          strokeDasharray={trackDasharray}
          strokeLinecap="round"
          transform={`rotate(-135 ${cx} ${cy})`}
        />

        {/* Fill */}
        {pct > 0 && (
          <circle
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke={fillColor}
            strokeWidth={3}
            strokeDasharray={fillDasharray}
            strokeLinecap="round"
            transform={`rotate(-135 ${cx} ${cy})`}
            filter={`url(#${glowId})`}
          />
        )}

        {/* Center label */}
        <text
          x={cx}
          y={cy + 1}
          textAnchor="middle"
          dominantBaseline="middle"
          fill={insufficientData || score < 0 ? '#4b5563' : fillColor}
          fontSize={score < 0 || insufficientData ? size * 0.3 : size * 0.22}
          fontFamily="JetBrains Mono, monospace"
          fontWeight="bold"
        >
          {displayScore}
        </text>
      </svg>

      {open && (
        <div
          style={{
            position: 'absolute',
            bottom: size + 4,
            right: 0,
            zIndex: 999,
            minWidth: 188,
            background: '#0f172a',
            border: '1px solid #334155',
            borderRadius: 8,
            padding: '8px 10px',
            boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
          }}
        >
          <div style={{ fontSize: 10, fontFamily: 'JetBrains Mono, monospace', color: '#94a3b8', marginBottom: 6 }}>
            Health Score Breakdown
          </div>
          {insufficientData || score < 0 ? (
            <div style={{ fontSize: 11, color: '#4b5563', fontFamily: 'monospace' }}>Insufficient data (&lt; 2 sessions)</div>
          ) : (
            <>
              {breakdown.map((row) => (
                <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 3 }}>
                  <span style={{ fontSize: 11, color: '#94a3b8', fontFamily: 'monospace' }}>
                    {row.label}
                    <span style={{ fontSize: 9, color: '#475569', marginLeft: 3 }}>×{row.weight}%</span>
                  </span>
                  <span style={{
                    fontSize: 11,
                    fontFamily: 'monospace',
                    fontWeight: 'bold',
                    color: row.contribution >= row.weight * 0.7 ? '#4ADE80' : row.contribution >= row.weight * 0.4 ? '#F59E0B' : '#EF4444',
                  }}>
                    +{row.contribution}
                  </span>
                </div>
              ))}
              <div style={{ borderTop: '1px solid #1e293b', marginTop: 5, paddingTop: 5, display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 11, color: '#cbd5e1', fontFamily: 'monospace', fontWeight: 'bold' }}>Total</span>
                <span style={{ fontSize: 11, fontFamily: 'monospace', fontWeight: 'bold', color: fillColor }}>{score}/100</span>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
