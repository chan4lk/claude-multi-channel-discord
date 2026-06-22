'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import type { PermissionsResponse, ProjectPermissions, PermissionCell } from '../api/permissions/route'

function cellValue(proj: ProjectPermissions, tool: string): PermissionCell {
  if (proj.isBypass) return 'bypass'
  if (proj.isWildcardAllow) return 'allowed'
  if (proj.allowedTools.includes(tool)) return 'allowed'
  if (proj.disallowedTools.includes(tool)) return 'disallowed'
  return 'default'
}

const CELL_STYLE: Record<PermissionCell, { bg: string; color: string; label: string }> = {
  allowed:    { bg: 'rgba(74,222,128,0.15)',  color: '#4ADE80', label: '✓' },
  disallowed: { bg: 'rgba(239,68,68,0.15)',   color: '#EF4444', label: '✗' },
  bypass:     { bg: 'rgba(245,158,11,0.15)',  color: '#F59E0B', label: '⚡' },
  default:    { bg: 'rgba(255,255,255,0.02)', color: '#334155', label: '·' },
}

function riskLevel(proj: ProjectPermissions): { level: string; color: string } {
  if (proj.isBypass && proj.isWildcardAllow) return { level: 'CRITICAL', color: '#EF4444' }
  if (proj.isBypass) return { level: 'HIGH', color: '#F59E0B' }
  if (proj.isWildcardAllow) return { level: 'MEDIUM', color: '#FBBF24' }
  return { level: 'OK', color: '#4ADE80' }
}

function Tooltip({ text, children }: { text: string; children: React.ReactNode }) {
  const [visible, setVisible] = useState(false)
  return (
    <div className="relative inline-block" onMouseEnter={() => setVisible(true)} onMouseLeave={() => setVisible(false)}>
      {children}
      {visible && (
        <div
          className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 z-50 pointer-events-none whitespace-nowrap rounded px-2 py-1 text-[0.5rem] font-mono"
          style={{ background: '#080f1c', border: '1px solid rgba(0,245,255,0.2)', color: '#94a3b8' }}
        >
          {text}
        </div>
      )}
    </div>
  )
}

function generateCsv(projects: ProjectPermissions[], allTools: string[]): string {
  const header = ['project', 'permissionMode', ...allTools].join(',')
  const rows = projects.map((p) => {
    const cells = allTools.map((t) => cellValue(p, t))
    return [p.slug, p.permissionMode ?? 'default', ...cells].join(',')
  })
  return [header, ...rows].join('\n')
}

function downloadCsv(content: string) {
  const blob = new Blob([content], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'fleet-permissions.csv'
  a.click()
  URL.revokeObjectURL(url)
}

export default function PermissionsPage() {
  const [data, setData] = useState<PermissionsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [toolFilter, setToolFilter] = useState('')

  useEffect(() => {
    fetch('/api/permissions')
      .then((r) => r.json() as Promise<PermissionsResponse>)
      .then((d) => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center" style={{ background: '#060d1a' }}>
        <div className="text-xs font-mono text-slate-600 animate-pulse">Loading permissions…</div>
      </div>
    )
  }

  const projects = data?.projects ?? []
  const allTools = data?.allTools ?? []
  const defaults = data?.defaults

  const riskyProjects = projects.filter((p) => p.isBypass || p.isWildcardAllow)

  const visibleProjects = search
    ? projects.filter((p) => p.slug.toLowerCase().includes(search.toLowerCase()))
    : projects

  const visibleTools = toolFilter
    ? allTools.filter((t) => t.toLowerCase().includes(toolFilter.toLowerCase()))
    : allTools

  return (
    <div className="min-h-dvh flex flex-col" style={{ background: '#060d1a' }}>
      <header className="sticky top-0 z-30 border-b border-cyber-cyan/12 bg-[#060d1a]/90 backdrop-blur-md px-6 py-3">
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-cyber-cyan/40 to-transparent" />
        <div className="flex items-center gap-3 flex-wrap">
          <Link href="/" className="text-[0.6rem] font-mono text-slate-500 hover:text-cyber-cyan transition-colors uppercase tracking-wider">← Dashboard</Link>
          <h1 className="text-sm font-black tracking-[0.18em] text-cyber-cyan" style={{ fontFamily: 'Orbitron, JetBrains Mono, monospace' }}>
            Tool Permissions
          </h1>
          <span className="text-[0.55rem] font-mono text-slate-600 border border-slate-700 px-2 py-0.5 rounded">
            {projects.length} projects · {allTools.length} tools
          </span>
          <div className="flex-1" />
          <button
            onClick={() => data && downloadCsv(generateCsv(projects, allTools))}
            className="text-[0.6rem] font-mono text-slate-500 hover:text-cyber-cyan transition-colors border border-slate-700 hover:border-cyber-cyan/30 px-2 py-1 rounded"
          >
            ↓ CSV
          </button>
        </div>
      </header>

      <main className="flex-1 p-6 max-w-full overflow-hidden flex flex-col gap-6">
        {/* Legend */}
        <div className="flex items-center gap-4 flex-wrap">
          {(Object.entries(CELL_STYLE) as [PermissionCell, typeof CELL_STYLE[PermissionCell]][]).map(([key, style]) => (
            <div key={key} className="flex items-center gap-1.5">
              <div
                className="w-5 h-5 rounded text-center text-[0.6rem] font-mono flex items-center justify-center"
                style={{ background: style.bg, color: style.color }}
              >
                {style.label}
              </div>
              <span className="text-[0.55rem] font-mono text-slate-500 capitalize">{key}</span>
            </div>
          ))}
          <div className="text-[0.5rem] font-mono text-slate-700 ml-4">
            Defaults: mode={defaults?.permissionMode ?? 'none'} · allowed=[{defaults?.allowedTools.join(', ') || '—'}] · disallowed=[{defaults?.disallowedTools.join(', ') || '—'}]
          </div>
        </div>

        {/* Risky configs panel */}
        {riskyProjects.length > 0 && (
          <div className="rounded-lg border border-amber-500/20 p-4" style={{ background: 'rgba(245,158,11,0.03)' }}>
            <p className="text-[0.6rem] font-mono text-amber-400 uppercase tracking-wider mb-3">⚠ Risky Configurations ({riskyProjects.length})</p>
            <div className="flex flex-col gap-1.5">
              {riskyProjects.map((p) => {
                const risk = riskLevel(p)
                return (
                  <div key={p.slug} className="flex items-center gap-3">
                    <Link
                      href={`/projects/${encodeURIComponent(p.slug)}`}
                      className="text-[0.65rem] font-mono text-cyber-cyan hover:underline w-32 flex-shrink-0 truncate"
                    >
                      {p.slug}
                    </Link>
                    <span
                      className="text-[0.5rem] font-mono font-bold px-1.5 py-0.5 rounded"
                      style={{ color: risk.color, background: `${risk.color}20` }}
                    >
                      {risk.level}
                    </span>
                    <span className="text-[0.6rem] font-mono text-slate-400">
                      {p.isBypass && 'permissionMode=bypass'}
                      {p.isBypass && p.isWildcardAllow && ' · '}
                      {p.isWildcardAllow && 'allowedTools=[*]'}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {riskyProjects.length === 0 && (
          <div className="rounded-lg border border-green-500/15 p-3" style={{ background: 'rgba(74,222,128,0.03)' }}>
            <p className="text-[0.6rem] font-mono text-green-400">✓ No risky configurations found — no projects with bypass mode or wildcard allow</p>
          </div>
        )}

        {/* Filters */}
        <div className="flex gap-3 flex-wrap">
          <input
            className="text-[0.65rem] font-mono bg-transparent border border-slate-700 rounded px-2 py-1 text-slate-300 placeholder-slate-700 outline-none focus:border-cyber-cyan/40 w-40"
            placeholder="Filter projects…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <input
            className="text-[0.65rem] font-mono bg-transparent border border-slate-700 rounded px-2 py-1 text-slate-300 placeholder-slate-700 outline-none focus:border-cyber-cyan/40 w-40"
            placeholder="Filter tools…"
            value={toolFilter}
            onChange={(e) => setToolFilter(e.target.value)}
          />
          <span className="text-[0.55rem] font-mono text-slate-700 self-center">
            {visibleProjects.length} / {projects.length} projects · {visibleTools.length} / {allTools.length} tools
          </span>
        </div>

        {/* Heatmap matrix */}
        {allTools.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <div className="text-4xl opacity-15">⊟</div>
            <p className="text-xs font-mono text-slate-500">No tool permissions configured in channels.json</p>
            <p className="text-[0.6rem] font-mono text-slate-700">Set allowedTools or disallowedTools under defaults.claude or per-project claude config.</p>
          </div>
        ) : (
          <div className="overflow-auto rounded-lg border border-cyber-cyan/10" style={{ background: 'rgba(0,245,255,0.01)', maxHeight: 'calc(100dvh - 380px)' }}>
            <table className="text-[0.55rem] font-mono border-collapse" style={{ minWidth: '100%' }}>
              <thead className="sticky top-0 z-10" style={{ background: '#040b16' }}>
                <tr>
                  <th
                    className="text-left px-3 py-2 text-slate-500 font-normal border-b border-cyber-cyan/10 border-r border-cyber-cyan/8 sticky left-0 z-20"
                    style={{ background: '#040b16', minWidth: 120 }}
                  >
                    Project
                  </th>
                  <th
                    className="px-2 py-2 text-slate-500 font-normal border-b border-cyber-cyan/10 border-r border-cyber-cyan/8"
                    style={{ minWidth: 60 }}
                  >
                    Mode
                  </th>
                  {visibleTools.map((tool) => (
                    <th
                      key={tool}
                      className="px-1 py-2 border-b border-cyber-cyan/10 border-r border-white/3 font-normal"
                      style={{ minWidth: 40, maxWidth: 80 }}
                    >
                      <Tooltip text={tool}>
                        <span
                          className="block text-slate-500 uppercase tracking-wide truncate text-center"
                          style={{ maxWidth: 56, fontSize: '0.45rem' }}
                        >
                          {tool.length > 12 ? tool.slice(0, 11) + '…' : tool}
                        </span>
                      </Tooltip>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleProjects.map((proj) => {
                  const risk = riskLevel(proj)
                  return (
                    <tr key={proj.slug} className="hover:bg-white/2 transition-colors border-b border-white/3">
                      <td
                        className="px-3 py-1.5 border-r border-cyber-cyan/8 sticky left-0 z-10"
                        style={{ background: '#040b16' }}
                      >
                        <div className="flex items-center gap-1.5">
                          <Link
                            href={`/projects/${encodeURIComponent(proj.slug)}`}
                            className="text-cyber-cyan hover:underline truncate max-w-[96px]"
                          >
                            {proj.slug}
                          </Link>
                          {(proj.isBypass || proj.isWildcardAllow) && (
                            <span style={{ color: risk.color, fontSize: '0.45rem' }}>●</span>
                          )}
                        </div>
                      </td>
                      <td className="px-2 py-1.5 text-center border-r border-cyber-cyan/8">
                        <span style={{ color: proj.permissionMode ? '#F59E0B' : '#334155' }}>
                          {proj.permissionMode ? proj.permissionMode.slice(0, 8) : '—'}
                        </span>
                      </td>
                      {visibleTools.map((tool) => {
                        const cell = cellValue(proj, tool)
                        const style = CELL_STYLE[cell]
                        const tooltip = `${proj.slug} · ${tool} → ${cell}${proj.permissionMode ? ` (mode: ${proj.permissionMode})` : ''}`
                        return (
                          <td
                            key={tool}
                            className="text-center border-r border-white/3"
                            style={{ padding: '4px 2px' }}
                          >
                            <Tooltip text={tooltip}>
                              <div
                                className="w-6 h-5 mx-auto rounded-sm flex items-center justify-center cursor-default"
                                style={{ background: style.bg, color: style.color, fontSize: '0.6rem' }}
                              >
                                {style.label}
                              </div>
                            </Tooltip>
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        <p className="text-[0.5rem] font-mono text-slate-700">
          Source: channels.json defaults.claude + per-project claude config · ✓ allowed · ✗ disallowed · ⚡ bypass mode · · default (inherits)
        </p>
      </main>
    </div>
  )
}
