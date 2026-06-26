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
            MEMORY CONSTELLATION BROWSER
          </h1>
          <span className="text-[0.6rem] font-mono text-slate-500 border border-slate-700 px-2 py-0.5 rounded">fly through the fleet&apos;s memory graph</span>
        </div>
      </header>

      <main className="flex-1 relative overflow-hidden">
        <MemoryConstellation />
      </main>

      <footer className="border-t border-cyber-cyan/8 px-6 py-2">
        <p className="text-[0.55rem] font-mono text-slate-600">
          3D force-directed graph of every memory file across all projects · node color = project hue · size ∝ word count ·
          edges = <code>[[name]]</code> cross-references · click node to browse file content · filter by project ·
          drag to orbit · scroll to zoom · <code>/api/memory-constellation</code> · refreshes every 30s
        </p>
      </footer>
    </div>
  )
}
