'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import type { DigestResponse, DigestHistoryResponse, DigestProject } from '../api/digest/route'

function flagColor(flag: string): string {
  if (flag.includes('critical') || flag === 'stuck') return '#EF4444'
  if (flag.includes('warning') || flag.includes('drift')) return '#F59E0B'
  return '#A855F7'
}

function ProjectRow({ p }: { p: DigestProject }) {
  const ctxColor = p.contextPct >= 90 ? '#EF4444' : p.contextPct >= 70 ? '#F59E0B' : '#10B981'
  const cnvColor = p.convergence == null ? '#475569' : p.convergence >= 60 ? '#10B981' : p.convergence >= 30 ? '#F59E0B' : '#EF4444'
  return (
    <div className="flex items-center gap-3 py-1.5 border-b border-white/5 text-[0.65rem]">
      <Link
        href={`/session-health/${encodeURIComponent(p.slug)}`}
        className="w-36 font-bold text-slate-200 hover:text-cyber-cyan truncate flex-shrink-0"
      >
        {p.slug}
      </Link>
      <span style={{ color: ctxColor, minWidth: 40 }}>ctx {p.contextPct}%</span>
      <span style={{ color: cnvColor, minWidth: 44 }}>cnv {p.convergence ?? '—'}</span>
      <span className="text-purple-400 min-w-[44px]">goal {p.goalPct ?? '—'}%</span>
      <span className="text-slate-500 min-w-[52px]">{p.turnsToday} turns</span>
      <span className="text-slate-500 min-w-[48px]">{p.alertCount} alerts</span>
      <div className="flex gap-1 flex-wrap">
        {p.flags.map((f) => (
          <span key={f} className="px-1 rounded text-[0.5rem]" style={{ color: flagColor(f), background: `${flagColor(f)}15` }}>
            {f}
          </span>
        ))}
      </div>
    </div>
  )
}

export default function DigestPage() {
  const [digest, setDigest] = useState<DigestResponse | null>(null)
  const [history, setHistory] = useState<DigestHistoryResponse['digests']>([])
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [tab, setTab] = useState<'current' | 'history' | 'markdown'>('current')

  async function loadLatest() {
    setLoading(true)
    try {
      const r = await fetch('/api/digest')
      if (r.ok) setDigest(await r.json() as DigestResponse)
    } catch { /* ignore */ } finally { setLoading(false) }
  }

  async function loadHistory() {
    try {
      const r = await fetch('/api/digest?history=1')
      if (r.ok) {
        const d = await r.json() as DigestHistoryResponse
        setHistory(d.digests)
      }
    } catch { /* ignore */ }
  }

  async function generate() {
    setGenerating(true)
    try {
      const r = await fetch('/api/digest', { method: 'POST' })
      if (r.ok) {
        setDigest(await r.json() as DigestResponse)
        loadHistory()
      }
    } catch { /* ignore */ } finally { setGenerating(false) }
  }

  useEffect(() => {
    loadLatest()
    loadHistory()
  }, [])

  const payload = digest?.payload

  return (
    <div className="min-h-screen bg-[#030712] text-slate-300 font-mono p-4">
      {/* Header */}
      <div className="flex items-center gap-3 mb-5">
        <Link href="/" className="text-slate-600 hover:text-cyber-cyan text-sm">←</Link>
        <h1 className="text-lg font-bold tracking-widest text-cyber-cyan uppercase">Fleet Digest</h1>
        {digest && (
          <span className="text-[0.6rem] text-slate-600">
            last: {new Date(digest.ts * 1000).toLocaleString()}
          </span>
        )}
        <button
          onClick={generate}
          disabled={generating}
          className="ml-auto text-[0.65rem] px-3 py-1.5 rounded border border-purple-500/30 text-purple-400 hover:bg-purple-500/10 transition-colors disabled:opacity-40"
        >
          {generating ? '⟳ Computing…' : '⚡ Generate Now'}
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-5 border-b border-white/5">
        {(['current', 'history', 'markdown'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="text-[0.65rem] px-3 py-1.5 capitalize transition-colors"
            style={{
              color: tab === t ? '#22D3EE' : '#64748B',
              borderBottom: tab === t ? '2px solid #22D3EE' : '2px solid transparent',
            }}
          >
            {t}
          </button>
        ))}
      </div>

      {loading && <div className="text-slate-600 animate-pulse text-sm">Loading digest…</div>}

      {!loading && !digest && tab === 'current' && (
        <div className="text-slate-600 text-sm">
          No digest yet.{' '}
          <button onClick={generate} className="text-cyber-cyan hover:underline">Generate one now →</button>
        </div>
      )}

      {/* Current digest tab */}
      {tab === 'current' && payload && (
        <div>
          {/* Summary chips */}
          <div className="flex gap-2 mb-5 flex-wrap">
            <span className="px-2 py-1 rounded text-[0.6rem] border border-cyber-cyan/20 text-cyber-cyan">
              {digest?.projectCount} projects
            </span>
            <span className="px-2 py-1 rounded text-[0.6rem] border border-amber-400/20 text-amber-400">
              {payload.totalAlerts} alerts
            </span>
            <span className="px-2 py-1 rounded text-[0.6rem] border border-red-500/20 text-red-400">
              {payload.stuckCount} stuck signals
            </span>
            <span className="px-2 py-1 rounded text-[0.6rem] border border-purple-400/20 text-purple-400">
              Top active: {payload.topActive.join(', ') || '—'}
            </span>
          </div>

          {/* Column headers */}
          <div className="flex items-center gap-3 pb-1 text-[0.55rem] text-slate-600 uppercase tracking-widest border-b border-white/5 mb-1">
            <span className="w-36 flex-shrink-0">Project</span>
            <span className="min-w-[40px]">Context</span>
            <span className="min-w-[44px]">Conv</span>
            <span className="min-w-[44px]">Goal</span>
            <span className="min-w-[52px]">Turns</span>
            <span className="min-w-[48px]">Alerts</span>
            <span>Flags</span>
          </div>

          {payload.projects.map((p) => <ProjectRow key={p.slug} p={p} />)}
        </div>
      )}

      {/* History tab */}
      {tab === 'history' && (
        <div className="space-y-2">
          {history.length === 0 && <div className="text-slate-600 text-sm">No digest history.</div>}
          {history.map((d) => (
            <div key={d.id} className="rounded-lg border border-white/5 p-3 bg-[#080f1c]">
              <div className="flex items-center gap-3 mb-1">
                <span className="text-[0.65rem] text-cyber-cyan font-bold">
                  {new Date(d.ts * 1000).toLocaleString()}
                </span>
                <span className="text-[0.55rem] text-slate-600">{d.projectCount} projects</span>
              </div>
              <div className="text-[0.6rem] text-slate-500 line-clamp-2">{d.summary}</div>
            </div>
          ))}
        </div>
      )}

      {/* Markdown tab */}
      {tab === 'markdown' && payload && (
        <div>
          <div className="flex justify-end mb-2">
            <button
              onClick={() => {
                const blob = new Blob([payload.markdownSummary], { type: 'text/markdown' })
                const url = URL.createObjectURL(blob)
                const a = document.createElement('a')
                a.href = url; a.download = 'fleet-digest.md'; a.click()
                URL.revokeObjectURL(url)
              }}
              className="text-[0.6rem] px-2 py-1 rounded border border-white/10 hover:border-amber-400 hover:text-amber-400 transition-colors"
            >
              ↓ Download .md
            </button>
          </div>
          <pre className="text-[0.65rem] text-slate-400 whitespace-pre-wrap leading-relaxed bg-[#080f1c] rounded-lg border border-white/5 p-4">
            {payload.markdownSummary}
          </pre>
        </div>
      )}
    </div>
  )
}
