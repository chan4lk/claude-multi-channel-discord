import React from 'react'

type Status = 'active' | 'stale' | 'stuck'

interface PulseRingProps {
  status: Status
  children: React.ReactNode
  className?: string
}

const RING: Record<Status, string> = {
  active: 'border-2 border-cyber-cyan shadow-glow-cyan animate-pulse-ring',
  stale:  'border-2 border-slate-600 opacity-40',
  stuck:  'border-2 border-cyber-crimson shadow-glow-red animate-strobe',
}

export default function PulseRing({ status, children, className = '' }: PulseRingProps) {
  return (
    <div className={`rounded-xl ${RING[status]} ${className}`}>
      {children}
    </div>
  )
}
