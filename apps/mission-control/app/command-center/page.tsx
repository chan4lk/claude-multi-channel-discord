'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import type { FleetResponse, FleetProject } from '../api/fleet/route'
import type { BacklogResponse } from '../api/backlog/route'
import { useFreshness } from '../../lib/useFreshness'
import FreshnessBadge from '../../components/FreshnessBadge'
import { scoreProject, attentionColor } from '../../lib/attention'

function fmtMins(n: number): string {
  if (n >= 60) return `${(n / 60).toFixed(1)}h`
  return `${Math.round(n)}m`
}

function Panel({ title, href, accent, children }: { title: string; href: string; accent: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="group block rounded-xl border border-cyber-cyan/12 p-4 transition-colors hover:border-cyber-cyan/40" style={{ background: 'rgba(0,245,255,0.02)' }}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-[0.6rem] font-mono uppercase tracking-[0.2em]" style={{ color: accent }}>{title}</span>
        <span className="text-[0.55rem] font-mono text-slate-600 group-hover:text-cyber-cyan transition-colors">open →</span>
      </div>
      {children}
    </Link>
  )
}

export default function CommandCenterPage() {
  const fleet = useFreshness<FleetResponse>('/api/fleet', 60_000)
  const backlog = useFreshness<BacklogResponse>('/api/backlog', 120_000)
  const loading = fleet.data === null && fleet.lastError === null

  const projects = useMemo(() => (fleet.data?.projects ?? []) as FleetProject[], [fleet.data])

  // Panel 1 — top attention.
  const topAttention = useMemo(() => projects.map(scoreProject).sort((a, b) => b.total - a.total).slice(0, 3), [projects])

  // Panel 2 — queue & breakers.
  const queue = useMemo(() => {
    let queued = 0, breakers = 0
    let worst: { slug: string; q: number } | null = null
    for (const p of projects) {
      const q = p.queuedCount ?? 0
      queued += q
      if (p.circuitOpen) breakers++
      if (q > 0 && (!worst || q > worst.q)) worst = { slug: p.slug, q }
    }
    return { queued, breakers, worst }
  }, [projects])

  // Panel 3 — soonest context fill.
  const imminent = useMemo(() => {
    let best: { slug: string; eta: number } | null = null
    for (const p of projects) {
      const eta = p.contextFillEtaMinutes
      if (eta != null && Number.isFinite(eta) && (!best || eta < best.eta)) best = { slug: p.slug, eta }
    }
    return best
  }, [projects])

  // Panel 4 — backlog.
  const backlogStats = useMemo(() => {
    const projs = backlog.data?.projects ?? []
    let pending = 0
    let oldest: { title: string; createdAt: string } | null = null
    for (const pb of projs) {
      pending += pb.pendingCount
      for (const it of pb.items) {
        if (it.status === 'pending' && it.createdAt) {
          if (!oldest || it.createdAt < oldest.createdAt) oldest = { title: it.title, createdAt: it.createdAt }
        }
      }
    }
    return { pending, oldest }
  }, [backlog.data])

  if (loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center" style={{ background: '#060d1a' }}>
        <div className="text-xs font-mono text-slate-600 animate-pulse">Booting command center…</div>
      </div>
    )
  }

  return (
    <div className="min-h-dvh flex flex-col" style={{ background: '#060d1a' }}>
      <header className="sticky top-0 z-30 border-b border-cyber-cyan/12 bg-[#060d1a]/90 backdrop-blur-md px-6 py-3">
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-cyber-cyan/40 to-transparent" />
        <div className="flex items-center gap-3 flex-wrap">
          <Link href="/" className="text-[0.6rem] font-mono text-slate-500 hover:text-cyber-cyan transition-colors uppercase tracking-wider">← Dashboard</Link>
          <h1 className="text-sm font-black tracking-[0.18em] text-cyber-cyan" style={{ fontFamily: 'Orbitron, JetBrains Mono, monospace' }}>
            Fleet Command Center
          </h1>
          <span className="text-[0.6rem] font-mono text-slate-500 border border-slate-700 px-2 py-0.5 rounded">open this first — the whole fleet in one glance</span>
          <FreshnessBadge isStale={fleet.isStale} lastError={fleet.lastError} lastSuccessAt={fleet.lastSuccessAt} />
        </div>
      </header>

      <main className="flex-1 p-6 max-w-4xl mx-auto w-full">
        <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
          {/* Top attention */}
          <Panel title="Top Attention" href="/scoreboard" accent="#ef4444">
            {topAttention.length === 0 ? (
              <div className="text-[0.6rem] font-mono text-slate-600">No projects.</div>
            ) : (
              <div className="space-y-1.5">
                {topAttention.map((a) => (
                  <div key={a.slug} className="flex items-center gap-2">
                    <span className="w-8 text-right text-sm font-black tabular-nums" style={{ fontFamily: 'Orbitron, monospace', color: attentionColor(a.total) }}>{Math.round(a.total)}</span>
                    <span className="flex-1 text-[0.65rem] font-bold text-slate-200 truncate" style={{ fontFamily: 'Orbitron, monospace' }}>{a.slug}</span>
                    <span className="text-[0.5rem] font-mono uppercase tracking-wider text-slate-500">{a.reason}</span>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          {/* Queue / breakers */}
          <Panel title="Queue & Breakers" href="/queue-board" accent="#a78bfa">
            <div className="flex items-center gap-6">
              <div>
                <div className="text-2xl font-black tabular-nums text-cyber-cyan" style={{ fontFamily: 'Orbitron, monospace' }}>{queue.queued}</div>
                <div className="text-[0.5rem] font-mono uppercase tracking-wider text-slate-500">queued msgs</div>
              </div>
              <div>
                <div className="text-2xl font-black tabular-nums" style={{ fontFamily: 'Orbitron, monospace', color: queue.breakers > 0 ? '#ef4444' : '#475569' }}>{queue.breakers}</div>
                <div className="text-[0.5rem] font-mono uppercase tracking-wider text-slate-500">open breakers</div>
              </div>
            </div>
            <div className="mt-2 text-[0.55rem] font-mono text-slate-600">{queue.worst ? `worst: ${queue.worst.slug} (${queue.worst.q})` : 'no backlog'}</div>
          </Panel>

          {/* Context imminent */}
          <Panel title="Context Imminent" href="/context-eta" accent="#22d3ee">
            {imminent ? (
              <div>
                <div className="text-2xl font-black tabular-nums" style={{ fontFamily: 'Orbitron, monospace', color: imminent.eta < 15 ? '#ef4444' : imminent.eta < 60 ? '#f59e0b' : '#34d399' }}>{fmtMins(imminent.eta)}</div>
                <div className="text-[0.6rem] font-bold text-slate-300 truncate" style={{ fontFamily: 'Orbitron, monospace' }}>{imminent.slug}</div>
                <div className="text-[0.5rem] font-mono uppercase tracking-wider text-slate-500">until forced compaction</div>
              </div>
            ) : (
              <div className="text-[0.6rem] font-mono text-slate-600">No projected context fill.</div>
            )}
          </Panel>

          {/* Backlog */}
          <Panel title="Backlog" href="/backlog" accent="#f59e0b">
            <div className="text-2xl font-black tabular-nums text-cyber-cyan" style={{ fontFamily: 'Orbitron, monospace' }}>{backlogStats.pending}</div>
            <div className="text-[0.5rem] font-mono uppercase tracking-wider text-slate-500 mb-1">pending proposals</div>
            <div className="text-[0.55rem] font-mono text-slate-600 truncate">{backlogStats.oldest ? `oldest: ${backlogStats.oldest.title}` : (backlog.lastError ? 'backlog unavailable' : 'none pending')}</div>
          </Panel>
        </div>

        <p className="text-[0.5rem] font-mono text-slate-700 mt-6">
          Holistic control room fusing the top signals from four views: highest-attention projects
          (shared <code>lib/attention.ts</code>), queued messages &amp; open breakers, the soonest project to force a
          context compaction, and pending backlog volume (<code>/api/backlog</code>). Each panel links to its full view.
          Reuses <code>/api/fleet</code> + <code>/api/backlog</code> — no new endpoint. Refreshes every 60s.
        </p>
      </main>
    </div>
  )
}
