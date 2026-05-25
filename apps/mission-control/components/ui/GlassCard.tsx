interface GlassCardProps {
  children: React.ReactNode
  className?: string
}

export default function GlassCard({ children, className = '' }: GlassCardProps) {
  return (
    <div
      className={`backdrop-blur-sm bg-cyber-surface/80 border border-cyber-cyan/10 rounded-xl shadow-inner ${className}`}
    >
      {children}
    </div>
  )
}
