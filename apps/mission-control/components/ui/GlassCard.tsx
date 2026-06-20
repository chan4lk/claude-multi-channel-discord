interface GlassCardProps {
  children: React.ReactNode
  className?: string
  glow?: boolean
  style?: React.CSSProperties
}

export default function GlassCard({ children, className = '', glow = false, style }: GlassCardProps) {
  return (
    <div
      style={style}
      className={`
        relative overflow-hidden rounded-lg
        bg-gradient-to-br from-cyber-surface/95 to-[#0a1020]/90
        backdrop-blur-md
        border border-cyber-cyan/20 border-t-cyber-cyan/35
        shadow-[0_4px_24px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(0,245,255,0.07)]
        ${glow ? 'shadow-glow-cyan' : ''}
        ${className}
      `}
    >
      {/* Top-edge highlight */}
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-cyber-cyan/50 to-transparent pointer-events-none" />
      {children}
    </div>
  )
}
