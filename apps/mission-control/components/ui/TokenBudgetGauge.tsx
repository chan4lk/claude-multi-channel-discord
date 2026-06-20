'use client'

interface Props {
  used: number
  budget: number
  size?: number
}

function describeArc(cx: number, cy: number, r: number, startDeg: number, endDeg: number): string {
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const x1 = cx + r * Math.cos(toRad(startDeg))
  const y1 = cy + r * Math.sin(toRad(startDeg))
  const x2 = cx + r * Math.cos(toRad(endDeg))
  const y2 = cy + r * Math.sin(toRad(endDeg))
  const large = endDeg - startDeg > 180 ? 1 : 0
  return `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`
}

export default function TokenBudgetGauge({ used, budget, size = 56 }: Props) {
  const pct = Math.min(used / budget, 1)
  const cx = size / 2
  const cy = size / 2
  const r = size / 2 - 5
  const START = 135
  const SWEEP = 270
  const endDeg = START + SWEEP * pct

  const color = pct >= 0.9 ? '#EF4444' : pct >= 0.7 ? '#F59E0B' : '#4ADE80'
  const pctStr = `${Math.round(pct * 100)}%`
  const remaining = Math.max(0, budget - used)

  const bgPath = describeArc(cx, cy, r, START, START + SWEEP - 0.01)
  const fgPath = pct > 0.001 ? describeArc(cx, cy, r, START, endDeg) : ''

  return (
    <div
      className="relative inline-flex items-center justify-center"
      style={{ width: size, height: size }}
      title={`${used.toLocaleString()} / ${budget.toLocaleString()} tokens (${pctStr} · ${remaining.toLocaleString()} remaining)`}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="absolute inset-0">
        <path d={bgPath} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={4} strokeLinecap="round" />
        {fgPath && (
          <path
            d={fgPath}
            fill="none"
            stroke={color}
            strokeWidth={4}
            strokeLinecap="round"
            style={{ filter: `drop-shadow(0 0 3px ${color}80)` }}
          />
        )}
      </svg>
      <span
        className="relative text-[9px] font-mono font-bold"
        style={{ color }}
      >
        {pctStr}
      </span>
    </div>
  )
}
