'use client'

import Link from 'next/link'
import NavDropdown from './NavDropdown'

export default function SubPageHeader({
  title,
  children,
}: {
  title: string
  children?: React.ReactNode
}) {
  return (
    <header className="relative z-50 border-b border-cyber-cyan/12 bg-cyber-surface/70 backdrop-blur-md px-4 sm:px-6 py-3">
      <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-cyber-cyan/40 to-transparent" />
      <div className="flex items-center gap-2 sm:gap-3 min-w-0">
        <Link
          href="/"
          className="text-[0.6rem] font-mono text-slate-500 hover:text-cyber-cyan transition-colors uppercase tracking-wider shrink-0"
          aria-label="Back to dashboard"
        >
          ←
        </Link>
        <NavDropdown />
        <h1
          className="text-sm sm:text-lg font-black tracking-[0.12em] sm:tracking-[0.18em] text-cyber-cyan min-w-0 truncate"
          style={{ fontFamily: 'Orbitron, JetBrains Mono, monospace' }}
        >
          {title}
        </h1>
        {children && (
          <>
            <div className="flex-1" />
            <div className="flex items-center gap-1.5 sm:gap-3 shrink-0 flex-wrap justify-end">
              {children}
            </div>
          </>
        )}
      </div>
    </header>
  )
}
