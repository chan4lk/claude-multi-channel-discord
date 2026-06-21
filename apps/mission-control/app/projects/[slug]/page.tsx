'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import type { TimelineEntry, TimelineResponse } from '../../api/projects/[slug]/timeline/route'

// ─── Timeline ────────────────────────────────────────────────────────────────

const EVENT_ICON: Record<string, string> = {
  spawn:          '🟢',
  kill:           '🔴',
  crash:          '💥',
  stuck:          '⚠️',
  'budget-alert': '🔶',
  'scheduler-fire': '📅',
  distillation:   '💭',
  reply:          '💬',
  audit:          '📋',
  other:          '⬡',
}

const EVENT_COLOR: Record<string, string> = {
  spawn:          '#4ADE80',
  kill:           '#EF4444',
  crash:          '#EF4444',
  stuck:          '#F59E0B',
  'budget-alert': '#F97316',
  'scheduler-fire': '#FCD34D',
  distillation:   '#A855F7',
  reply:          '#00F5FF',
  audit:          '#64748b',
  other:          '#334155',
}

function formatTs(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function EventLabel({ entry }: { entry: TimelineEntry }): React.ReactNode {
  const color = EVENT_COLOR[entry.eventType] ?? '#334155'
  const label = entry.auditVerb
    ? `${entry.auditVerb}${entry.auditActor ? ` by ${entry.auditActor}` : ''}`
    : entry.rawType.replace(/_/g, ' ')
  return (
    <span className="text-xs font-mono font-semibold" style={{ color }}>
      {label}
    </span>
  )
}

function TimelineItem({ entry }: { entry: TimelineEntry }) {
  const [expanded, setExpanded] = useState(false)
  const color = EVENT_COLOR[entry.eventType] ?? '#334155'
  const icon = EVENT_ICON[entry.eventType] ?? '⬡'
  const isReply = entry.eventType === 'reply'

  return (
    <div className="flex gap-3 group">
      <div className="flex flex-col items-center" style={{ minWidth: 32 }}>
        <div
          className="w-7 h-7 rounded-full flex items-center justify-center text-sm shrink-0 border"
          style={{ background: `${color}15`, borderColor: `${color}40` }}
        >
          {icon}
        </div>
        <div className="flex-1 w-px mt-1" style={{ background: `${color}20`, minHeight: 12 }} />
      </div>

      <div className="flex-1 pb-4 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <EventLabel entry={entry} />
          <span className="text-[0.6rem] font-mono text-slate-600">{formatTs(entry.ts)}</span>
          {isReply && entry.snippet && (
            <button
              onClick={() => setExpanded((x) => !x)}
              className="text-[0.6rem] font-mono text-cyber-cyan/50 hover:text-cyber-cyan transition-colors"
            >
              {expanded ? '▲ collapse' : '▼ expand'}
            </button>
          )}
        </div>

        {isReply && expanded && entry.snippet && (
          <div
            className="mt-2 p-2 rounded text-[0.65rem] font-mono text-slate-300 whitespace-pre-wrap"
            style={{ background: '#0d1a2e', border: '1px solid #1e3a5f', maxWidth: 600 }}
          >
            {entry.snippet}
          </div>
        )}

        {!isReply && entry.payload && (() => {
          const p = entry.payload as Record<string, unknown>
          const detail = p.reason ?? p.threshold ?? p.detail ?? p.message
          if (!detail) return null
          return (
            <div className="text-[0.6rem] font-mono text-slate-600 mt-0.5 truncate max-w-md">
              {String(detail).slice(0, 120)}
            </div>
          )
        })()}
      </div>
    </div>
  )
}

function TimelineTab({ slug }: { slug: string }) {
  const [entries, setEntries] = useState<TimelineEntry[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)

  const load = useCallback(async (cur?: string | null) => {
    if (!slug) return
    const url = `/api/projects/${encodeURIComponent(slug)}/timeline${cur ? `?cursor=${encodeURIComponent(cur)}` : ''}`
    const res = await fetch(url)
    if (!res.ok) return
    return await res.json() as TimelineResponse
  }, [slug])

  useEffect(() => {
    setLoading(true)
    load().then((data) => {
      if (!data) return
      setEntries(data.entries)
      setCursor(data.nextCursor)
      setHasMore(data.nextCursor !== null)
      setLoading(false)
    })
  }, [load])

  const loadMore = async () => {
    if (!cursor || loadingMore) return
    setLoadingMore(true)
    const data = await load(cursor)
    if (data) {
      setEntries((prev) => [...prev, ...data.entries])
      setCursor(data.nextCursor)
      setHasMore(data.nextCursor !== null)
    }
    setLoadingMore(false)
  }

  if (loading) return (
    <div className="flex items-center justify-center h-64 text-slate-600 font-mono text-xs animate-pulse">
      Loading timeline…
    </div>
  )

  if (entries.length === 0) return (
    <div className="flex flex-col items-center justify-center h-64 gap-2 text-slate-700">
      <div className="text-4xl opacity-20">⬡</div>
      <span className="text-xs font-mono">No events recorded for {slug}</span>
    </div>
  )

  return (
    <>
      <div className="flex flex-col">
        {entries.map((entry) => (
          <TimelineItem key={entry.id} entry={entry} />
        ))}
      </div>

      {hasMore && (
        <div className="flex justify-center pt-2 pb-8">
          <button
            onClick={loadMore}
            disabled={loadingMore}
            className="text-xs font-mono px-4 py-2 rounded transition-colors disabled:opacity-40"
            style={{ color: '#00F5FF', background: '#00F5FF10', border: '1px solid #00F5FF30' }}
          >
            {loadingMore ? 'Loading…' : 'Load older'}
          </button>
        </div>
      )}
    </>
  )
}

// ─── Diff ─────────────────────────────────────────────────────────────────────

interface CommitEntry {
  sha: string
  shortSha: string
  message: string
  author: string
  date: string
  dateTs: number
}

interface DiffFile {
  header: string
  lines: string[]
  path: string
}

function parseDiffFiles(patch: string): DiffFile[] {
  if (!patch) return []
  const files: DiffFile[] = []
  let current: DiffFile | null = null

  for (const line of patch.split('\n')) {
    if (line.startsWith('diff --git ')) {
      if (current) files.push(current)
      const match = line.match(/b\/(.+)$/)
      current = { header: line, lines: [line], path: match?.[1] ?? line }
    } else if (current) {
      current.lines.push(line)
    }
  }
  if (current) files.push(current)
  return files
}

function DiffFileBlock({ file }: { file: DiffFile }) {
  const [open, setOpen] = useState(false)
  let added = 0, removed = 0
  for (const l of file.lines) {
    if (l.startsWith('+') && !l.startsWith('+++')) added++
    if (l.startsWith('-') && !l.startsWith('---')) removed++
  }

  return (
    <div className="rounded border mb-2 overflow-hidden" style={{ borderColor: '#1e3a5f' }}>
      <button
        onClick={() => setOpen((x) => !x)}
        className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-white/3 transition-colors"
        style={{ background: '#080f1c' }}
      >
        <span className="text-[0.6rem] font-mono" style={{ color: '#4ADE80' }}>+{added}</span>
        <span className="text-[0.6rem] font-mono" style={{ color: '#EF4444' }}>−{removed}</span>
        <span className="text-xs font-mono text-slate-300 truncate flex-1">{file.path}</span>
        <span className="text-[0.6rem] font-mono text-slate-600">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="overflow-x-auto" style={{ background: '#040a14' }}>
          <pre className="text-[0.6rem] font-mono leading-relaxed p-3 min-w-0">
            {file.lines.map((line, i) => {
              let color = '#64748b'
              if (line.startsWith('+++') || line.startsWith('---')) color = '#94a3b8'
              else if (line.startsWith('+')) color = '#4ADE80'
              else if (line.startsWith('-')) color = '#EF4444'
              else if (line.startsWith('@@')) color = '#60A5FA'
              else if (line.startsWith('diff') || line.startsWith('index')) color = '#475569'
              return (
                <span key={i} style={{ color, display: 'block', whiteSpace: 'pre' }}>
                  {line || ' '}
                </span>
              )
            })}
          </pre>
        </div>
      )}
    </div>
  )
}

function DiffTab({ slug }: { slug: string }) {
  const [commits, setCommits] = useState<CommitEntry[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [patch, setPatch] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [diffLoading, setDiffLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!slug) return
    setLoading(true)
    fetch(`/api/projects/${encodeURIComponent(slug)}/diff`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) { setError(data.error); setLoading(false); return }
        setCommits(data.commits ?? [])
        setLoading(false)
      })
      .catch(() => { setError('Failed to load commits'); setLoading(false) })
  }, [slug])

  const loadDiff = useCallback(async (sha: string) => {
    setSelected(sha)
    setDiffLoading(true)
    setPatch('')
    try {
      const r = await fetch(`/api/projects/${encodeURIComponent(slug)}/diff?commit=${encodeURIComponent(sha)}`)
      const data = await r.json()
      setPatch(data.patch ?? '')
    } catch {
      setPatch('')
    }
    setDiffLoading(false)
  }, [slug])

  if (loading) return (
    <div className="flex items-center justify-center h-64 text-slate-600 font-mono text-xs animate-pulse">
      Loading commits…
    </div>
  )

  if (error) return (
    <div className="flex flex-col items-center justify-center h-64 gap-2 text-slate-600">
      <div className="text-4xl opacity-20">⑂</div>
      <span className="text-xs font-mono">{error}</span>
    </div>
  )

  if (commits.length === 0) return (
    <div className="flex flex-col items-center justify-center h-64 gap-2 text-slate-700">
      <div className="text-4xl opacity-20">⑂</div>
      <span className="text-xs font-mono">No commits yet for {slug}</span>
    </div>
  )

  const diffFiles = parseDiffFiles(patch)

  return (
    <div className="flex gap-4 min-h-0 flex-col md:flex-row">
      {/* Commit list */}
      <div className="md:w-72 shrink-0 flex flex-col gap-1">
        <div className="text-[0.55rem] font-mono uppercase tracking-widest text-slate-600 mb-2">
          Commits (last {commits.length})
        </div>
        {commits.map((c) => (
          <button
            key={c.sha}
            onClick={() => loadDiff(c.sha)}
            className="text-left px-3 py-2 rounded border transition-all"
            style={{
              background: selected === c.sha ? '#00F5FF10' : 'transparent',
              borderColor: selected === c.sha ? '#00F5FF40' : '#1e3a5f',
            }}
          >
            <div className="flex items-center gap-2">
              <span className="text-[0.6rem] font-mono" style={{ color: '#F59E0B' }}>{c.shortSha}</span>
              <span className="text-[0.6rem] font-mono text-slate-500 truncate flex-1">{c.message}</span>
            </div>
            <div className="text-[0.55rem] font-mono text-slate-700 mt-0.5">
              {c.author} · {c.date ? new Date(c.date).toLocaleDateString() : ''}
            </div>
          </button>
        ))}
      </div>

      {/* Diff panel */}
      <div className="flex-1 min-w-0">
        {!selected && (
          <div className="flex items-center justify-center h-48 text-slate-700 text-xs font-mono">
            ← Select a commit to view diff
          </div>
        )}
        {selected && diffLoading && (
          <div className="flex items-center justify-center h-48 text-slate-600 font-mono text-xs animate-pulse">
            Loading diff…
          </div>
        )}
        {selected && !diffLoading && diffFiles.length === 0 && patch === '' && (
          <div className="flex items-center justify-center h-48 text-slate-700 text-xs font-mono">
            No diff for this commit
          </div>
        )}
        {selected && !diffLoading && diffFiles.length === 0 && patch !== '' && (
          <pre className="text-[0.6rem] font-mono text-slate-500 whitespace-pre-wrap break-all p-3"
            style={{ background: '#040a14', borderRadius: 6, border: '1px solid #1e3a5f' }}>
            {patch}
          </pre>
        )}
        {selected && !diffLoading && diffFiles.length > 0 && (
          <div>
            <div className="text-[0.55rem] font-mono uppercase tracking-widest text-slate-600 mb-2">
              {diffFiles.length} file{diffFiles.length !== 1 ? 's' : ''} changed — click to expand
            </div>
            {diffFiles.map((f, i) => <DiffFileBlock key={i} file={f} />)}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

type Tab = 'timeline' | 'diff'

export default function ProjectTimelinePage() {
  const params = useParams()
  const slug = typeof params?.slug === 'string' ? params.slug : (params?.slug as string[])?.[0] ?? ''
  const [tab, setTab] = useState<Tab>('timeline')

  const TAB_STYLE = (active: boolean) => ({
    color: active ? '#00F5FF' : '#64748b',
    background: active ? '#00F5FF10' : 'transparent',
    borderBottom: active ? '2px solid #00F5FF' : '2px solid transparent',
  })

  return (
    <div className="min-h-dvh flex flex-col" style={{ background: '#060d1a' }}>
      <header className="relative border-b border-cyber-cyan/12 bg-cyber-surface/70 backdrop-blur-md px-6 py-3">
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-cyber-cyan/40 to-transparent" />
        <div className="flex items-center gap-4 flex-wrap">
          <Link href="/" className="text-[0.6rem] font-mono text-slate-500 hover:text-cyber-cyan transition-colors uppercase tracking-wider">
            ← Dashboard
          </Link>
          <span className="text-slate-700 font-mono">·</span>
          <h1 className="text-lg font-black tracking-[0.18em] text-cyber-cyan" style={{ fontFamily: 'Orbitron, JetBrains Mono, monospace' }}>
            PROJECT
          </h1>
          <span
            className="text-xs font-mono px-2 py-0.5 rounded"
            style={{ color: '#00F5FF', background: '#00F5FF15', border: '1px solid #00F5FF30' }}
          >
            {slug}
          </span>

          {/* Tabs */}
          <div className="flex gap-1 ml-4">
            {(['timeline', 'diff'] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className="text-[0.65rem] font-mono px-3 py-1 capitalize transition-colors"
                style={TAB_STYLE(tab === t)}
              >
                {t === 'timeline' ? '◫ Timeline' : '⑂ Diff'}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="flex-1 px-6 py-6 max-w-5xl mx-auto w-full">
        {tab === 'timeline' && <TimelineTab slug={slug} />}
        {tab === 'diff' && <DiffTab slug={slug} />}
      </main>

      {tab === 'timeline' && (
        <footer className="border-t border-slate-800 px-6 py-4">
          <div className="flex flex-wrap gap-3">
            {Object.entries(EVENT_ICON).filter(([k]) => k !== 'other').map(([type, icon]) => (
              <div key={type} className="flex items-center gap-1">
                <span className="text-xs">{icon}</span>
                <span className="text-[0.55rem] font-mono" style={{ color: EVENT_COLOR[type], opacity: 0.7 }}>
                  {type.replace(/-/g, ' ')}
                </span>
              </div>
            ))}
          </div>
        </footer>
      )}
    </div>
  )
}
