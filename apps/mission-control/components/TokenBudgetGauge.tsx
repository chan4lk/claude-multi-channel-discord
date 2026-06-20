'use client'

interface Props {
  used: number
  budget: number
  size?: number
}

export default function TokenBudgetGauge({ used, budget, size = 36 }: Props) {
  const pct = budget > 0 ? Math.min(used / budget, 1) : 0
  const pctDisplay = Math.round(pct * 100)
  const remaining = Math.max(0, budget - used)
  const remainingPct = budget > 0 ? Math.round((remaining / budget) * 100) : 0

  let fillColor: string
  if (pct < 0.7) fillColor = '#4ADE80'
  else if (pct < 0.9) fillColor = '#F59E0B'
  else fillColor = '#EF4444'

  const cx = size / 2
  const cy = size / 2
  const r = size / 2 - 4
  const circumference = 2 * Math.PI * r
  const trackLen = circumference * 0.75 // 270° arc

  // Track dasharray: show 270° of the circle
  const trackDasharray = `${trackLen} ${circumference - trackLen}`
  // Fill dasharray: show proportion of the 270° arc
  const fillDasharray = `${pct * trackLen} ${circumference}`

  const glowId = `glow-${fillColor.replace('#', '')}`

  const tooltip = `${used.toLocaleString()} tokens used / ${budget.toLocaleString()} budget (${remainingPct}% remaining)`

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

      {/* Track (dim gray 270° arc) */}
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

      {/* Fill arc */}
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

      {/* Center percentage text */}
      <text
        x={cx}
        y={cy + 1}
        textAnchor="middle"
        dominantBaseline="middle"
        fill={pct > 0 ? fillColor : '#4b5563'}
        fontSize={size * 0.22}
        fontFamily="JetBrains Mono, monospace"
        fontWeight="bold"
      >
        {pctDisplay}%
      </text>
    </svg>
  )
}
