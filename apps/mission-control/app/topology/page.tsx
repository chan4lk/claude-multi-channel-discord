'use client'

import dynamic from 'next/dynamic'
import Link from 'next/link'

const TopologyGraph = dynamic(() => import('../../components/TopologyGraph'), { ssr: false })

export default function TopologyPage() {
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
            LIVE FLEET TOPOLOGY
          </h1>
          <div className="flex-1" />
          <div className="flex items-center gap-4 text-[0.55rem] font-mono text-slate-600">
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-3 rounded-full border-2" style={{ borderColor: '#22D3EE' }} />
              Active (&lt;30s reply)
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-3 rounded-full border-2" style={{ borderColor: '#F59E0B' }} />
              Idle
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-3 rounded-full border-2" style={{ borderColor: '#EF4444' }} />
              Stuck
            </span>
          </div>
          <Link
            href="/collaboration"
            className="text-[0.6rem] px-2.5 py-1 rounded font-mono font-bold uppercase tracking-wider border border-cyber-cyan/20 text-slate-400 hover:text-cyber-cyan hover:border-cyber-cyan/40 transition-colors"
          >
            ● Collaboration
          </Link>
        </div>
      </header>

      <main className="flex-1 relative overflow-hidden">
        <TopologyGraph />
      </main>

      <footer className="border-t border-cyber-cyan/8 px-6 py-2">
        <div className="flex items-center gap-6 text-[0.5rem] font-mono text-slate-700">
          <span>Node size = turns/hour</span>
          <span>Particle flow = cross-project references</span>
          <span>Edges = slug mentions in last 15 min</span>
          <span className="ml-auto">Updates every 5s · Drag nodes to reposition · Scroll to zoom</span>
        </div>
      </footer>
    </div>
  )
}
