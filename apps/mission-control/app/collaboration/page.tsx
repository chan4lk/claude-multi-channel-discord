'use client'

import { useState } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import type { ConnectionType } from '../api/collaboration-graph/route'

const CollaborationGraph = dynamic(() => import('../../components/CollaborationGraph'), { ssr: false })

const TYPE_META: { key: ConnectionType; label: string; color: string; symbol: string }[] = [
  { key: 'memory', label: 'Memory', color: '#A855F7', symbol: '◆' },
  { key: 'goal',   label: 'Goal',   color: '#22D3EE', symbol: '⬡' },
  { key: 'proposal', label: 'Proposal', color: '#F59E0B', symbol: '◈' },
]

export default function CollaborationPage() {
  const [minScore, setMinScore] = useState(0.05)
  const [activeTypes, setActiveTypes] = useState<ConnectionType[]>(['memory', 'goal', 'proposal'])

  function toggleType(t: ConnectionType) {
    setActiveTypes((prev) =>
      prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]
    )
  }

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
            COLLABORATION NETWORK
          </h1>

          <div className="flex-1" />

          {/* Connection type toggles */}
          <div className="flex gap-1.5">
            {TYPE_META.map((t) => {
              const active = activeTypes.includes(t.key)
              return (
                <button
                  key={t.key}
                  onClick={() => toggleType(t.key)}
                  className="text-[0.6rem] px-2.5 py-1 rounded font-mono font-bold uppercase tracking-wider transition-all"
                  style={{
                    color: active ? t.color : '#475569',
                    border: `1px solid ${active ? t.color + '60' : '#334155'}`,
                    background: active ? t.color + '12' : 'transparent',
                  }}
                >
                  {t.symbol} {t.label}
                </button>
              )
            })}
          </div>

          {/* Min-score slider */}
          <div className="flex items-center gap-2 ml-2">
            <span className="text-[0.55rem] font-mono text-slate-500 uppercase tracking-wider">Min match</span>
            <input
              type="range"
              min={0}
              max={0.5}
              step={0.01}
              value={minScore}
              onChange={(e) => setMinScore(parseFloat(e.target.value))}
              className="w-20 accent-cyber-cyan"
            />
            <span className="text-[0.55rem] font-mono text-cyber-cyan w-8 text-right">
              {(minScore * 100).toFixed(0)}%
            </span>
          </div>

          <Link
            href="/graph"
            className="text-[0.6rem] px-2.5 py-1 rounded font-mono font-bold uppercase tracking-wider border border-cyber-cyan/20 text-slate-400 hover:text-cyber-cyan hover:border-cyber-cyan/40 transition-colors"
          >
            ● Graph
          </Link>
        </div>
      </header>

      {/* Graph fills remaining space */}
      <main className="flex-1 relative overflow-hidden">
        <CollaborationGraph minScore={minScore} activeTypes={activeTypes} />
      </main>

      {/* Legend */}
      <footer className="border-t border-cyber-cyan/8 px-6 py-2">
        <div className="flex items-center gap-6">
          {TYPE_META.map((t) => (
            <span key={t.key} className="flex items-center gap-1.5">
              <span className="inline-block w-6 h-0.5 rounded" style={{ background: t.color }} />
              <span className="text-[0.55rem] font-mono" style={{ color: t.color }}>{t.label} overlap</span>
            </span>
          ))}
          <span className="text-[0.55rem] font-mono text-slate-600 ml-auto">
            Node size = turn count · Edge thickness = match strength · Click edge to inspect · Drag to reposition
          </span>
        </div>
      </footer>
    </div>
  )
}
