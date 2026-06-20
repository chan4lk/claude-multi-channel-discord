'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { FleetResponse, ProjectState } from '../app/api/fleet/route'

const STATE_COLORS: Record<ProjectState, string> = {
  idle: '#00F5FF',
  active: '#4ADE80',
  stalled: '#EF4444',
  autonomous: '#A855F7',
}

const RECENT_KEY = 'mc_cmd_recent'
const MAX_RECENT = 5

interface Command {
  id: string
  label: string
  description: string
  icon: string
  category: 'navigate' | 'project'
  badge?: { text: string; color: string }
  action: () => void
}

function loadRecent(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')
  } catch {
    return []
  }
}

function saveRecent(id: string) {
  try {
    const prev = loadRecent().filter((x) => x !== id)
    localStorage.setItem(RECENT_KEY, JSON.stringify([id, ...prev].slice(0, MAX_RECENT)))
  } catch {}
}

function fuzzyMatch(query: string, text: string): boolean {
  if (!query) return true
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  let qi = 0
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++
  }
  return qi === q.length
}

function formatAge(ageMins: number): string {
  if (ageMins >= 9999) return '—'
  if (ageMins < 60) return `${ageMins}m`
  if (ageMins < 1440) return `${Math.floor(ageMins / 60)}h`
  return `${Math.floor(ageMins / 1440)}d`
}

export default function CommandPalette() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const [fleet, setFleet] = useState<FleetResponse | null>(null)
  const [recent, setRecent] = useState<string[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

  const closeWithEsc = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') setOpen(false)
  }, [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault()
        setOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (open) {
      setQuery('')
      setSelected(0)
      setRecent(loadRecent())
      inputRef.current?.focus()
      window.addEventListener('keydown', closeWithEsc)
      if (!fleet) {
        fetch('/api/fleet').then((r) => r.json()).then((d) => setFleet(d)).catch(() => {})
      }
    } else {
      window.removeEventListener('keydown', closeWithEsc)
    }
    return () => window.removeEventListener('keydown', closeWithEsc)
  }, [open, closeWithEsc, fleet])

  function execute(cmd: Command) {
    saveRecent(cmd.id)
    setOpen(false)
    cmd.action()
  }

  function buildCommands(): Command[] {
    const navigate: Command[] = [
      {
        id: 'nav:dashboard',
        label: 'Go to Dashboard',
        description: 'Main observability view',
        icon: '⌂',
        category: 'navigate',
        action: () => router.push('/'),
      },
      {
        id: 'nav:graph',
        label: 'Go to Graph',
        description: 'Force-directed project graph',
        icon: '⬡',
        category: 'navigate',
        action: () => router.push('/graph'),
      },
      {
        id: 'nav:timeline',
        label: 'Go to Timeline',
        description: 'Cross-channel activity timeline',
        icon: '◫',
        category: 'navigate',
        action: () => router.push('/timeline'),
      },
      {
        id: 'nav:memory-graph',
        label: 'Go to Memory Constellation',
        description: 'Memory graph visualization',
        icon: '✦',
        category: 'navigate',
        action: () => router.push('/memory-graph'),
      },
    ]

    const projects: Command[] = (fleet?.projects ?? []).flatMap((p) => [
      {
        id: `project:transcript:${p.slug}`,
        label: `Transcript: ${p.slug}`,
        description: `Live transcript — ${formatAge(p.ageMins)} ago`,
        icon: '▶',
        category: 'project' as const,
        badge: { text: p.state, color: STATE_COLORS[p.state] },
        action: () => router.push(`/?transcript=${p.slug}`),
      },
      {
        id: `project:filter:${p.slug}`,
        label: `Filter by: ${p.slug}`,
        description: `Show only ${p.slug} in Instance Grid`,
        icon: '⊞',
        category: 'project' as const,
        badge: { text: p.state, color: STATE_COLORS[p.state] },
        action: () => router.push(`/?filter=${p.slug}`),
      },
      {
        id: `project:inject:${p.slug}`,
        label: `Copy inject: ${p.slug}`,
        description: 'Copy inject command to clipboard',
        icon: '⟳',
        category: 'project' as const,
        badge: { text: p.state, color: STATE_COLORS[p.state] },
        action: () => {
          navigator.clipboard.writeText(`!project inject ${p.slug} `).catch(() => {})
        },
      },
    ])

    return [...navigate, ...projects]
  }

  const allCommands = buildCommands()

  const filtered = query
    ? allCommands.filter((c) => fuzzyMatch(query, c.label) || fuzzyMatch(query, c.description))
    : recent.length > 0
      ? recent
          .map((id) => allCommands.find((c) => c.id === id))
          .filter(Boolean) as Command[]
      : allCommands.slice(0, 6)

  useEffect(() => setSelected(0), [query])

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelected((s) => Math.min(s + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelected((s) => Math.max(s - 1, 0))
    } else if (e.key === 'Enter') {
      const cmd = filtered[selected]
      if (cmd) execute(cmd)
    }
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]"
      style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false) }}
    >
      <div
        className="w-full max-w-xl rounded-xl border border-cyber-cyan/20 overflow-hidden shadow-2xl"
        style={{
          background: '#0D1421',
          boxShadow: '0 0 40px rgba(0,245,255,0.12), 0 25px 50px rgba(0,0,0,0.6)',
        }}
      >
        {/* Input */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-white/8">
          <span className="text-slate-500 text-sm">⌘</span>
          <input
            ref={inputRef}
            type="text"
            placeholder={recent.length > 0 && !query ? 'Recent commands…' : 'Search commands and projects…'}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            className="flex-1 bg-transparent text-sm text-slate-200 placeholder-slate-600 focus:outline-none font-mono"
          />
          <kbd className="text-[0.6rem] text-slate-600 border border-slate-700 rounded px-1 py-0.5 font-mono">ESC</kbd>
        </div>

        {/* Results */}
        <div className="max-h-72 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-600 font-mono">No results for &ldquo;{query}&rdquo;</div>
          ) : (
            filtered.map((cmd, i) => (
              <button
                key={cmd.id}
                onClick={() => execute(cmd)}
                onMouseEnter={() => setSelected(i)}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors"
                style={{ background: i === selected ? 'rgba(0,245,255,0.06)' : 'transparent' }}
              >
                <span className="text-base w-5 text-center shrink-0" style={{ opacity: 0.7 }}>{cmd.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-slate-200 font-mono truncate">{cmd.label}</span>
                    {cmd.badge && (
                      <span
                        className="text-[0.55rem] font-mono font-bold uppercase tracking-wider px-1.5 py-0.5 rounded shrink-0"
                        style={{
                          color: cmd.badge.color,
                          border: `1px solid ${cmd.badge.color}40`,
                          background: `${cmd.badge.color}12`,
                        }}
                      >
                        {cmd.badge.text}
                      </span>
                    )}
                  </div>
                  <p className="text-[0.65rem] text-slate-500 truncate">{cmd.description}</p>
                </div>
                {i === selected && (
                  <kbd className="text-[0.6rem] text-slate-600 border border-slate-700 rounded px-1 py-0.5 font-mono shrink-0">↵</kbd>
                )}
              </button>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-3 px-4 py-2 border-t border-white/5 text-[0.58rem] text-slate-700 font-mono">
          <span>↑↓ navigate</span>
          <span>↵ select</span>
          <span>ESC close</span>
          <span className="flex-1" />
          {!query && recent.length > 0 && <span>recent</span>}
          {fleet && <span>{fleet.projects.length} projects</span>}
        </div>
      </div>
    </div>
  )
}
