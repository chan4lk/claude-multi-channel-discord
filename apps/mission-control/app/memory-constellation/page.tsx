'use client'

import dynamic from 'next/dynamic'
import Link from 'next/link'

const MemoryConstellation = dynamic(() => import('../../components/MemoryConstellation'), { ssr: false })

export default function MemoryConstellationPage() {
  return (
    <div className="min-h-dvh flex flex-col" style={{ background: '#060d1a' }}>
      <header className="relative border-b border-cyber-cyan/12 bg-cyber-surface/70 backdrop-blur-md px-6 py-3">
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-cyber-cyan/40 to-transparent" />
        <div className="flex items-center gap-4 flex-wrap">
          <Link href="/" className="text-[0.6rem] font-mono text-slate-500 hover:text-cyber-cyan transition-colors uppercase tracking-wider">← Dashboard</Link>
          <h1 className="text-lg font-black tracking-[0.18em] text-cyber-cyan" style={{ fontFamily: 'Orbitron, JetBrains Mono, monospace', textShadow: '0 0 20px #00F5FF60' }}>
            MEMORY THEME CONSTELLATION
          </h1>
          <span className="text-[0.6rem] font-mono text-slate-500 border border-slate-700 px-2 py-0.5 rounded">what does the fleet know about?</span>
        </div>
      </header>

      <main className="flex-1 relative overflow-hidden">
        <MemoryConstellation />
      </main>

      <footer className="border-t border-cyber-cyan/8 px-6 py-2">
        <p className="text-[0.55rem] font-mono text-slate-600">
          Force-directed graph of frequent keywords across every project&apos;s <code>MEMORY.md</code>. Node size ∝ total mentions ·
          color encodes how many distinct projects reference it (isolated → shared) · edges connect keywords that co-occur within the same project ·
          hover a node to list referencing projects · <code>/api/memory-constellation</code> · refreshes every 60s
        </p>
      </footer>
    </div>
  )
}
