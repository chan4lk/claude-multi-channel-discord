'use client'

import { useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'

// Load D3 graph client-only (no SSR)
const ProjectGraph = dynamic(() => import('../../components/ProjectGraph'), { ssr: false })

export default function GraphPage() {
  const [showBacklog, setShowBacklog] = useState(false)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.target as HTMLElement).tagName === 'INPUT') return
      if (e.key === 'b' || e.key === 'B') setShowBacklog((v) => !v)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="min-h-dvh flex flex-col" style={{ background: '#060d1a' }}>
      {/* Header */}
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
            PROJECT GRAPH
          </h1>
          <div className="flex-1" />
          <Link
            href="/graph3d"
            className="text-[0.6rem] px-2.5 py-1 rounded font-mono font-bold uppercase tracking-wider border border-cyber-cyan/20 text-slate-400 hover:text-cyber-cyan hover:border-cyber-cyan/40 transition-colors"
          >
            ◈ 3D
          </Link>
          <Link
            href="/collaboration"
            className="text-[0.6rem] px-2.5 py-1 rounded font-mono font-bold uppercase tracking-wider border border-purple-500/20 text-slate-400 hover:text-purple-400 hover:border-purple-500/40 transition-colors"
          >
            ◆ Collab
          </Link>
          <Link
            href="/mindmap"
            className="text-[0.6rem] px-2.5 py-1 rounded font-mono font-bold uppercase tracking-wider border border-cyan-500/20 text-slate-400 hover:text-cyan-400 hover:border-cyan-500/40 transition-colors"
          >
            ✦ Mind Map
          </Link>
          <button
            onClick={() => setShowBacklog((b) => !b)}
            className="text-[0.6rem] px-2.5 py-1 rounded font-mono font-bold uppercase tracking-wider transition-all"
            style={{
              color: showBacklog ? '#A855F7' : '#475569',
              border: `1px solid ${showBacklog ? '#A855F760' : '#334155'}`,
              background: showBacklog ? '#A855F712' : 'transparent',
            }}
            title="Toggle backlog halo rings (B)"
          >
            ⬡ Backlog
          </button>
        </div>
      </header>

      {/* Graph fills remaining space */}
      <main className="flex-1 relative overflow-hidden">
        <ProjectGraph showBacklog={showBacklog} />
      </main>

      <footer className="border-t border-cyber-cyan/8 px-6 py-2">
        <p className="text-[0.55rem] font-mono text-slate-600">
          Drag nodes to reposition · Click node to inspect · Press B to toggle backlog halos · Updates every 30s
        </p>
      </footer>
    </div>
  )
}
