'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import Link from 'next/link'
import type { WeeklyReportResponse, WeeklyProjectStats } from '../api/reports/weekly/route'

function fmt(n: number, decimals = 0): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: decimals })
}

function fmtMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${(ms / 60000).toFixed(1)}m`
}

function fmtCost(usd: number): string {
  if (usd < 0.01) return '<$0.01'
  return `$${usd.toFixed(2)}`
}

function NeonStat({ label, value, color = '#22D3EE' }: { label: string; value: string | number; color?: string }) {
  return (
    <div
      className="flex flex-col gap-1 rounded-lg p-4 border"
      style={{ background: `${color}0d`, borderColor: `${color}25` }}
    >
      <span className="text-[0.6rem] font-mono uppercase tracking-widest" style={{ color: `${color}80` }}>{label}</span>
      <span className="text-2xl font-black font-mono" style={{ color, textShadow: `0 0 12px ${color}60` }}>{value}</span>
    </div>
  )
}

function TurnsSparkline({ data }: { data: number[] }) {
  const w = 56, h = 18, pad = 1
  const max = Math.max(...data, 1)
  const pts = data.map((v, i) => {
    const x = pad + (i / (data.length - 1)) * (w - pad * 2)
    const y = h - pad - ((v / max) * (h - pad * 2))
    return `${x.toFixed(1)},${y.toFixed(1)}`
  })
  const last3 = data.slice(-3)
  const trend = last3[2] > last3[0] ? 'up' : last3[2] < last3[0] ? 'down' : 'flat'
  const color = trend === 'up' ? '#4ADE80' : trend === 'down' ? '#F87171' : '#475569'
  return (
    <svg width={w} height={h} style={{ display: 'inline-block', verticalAlign: 'middle', maxWidth: '100%' }}>
      <polyline
        points={pts.join(' ')}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        style={{ filter: `drop-shadow(0 0 3px ${color}80)` }}
      />
    </svg>
  )
}

type SortKey = 'rank' | 'slug' | 'turns' | 'toolCalls' | 'tokens' | 'cost' | 'stalls' | 'prCount' | 'avgTurnMs' | 'memoriesWritten'

function ProjectRow({ p, rank, highlighted }: { p: WeeklyProjectStats & { _rank: number }; rank: number; highlighted: boolean }) {
  const isTop3 = rank <= 3
  const borderColor = rank === 1 ? '#F59E0B' : rank === 2 ? '#94A3B8' : rank === 3 ? '#B45309' : 'transparent'
  return (
    <tr
      id={p.slug}
      className="border-b border-white/5 hover:bg-white/3 transition-colors"
      style={{
        ...(isTop3 ? { boxShadow: `inset 2px 0 0 ${borderColor}` } : {}),
        ...(highlighted ? { outline: '1px solid #22D3EE', outlineOffset: '-1px', background: 'rgba(34,211,238,0.06)' } : {}),
      }}
    >
      <td className="px-3 py-2 font-mono text-[0.65rem]" style={{ color: isTop3 ? borderColor : '#475569' }}>{rank}</td>
      <td className="px-3 py-2 font-mono text-[0.7rem] font-semibold text-slate-200">{p.slug}</td>
      <td className="px-3 py-2 font-mono text-[0.65rem] text-cyan-400">
        <span className="mr-1.5">{fmt(p.turns)}</span>
        {p.dailyTurns && p.dailyTurns.length === 7 && <TurnsSparkline data={p.dailyTurns} />}
      </td>
      <td className="px-3 py-2 font-mono text-[0.65rem] text-purple-400">{fmt(p.toolCalls)}</td>
      <td className="px-3 py-2 font-mono text-[0.65rem] text-blue-400">{fmt(p.inputTokens + p.outputTokens)}</td>
      <td className="px-3 py-2 font-mono text-[0.65rem] text-green-400">{fmtCost(p.estimatedCostUsd)}</td>
      <td className="px-3 py-2 font-mono text-[0.65rem] text-amber-400">{p.stalls}</td>
      <td className="px-3 py-2 font-mono text-[0.65rem] text-emerald-400">{p.prCount}</td>
      <td className="px-3 py-2 font-mono text-[0.65rem] text-slate-400">{p.avgTurnMs > 0 ? fmtMs(p.avgTurnMs) : '—'}</td>
      <td className="px-3 py-2 font-mono text-[0.65rem] text-slate-500">{p.memoriesWritten}</td>
    </tr>
  )
}

function generateHtml(report: WeeklyReportResponse): string {
  const { fleet, projects, weekStart, weekEnd, generatedAt } = report
  const rows = projects.map((p, i) => `
    <tr style="border-bottom:1px solid rgba(255,255,255,0.06)">
      <td style="padding:6px 12px;color:#94a3b8">${i + 1}</td>
      <td style="padding:6px 12px;color:#e2e8f0;font-weight:600">${p.slug}</td>
      <td style="padding:6px 12px;color:#22d3ee">${p.turns}</td>
      <td style="padding:6px 12px;color:#a78bfa">${p.toolCalls}</td>
      <td style="padding:6px 12px;color:#60a5fa">${(p.inputTokens + p.outputTokens).toLocaleString()}</td>
      <td style="padding:6px 12px;color:#4ade80">${fmtCost(p.estimatedCostUsd)}</td>
      <td style="padding:6px 12px;color:#f59e0b">${p.stalls}</td>
      <td style="padding:6px 12px;color:#34d399">${p.prCount}</td>
    </tr>`).join('')

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Fleet Weekly Report ${weekStart} – ${weekEnd}</title>
<style>
  body{margin:0;background:#060d18;color:#cbd5e1;font-family:JetBrains Mono,Consolas,monospace;padding:32px}
  h1{color:#22d3ee;font-size:1.4rem;letter-spacing:0.15em;text-shadow:0 0 16px #22d3ee80;margin:0 0 4px}
  .subtitle{color:#475569;font-size:0.7rem;margin:0 0 24px}
  .stats{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:12px;margin-bottom:28px}
  .stat{border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:14px}
  .stat-label{font-size:0.55rem;text-transform:uppercase;letter-spacing:0.1em;color:#64748b;margin-bottom:6px}
  .stat-val{font-size:1.4rem;font-weight:900}
  table{width:100%;border-collapse:collapse;font-size:0.7rem}
  th{text-align:left;padding:8px 12px;color:#475569;text-transform:uppercase;font-size:0.55rem;letter-spacing:0.08em;border-bottom:1px solid rgba(255,255,255,0.1)}
  .footer{margin-top:20px;font-size:0.6rem;color:#334155}
</style>
</head>
<body>
<h1>FLEET WEEKLY REPORT</h1>
<p class="subtitle">${weekStart} – ${weekEnd} &nbsp;|&nbsp; Generated ${generatedAt}</p>
<div class="stats">
  <div class="stat"><div class="stat-label">Projects Active</div><div class="stat-val" style="color:#22d3ee">${fleet.projectCount}</div></div>
  <div class="stat"><div class="stat-label">Total Turns</div><div class="stat-val" style="color:#a78bfa">${fleet.totalTurns.toLocaleString()}</div></div>
  <div class="stat"><div class="stat-label">Tool Calls</div><div class="stat-val" style="color:#60a5fa">${fleet.totalToolCalls.toLocaleString()}</div></div>
  <div class="stat"><div class="stat-label">Total Tokens</div><div class="stat-val" style="color:#34d399">${((fleet.totalInputTokens + fleet.totalOutputTokens) / 1000).toFixed(0)}k</div></div>
  <div class="stat"><div class="stat-label">Est. Cost</div><div class="stat-val" style="color:#4ade80">${fmtCost(fleet.totalEstimatedCostUsd)}</div></div>
  <div class="stat"><div class="stat-label">Stalls</div><div class="stat-val" style="color:#f87171">${fleet.totalStalls}</div></div>
  <div class="stat"><div class="stat-label">PRs Merged</div><div class="stat-val" style="color:#f59e0b">${fleet.totalPrs}</div></div>
  <div class="stat"><div class="stat-label">Top Active</div><div class="stat-val" style="color:#22d3ee;font-size:1rem">${fleet.topByActivity}</div></div>
</div>
<table>
  <thead><tr>
    <th>#</th><th>Slug</th><th>Turns</th><th>Tools</th><th>Tokens</th><th>Cost</th><th>Stalls</th><th>PRs</th>
  </tr></thead>
  <tbody>${rows}</tbody>
</table>
<div class="footer">Generated by Mission Control · claude-mcd</div>
</body>
</html>`
}

export default function ReportsPage() {
  const [report, setReport] = useState<WeeklyReportResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [saveMsg, setSaveMsg] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<SortKey>('rank')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [highlightSlug, setHighlightSlug] = useState<string | null>(null)
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const fetchReport = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/reports/weekly')
      if (res.ok) setReport(await res.json())
    } catch {}
    setLoading(false)
  }, [])

  useEffect(() => { fetchReport() }, [fetchReport])

  useEffect(() => {
    const slug = window.location.hash.slice(1)
    if (!slug) return
    setHighlightSlug(slug)
    const el = document.getElementById(slug)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    if (highlightTimer.current) clearTimeout(highlightTimer.current)
    highlightTimer.current = setTimeout(() => setHighlightSlug(null), 3000)
  }, [report])

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir(key === 'slug' ? 'asc' : 'desc')
    }
  }

  function sortedProjects(projects: WeeklyProjectStats[]) {
    const ranked = projects.map((p, i) => ({ ...p, _rank: i + 1 }))
    if (sortKey === 'rank') return sortDir === 'asc' ? ranked : [...ranked].reverse()
    return [...ranked].sort((a, b) => {
      let av: number | string = 0, bv: number | string = 0
      if (sortKey === 'slug') { av = a.slug; bv = b.slug }
      else if (sortKey === 'turns') { av = a.turns; bv = b.turns }
      else if (sortKey === 'toolCalls') { av = a.toolCalls; bv = b.toolCalls }
      else if (sortKey === 'tokens') { av = a.inputTokens + a.outputTokens; bv = b.inputTokens + b.outputTokens }
      else if (sortKey === 'cost') { av = a.estimatedCostUsd; bv = b.estimatedCostUsd }
      else if (sortKey === 'stalls') { av = a.stalls; bv = b.stalls }
      else if (sortKey === 'prCount') { av = a.prCount; bv = b.prCount }
      else if (sortKey === 'avgTurnMs') { av = a.avgTurnMs; bv = b.avgTurnMs }
      else if (sortKey === 'memoriesWritten') { av = a.memoriesWritten; bv = b.memoriesWritten }
      const cmp = typeof av === 'string' ? av.localeCompare(bv as string) : (av as number) - (bv as number)
      return sortDir === 'asc' ? cmp : -cmp
    })
  }

  async function handleGenerate() {
    setGenerating(true)
    setSaveMsg(null)
    try {
      const res = await fetch('/api/reports/weekly/generate', { method: 'POST' })
      const d = await res.json() as { ok?: boolean; savedTo?: string; weekLabel?: string; error?: string }
      setSaveMsg(d.ok ? `Saved: ${d.savedTo}` : (d.error ?? 'Unknown error'))
    } catch (e) {
      setSaveMsg(String(e))
    }
    setGenerating(false)
  }

  function handleExport() {
    if (!report) return
    const html = generateHtml(report)
    const blob = new Blob([html], { type: 'text/html' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `fleet-weekly-${report.weekStart}.html`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <div className="min-h-dvh">
      <header className="relative border-b border-cyber-cyan/12 bg-cyber-surface/70 backdrop-blur-md px-6 py-4">
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-cyber-cyan/40 to-transparent" />
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-xl font-black tracking-[0.18em] text-cyber-cyan neon-cyan" style={{ fontFamily: 'Orbitron, JetBrains Mono, monospace' }}>
              WEEKLY FLEET REPORT
            </h1>
            <div className="flex items-center gap-3 mt-0.5">
              <Link href="/" className="text-[0.6rem] font-mono text-slate-500 hover:text-cyber-cyan transition-colors uppercase tracking-wider">
                ← Dashboard
              </Link>
              {report && (
                <span className="text-[0.6rem] font-mono text-slate-600">
                  {report.weekStart} – {report.weekEnd}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <button
              onClick={fetchReport}
              className="text-[0.6rem] font-mono px-2 py-1 rounded border border-cyber-cyan/20 text-slate-400 hover:text-cyber-cyan hover:border-cyber-cyan/40 transition-colors"
            >
              ↺ Refresh
            </button>
            <button
              onClick={handleGenerate}
              disabled={generating}
              className="text-[0.6rem] font-mono px-2 py-1 rounded border border-purple-500/30 text-slate-400 hover:text-purple-400 hover:border-purple-500/60 transition-colors disabled:opacity-50"
            >
              {generating ? 'Saving…' : '💾 Save Report'}
            </button>
            {report && (
              <button
                onClick={handleExport}
                className="text-[0.6rem] font-mono px-2 py-1 rounded border border-green-500/30 text-slate-400 hover:text-green-400 hover:border-green-500/60 transition-colors"
              >
                ⬇ Export HTML
              </button>
            )}
          </div>
        </div>
        {saveMsg && (
          <div className="mt-2 text-[0.6rem] font-mono text-slate-500 truncate">{saveMsg}</div>
        )}
      </header>

      <main className="p-4 sm:p-6">
        {loading ? (
          <div className="text-slate-500 text-sm text-center py-12 animate-pulse">Generating report…</div>
        ) : !report ? (
          <div className="text-slate-500 text-sm text-center py-12 font-mono">Failed to load report.</div>
        ) : (
          <div className="flex flex-col gap-8">
            {/* Fleet summary */}
            <div>
              <div className="text-[0.6rem] font-mono uppercase tracking-widest text-slate-500 mb-3">
                Fleet Summary — {report.fleet.projectCount} active projects
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
                <NeonStat label="Turns" value={fmt(report.fleet.totalTurns)} color="#A78BFA" />
                <NeonStat label="Tool Calls" value={fmt(report.fleet.totalToolCalls)} color="#60A5FA" />
                <NeonStat label="Input Tokens" value={fmt(Math.round(report.fleet.totalInputTokens / 1000)) + 'k'} color="#22D3EE" />
                <NeonStat label="Output Tokens" value={fmt(Math.round(report.fleet.totalOutputTokens / 1000)) + 'k'} color="#34D399" />
                <NeonStat label="Est. Cost" value={fmtCost(report.fleet.totalEstimatedCostUsd)} color="#4ADE80" />
                <NeonStat label="Stalls" value={fmt(report.fleet.totalStalls)} color="#F87171" />
                <NeonStat label="PRs" value={fmt(report.fleet.totalPrs)} color="#F59E0B" />
                <NeonStat label="Top Active" value={report.fleet.topByActivity} color="#22D3EE" />
              </div>
            </div>

            {/* Per-project table */}
            <div>
              <div className="text-[0.6rem] font-mono uppercase tracking-widest text-slate-500 mb-3">
                Per-Project Breakdown — click column to sort
              </div>
              <div className="overflow-x-auto rounded border border-white/6">
                <table className="w-full text-[0.65rem] font-mono">
                  <thead>
                    <tr className="border-b border-white/8">
                      {([
                        ['#', 'rank'],
                        ['Slug', 'slug'],
                        ['Turns', 'turns'],
                        ['Tools', 'toolCalls'],
                        ['Tokens', 'tokens'],
                        ['Cost', 'cost'],
                        ['Stalls', 'stalls'],
                        ['PRs', 'prCount'],
                        ['Avg Turn', 'avgTurnMs'],
                        ['Memories', 'memoriesWritten'],
                      ] as [string, SortKey][]).map(([label, key]) => (
                        <th
                          key={key}
                          onClick={() => handleSort(key)}
                          className="text-left px-3 py-2.5 uppercase tracking-wider font-semibold cursor-pointer select-none transition-colors"
                          style={{
                            color: sortKey === key ? '#22D3EE' : '#475569',
                          }}
                        >
                          {label}
                          {sortKey === key && (
                            <span className="ml-1 text-[0.5rem]">{sortDir === 'asc' ? '▲' : '▼'}</span>
                          )}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sortedProjects(report.projects).map((p) => (
                      <ProjectRow key={p.slug} p={p} rank={p._rank} highlighted={highlightSlug === p.slug} />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="text-[0.55rem] font-mono text-slate-700">
              Report generated {report.generatedAt} · Data from transcript .jsonl files in ~/.claude/projects/
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
