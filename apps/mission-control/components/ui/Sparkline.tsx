interface SparklineProps {
  data: number[]
  width?: number
  height?: number
  color?: string
}

export default function Sparkline({
  data,
  width = 80,
  height = 24,
  color = '#00F5FF',
}: SparklineProps) {
  if (data.length === 0) {
    return <svg width={width} height={height} />
  }

  if (data.length === 1) {
    const y = height / 2
    return (
      <svg width={width} height={height}>
        <circle cx={width / 2} cy={y} r={2} fill={color} />
      </svg>
    )
  }

  const max = Math.max(...data, 1)
  const step = width / (data.length - 1)
  const points = data
    .map((v, i) => `${i * step},${height - (v / max) * (height - 2) - 1}`)
    .join(' ')

  return (
    <svg width={width} height={height}>
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={0.8}
      />
    </svg>
  )
}
