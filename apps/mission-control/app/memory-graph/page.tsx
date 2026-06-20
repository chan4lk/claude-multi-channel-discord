'use client'

import dynamic from 'next/dynamic'
import Link from 'next/link'

const MemoryGraph = dynamic(() => import('../../components/MemoryGraph'), { ssr: false })

export default function MemoryGraphPage() {
  return (
    <div className="min-h-dvh flex flex-col" style={{ background: '#060d1a' }}>
      <header className="relative border-b border-cyber-cyan/12 bg-cyber-surface/70 backdrop-blur-md px-6 py-3">
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-cyber-cyan/40 to-transparent" />
        <div className="flex items-center gap-4">
          <Link
            href="/"
            className="text-[0.6rem] font-mono text-slate-500 hover:text-cyber-cyan transition-colors uppercase tracking-wider"
          >
            ← Dashboard
          </Link>
          <h1
            className="text-lg font-black tracking-[0.18em] text-cyber-cyan"
            style={{ fontFamily: 'Orbitron, JetBrains Mono, monospace' }}
          >
            MEMORY CONSTELLATION
          </h1>
        </div>
      </header>

      <main className="flex-1 relative overflow-hidden">
        <MemoryGraph />
      </main>

      <footer className="border-t border-cyber-cyan/8 px-6 py-2">
        <p className="text-[0.55rem] font-mono text-slate-600">
          Drag nodes · Click node to inspect · Filter chips hide/show by type · Edges connect same-channel memories · Updates every 60s
        </p>
      </footer>
    </div>
  )
}
