'use client'

import dynamic from 'next/dynamic'
import Link from 'next/link'
import SubPageHeader from '../../components/SubPageHeader'

const Fleet3DForceGraph = dynamic(() => import('../../components/Fleet3DForceGraph'), { ssr: false })

export default function Fleet3DGraphPage() {
  return (
    <div className="min-h-dvh flex flex-col" style={{ background: '#020811', fontFamily: 'monospace' }}>
      <SubPageHeader title="Fleet 3D Force Graph" />

      <header className="border-b border-cyan-900/30 px-6 py-3">
        <div className="flex items-center gap-4">
          <h1
            className="text-lg font-black tracking-[0.18em]"
            style={{ fontFamily: 'Orbitron, monospace', color: '#00F5FF', textShadow: '0 0 20px #00F5FF60' }}
          >
            FLEET 3D FORCE GRAPH
          </h1>
          <div className="flex-1" />
          <Link
            href="/galaxy"
            className="text-[0.6rem] font-mono px-2.5 py-1 rounded border border-cyan-900/40 text-slate-400 hover:text-cyan-400 transition-colors"
          >
            ✵ Galaxy 2D
          </Link>
          <Link
            href="/graph3d"
            className="text-[0.6rem] font-mono px-2.5 py-1 rounded border border-cyan-900/40 text-slate-400 hover:text-cyan-400 transition-colors"
          >
            ⬡ Graph 3D (basic)
          </Link>
        </div>
      </header>

      <main className="flex-1 relative overflow-hidden" style={{ minHeight: 500 }}>
        <Fleet3DForceGraph />
      </main>

      <footer className="border-t border-cyan-900/20 px-6 py-2">
        <p className="text-[0.55rem] font-mono text-slate-600">
          Drag to orbit · Scroll to zoom · Double-click to reset · Click node to inspect · Edges = shared memory keywords (&gt;2) · Updates every 60s
        </p>
      </footer>
    </div>
  )
}
