'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useFreshness } from '../../lib/useFreshness'
import FreshnessBadge from '../../components/FreshnessBadge'

interface SnapshotRow {
  id: number
  label: string
  ts: number
  project_count: number
  data: string
}
interface SnapshotsResponse {
  snapshots: SnapshotRow[]
}

interface Parsed {
  id: number
  ts: number
  label: string
  idle: number
  active: number
  stalled: number
  autonomous: number
}

const STATE_TILES: { key: keyof Pick<Parsed, 'idle' | 'active' | 'stalled' | 'autonomous'>; label: string; color: string }[] = [
  { key: 'idle', label: 'Idle', color: '#00F5FF' },
  { key: 'active', label: 'Active', color: '#4ADE80' },
  { key: 'stalled', label: 'Stalled', color: '#EF4444' },
  { key: 'autonomous', label: 'Autonomous', color: '#A855F7' },
]

const SPARK_W = 680
const SPARK_H = 70

export default function SnapshotScrubberPage() {
  const { data, isStale, lastError, lastSuccessAt } = useFreshness<SnapshotsResponse>('/api/snapshots', 60_000)
  const loading = data === null && lastError === null

  const snaps = useMemo<Parsed[]>(() => {
    const rows = data?.snapshots ?? []
    const out: Parsed[] = []
    for (const r of rows) {
      let d: Record<string, unknown> = {}
      try { d = JSON.parse(r.data) } catch { /* skip malformed */ }
      out.push({
        id: r.id,
        ts: r.ts,
        label: r.label,
        idle: Number(d.idle ?? 0),
        active: Number(d.active ?? 0),
        stalled: Number(d.stalled ?? 0),
        autonomous: Number(d.autonomous ?? 0),
      })
    }
    return out.sort((a, b) => a.ts - b.ts) // oldest → newest
  }, [data])

  const [idx, setIdx] = useState(0)
  const [playing, setPlaying] = useState(false)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  // Clamp selection when the snapshot set changes (default to newest).
  const lastLen = useRef(0)
  useEffect(() => {
    if (snaps.length !== lastLen.current) {
      setIdx(Math.max(0, snaps.length - 1))
      lastLen.current = snaps.length
    }
  }, [snaps.length])

  useEffect(() => {
    if (!playing || snaps.length === 0) return
    timer.current = setInterval(() => {
      setIdx((i) => {
        if (i >= snaps.length - 1) { setPlaying(false); return i }
        return i + 1
      })
    }, 1000)
    return () => { if (timer.current) clearInterval(timer.current) }
  }, [playing, snaps.length])

  if (loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center" style={{ background: '#060d1a' }}>
        <div className="text-xs font-mono text-slate-600 animate-pulse">Loading fleet snapshots…</div>
      </div>
    )
  }

  const sel = snaps[Math.min(idx, snaps.length - 1)]
  const maxBusy = Math.max(1, ...snaps.map((s) => s.active + s.autonomous))
  const xAt = (i: number) => (snaps.length <= 1 ? SPARK_W / 2 : (i / (snaps.length - 1)) * SPARK_W)
  const yAt = (v: number) => SPARK_H - (v / maxBusy) * (SPARK_H - 6) - 3
  const sparkPts = snaps.map((s, i) => `${xAt(i)},${yAt(s.active + s.autonomous)}`).join(' ')

  const fmtTs = (ts: number) => new Date(ts * 1000).toLocaleString()

  return (
    <div className="min-h-dvh flex flex-col" style={{ background: '#060d1a' }}>
      <header className="sticky top-0 z-30 border-b border-cyber-cyan/12 bg-[#060d1a]/90 backdrop-blur-md px-6 py-3">
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-cyber-cyan/40 to-transparent" />
        <div className="flex items-center gap-3 flex-wrap">
          <Link href="/" className="text-[0.6rem] font-mono text-slate-500 hover:text-cyber-cyan transition-colors uppercase tracking-wider">← Dashboard</Link>
          <h1 className="text-sm font-black tracking-[0.18em] text-cyber-cyan" style={{ fontFamily: 'Orbitron, JetBrains Mono, monospace' }}>
            Snapshot Scrubber
          </h1>
          <span className="text-[0.6rem] font-mono text-slate-500 border border-slate-700 px-2 py-0.5 rounded">replay how the fleet evolved</span>
          <FreshnessBadge isStale={isStale} lastError={lastError} lastSuccessAt={lastSuccessAt} />
          <div className="flex-1" />
          <span className="text-[0.55rem] font-mono text-slate-500">{snaps.length} snapshots</span>
        </div>
      </header>

      <main className="flex-1 p-6 max-w-4xl mx-auto w-full">
        {snaps.length === 0 ? (
          <div className="h-64 flex items-center justify-center text-slate-600 text-xs font-mono">No fleet snapshots recorded yet.</div>
        ) : (
          <div className="flex flex-col gap-5">
            {/* state tiles for the selected snapshot */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {STATE_TILES.map((t) => (
                <div key={t.key} className="rounded-xl border p-3" style={{ borderColor: `${t.color}30`, background: `${t.color}08` }}>
                  <div className="text-[0.55rem] font-mono uppercase tracking-wider" style={{ color: t.color }}>{t.label}</div>
                  <div className="text-2xl font-black tabular-nums" style={{ fontFamily: 'Orbitron, monospace', color: t.color }}>{sel[t.key]}</div>
                </div>
              ))}
            </div>

            {/* sparkline of active+autonomous with marker at selection */}
            <div className="rounded-xl border border-cyber-cyan/12 p-4" style={{ background: 'rgba(0,245,255,0.02)' }}>
              <div className="text-[0.55rem] font-mono uppercase tracking-wider text-slate-500 mb-1">active + autonomous over time</div>
              <svg viewBox={`0 0 ${SPARK_W} ${SPARK_H}`} width="100%" preserveAspectRatio="none" style={{ height: 70 }}>
                <polyline points={sparkPts} fill="none" stroke="#22d3ee" strokeWidth={1.5} />
                <line x1={xAt(idx)} x2={xAt(idx)} y1={0} y2={SPARK_H} stroke="#fbbf24" strokeWidth={1} strokeDasharray="3 2" />
                <circle cx={xAt(idx)} cy={yAt(sel.active + sel.autonomous)} r={3.5} fill="#fbbf24" />
              </svg>
            </div>

            {/* scrubber controls */}
            <div className="flex items-center gap-3">
              <button
                onClick={() => setPlaying((p) => !p)}
                className="text-xs font-mono border border-cyber-cyan/30 hover:border-cyber-cyan/60 text-cyber-cyan rounded px-3 py-1.5 transition-colors"
                title="Play / pause"
              >
                {playing ? '❚❚ Pause' : '▶ Play'}
              </button>
              <input
                type="range"
                min={0}
                max={snaps.length - 1}
                value={idx}
                onChange={(e) => { setPlaying(false); setIdx(Number(e.target.value)) }}
                className="flex-1 accent-cyan-400"
              />
              <span className="text-[0.6rem] font-mono text-slate-400 tabular-nums shrink-0">{idx + 1}/{snaps.length}</span>
            </div>

            <div className="text-[0.6rem] font-mono text-slate-500">
              <span className="text-cyber-cyan">{fmtTs(sel.ts)}</span>
              {sel.label && <span className="text-slate-400"> · {sel.label}</span>}
              <span className="text-slate-600"> · {sel.idle + sel.active + sel.stalled + sel.autonomous} projects</span>
            </div>
          </div>
        )}

        <p className="text-[0.5rem] font-mono text-slate-700 mt-6">
          Replays <code>fleet_snapshots</code> over time. Drag the slider (or Play to auto-advance ~1/sec) to select a
          snapshot; the tiles show that moment's idle/active/stalled/autonomous counts and the sparkline plots
          active+autonomous across all snapshots with a marker at the selection. Reuses <code>/api/snapshots</code>.
          Refreshes every 60s.
        </p>
      </main>
    </div>
  )
}
