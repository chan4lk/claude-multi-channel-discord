'use client'

import { useState } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import type { BranchType } from '../api/mindmap/route'

const MindMap = dynamic(() => import('../../components/MindMap'), { ssr: false })

const BRANCH_META: { key: BranchType; label: string; color: string }[] = [
  { key: 'goal', label: 'GOAL', color: '#22D3EE' },
  { key: 'memory', label: 'MEMORY', color: '#A855F7' },
  { key: 'proposal', label: 'PROPOSALS', color: '#F59E0B' },
]

export default function MindMapPage() {
  const [activeBranches, setActiveBranches] = useState<BranchType[]>(['goal', 'memory', 'proposal'])

  function toggle(b: BranchType) {
    setActiveBranches((prev) =>
      prev.includes(b) ? prev.filter((x) => x !== b) : [...prev, b]
    )
  }

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
            FLEET MIND MAP
          </h1>

          <div className="flex-1" />

          {/* Branch toggles */}
          <div className="flex gap-1.5">
            {BRANCH_META.map((b) => {
              const active = activeBranches.includes(b.key)
              return (
                <button
                  key={b.key}
                  onClick={() => toggle(b.key)}
                  className="px-3 py-1 rounded text-[0.65rem] font-mono font-bold tracking-widest border transition-all"
                  style={{
                    borderColor: active ? b.color : '#1e293b',
                    color: active ? b.color : '#475569',
                    background: active ? b.color + '18' : 'transparent',
                  }}
                >
                  {b.label}
                </button>
              )
            })}
          </div>

          {/* Legend */}
          <div className="hidden md:flex items-center gap-3 ml-4 text-[0.6rem] font-mono text-slate-500">
            <span style={{ color: '#38BDF8' }}>● Project</span>
            {BRANCH_META.map((b) => (
              <span key={b.key} style={{ color: b.color }}>● {b.label.charAt(0) + b.label.slice(1).toLowerCase()}</span>
            ))}
          </div>

          <Link
            href="/graph"
            className="text-[0.6rem] font-mono text-slate-500 hover:text-cyber-cyan transition-colors uppercase tracking-wider ml-4"
          >
            Graph ›
          </Link>
          <Link
            href="/collaboration"
            className="text-[0.6rem] font-mono text-slate-500 hover:text-cyber-cyan transition-colors uppercase tracking-wider"
          >
            Collab ›
          </Link>
        </div>
      </header>

      <main className="flex-1 relative overflow-hidden">
        <MindMap activeBranches={activeBranches} />
      </main>

      <footer className="border-t border-cyber-cyan/10 px-6 py-2 text-[0.6rem] font-mono text-slate-600">
        FLEET MIND MAP · Center = Fleet · Ring 1 = Projects · Ring 2 = Branches · Drag to explore · Click node to navigate
      </footer>
    </div>
  )
}
