'use client'

interface Props {
  score: number
  insufficientData?: boolean
  recency?: number
  stallRate?: number
  efficiency?: number
  freshness?: number
  size?: number
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
  const cx = size / 2
  const cy = size / 2
  const r = size / 2 - 4
  const circumference = 2 * Math.PI * r
  const trackLen = circumference * 0.75 // 270° arc

  const trackDasharray = `${trackLen} ${circumference - trackLen}`

  let fillColor: string
  let displayScore: string

  if (insufficientData || score < 0) {
    fillColor = '#4b5563'
    displayScore = '?'
  } else if (score >= 80) {
    fillColor = '#4ADE80'
    displayScore = String(score)
  } else if (score >= 50) {
    fillColor = '#F59E0B'
    displayScore = String(score)
  } else {
    fillColor = '#EF4444'
    displayScore = String(score)
  }

  const pct = insufficientData || score < 0 ? 0 : score / 100
  const fillDasharray = `${pct * trackLen} ${circumference}`

  const glowId = `health-glow-${fillColor.replace('#', '')}`

  const tooltipLines: string[] = []
  if (insufficientData) {
    tooltipLines.push('Insufficient data (< 2 sessions)')
  } else {
    tooltipLines.push(`Health: ${score}/100`)
    if (recency !== undefined) tooltipLines.push(`Recency: ${recency}`)
    if (stallRate !== undefined) tooltipLines.push(`Stall rate: ${stallRate}`)
    if (efficiency !== undefined) tooltipLines.push(`Efficiency: ${efficiency}`)
    if (freshness !== undefined) tooltipLines.push(`Memory freshness: ${freshness}`)
  }
  const tooltip = tooltipLines.join(' | ')

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      aria-label={tooltip}
      style={{ flexShrink: 0 }}
    >
      <title>{tooltip}</title>
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
  )
}
