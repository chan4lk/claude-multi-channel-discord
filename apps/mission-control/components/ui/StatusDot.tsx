type Status = 'active' | 'stale' | 'stuck'

interface StatusDotProps {
  status: Status
  size?: number
}

const COLOR: Record<Status, string> = {
  active: 'bg-cyber-cyan',
  stale:  'bg-slate-500',
  stuck:  'bg-cyber-crimson',
}

export default function StatusDot({ status, size = 8 }: StatusDotProps) {
  return (
    <span
      className={`inline-block rounded-full ${COLOR[status]}`}
      style={{ width: size, height: size }}
    />
  )
}
