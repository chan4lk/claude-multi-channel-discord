'use client'

import dynamic from 'next/dynamic'
import Link from 'next/link'

const ConstellationGraph = dynamic(
  () => import('../../components/ConstellationGraph'),
  { ssr: false }
)

export default function ConstellationPage() {
  return (
    <div className="min-h-dvh flex flex-col" style={{ background: '#020811' }}>
      <header
        className="relative border-b border-cyber-cyan/12 bg-cyber-surface/70 backdrop-blur-md px-6 py-3 z-10"
      >
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
            style={{ fontFamily: 'Orbitron, JetBrains Mono, monospace', textShadow: '0 0 20px #00F5FF60' }}
          >
            FLEET CONSTELLATION
          </h1>
          <div className="flex-1" />
          <Link
            href="/graph3d"
            className="text-[0.6rem] font-mono px-2.5 py-1 rounded border border-cyber-cyan/20 text-slate-400 hover:text-cyber-cyan hover:border-cyber-cyan/40 transition-colors"
          >
            ⬡ Force Graph
          </Link>
          <Link
            href="/galaxy"
            className="text-[0.6rem] font-mono px-2.5 py-1 rounded border border-cyber-cyan/20 text-slate-400 hover:text-cyber-cyan hover:border-cyber-cyan/40 transition-colors"
          >
            ✦ Galaxy Map
          </Link>
        </div>
      </header>

      <main className="flex-1 relative overflow-hidden">
        <ConstellationGraph />
      </main>

      <footer className="border-t border-cyber-cyan/8 px-6 py-2 z-10">
        <p className="text-[0.55rem] font-mono text-slate-600">
          Drag to orbit · Scroll to zoom · Double-click to reset · Click star to inspect · Positions from memory keyword PCA · Edges = Jaccard ≥ 0.1 · Color = convergence · Size = context pressure
        </p>
      </footer>
    </div>
  )
}
