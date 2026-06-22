'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import type { TurnAnnotationRow, TurnAnnotationTag } from '../api/annotations/route'

const TAG_COLORS: Record<TurnAnnotationTag, string> = {
  note:    '#22D3EE',
  warning: '#F59E0B',
  bug:     '#EF4444',
}

const TAG_ICONS: Record<TurnAnnotationTag, string> = {
  note:    '📝',
  warning: '⚠️',
  bug:     '🐛',
}

function fmtDate(unix: number): string {
  return new Date(unix * 1000).toLocaleString()
}

export default function AnnotationsPage() {
  const router = useRouter()
  const [annotations, setAnnotations] = useState<TurnAnnotationRow[]>([])
  const [loading, setLoading] = useState(true)
  const [slugFilter, setSlugFilter] = useState('')
  const [tagFilter, setTagFilter] = useState<TurnAnnotationTag | 'all'>('all')
  const [slugs, setSlugs] = useState<string[]>([])

  const load = useCallback(async () => {
    const params = new URLSearchParams()
    if (tagFilter !== 'all') params.set('tag', tagFilter)
    const r = await fetch(`/api/annotations?${params}`)
    const d = await r.json() as { annotations: TurnAnnotationRow[] }
    const rows = d.annotations ?? []
    setAnnotations(rows)
    const uniqueSlugs = [...new Set(rows.map((a) => a.slug))].sort()
    setSlugs(uniqueSlugs)
    setLoading(false)
  }, [tagFilter])

  useEffect(() => { setLoading(true); load() }, [load])

  function openReplay(a: TurnAnnotationRow) {
    const params = new URLSearchParams()
    params.set('project', a.slug)
    params.set('turn', String(a.turn_index))
    router.push(`/replay?${params}`)
  }

  async function deleteAnnotation(id: number) {
    await fetch(`/api/annotations?id=${id}`, { method: 'DELETE' })
    setAnnotations((prev) => prev.filter((a) => a.id !== id))
  }

  const visible = annotations.filter((a) => {
    if (slugFilter && a.slug !== slugFilter) return false
    return true
  })

  return (
    <div className="min-h-dvh flex flex-col" style={{ background: '#060d1a' }}>
      <header className="sticky top-0 z-30 border-b border-cyber-cyan/12 bg-[#060d1a]/90 backdrop-blur-md px-4 py-2.5">
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-cyber-cyan/40 to-transparent" />
        <div className="flex items-center gap-3 flex-wrap">
          <Link href="/" className="text-[0.6rem] font-mono text-slate-500 hover:text-cyber-cyan transition-colors uppercase tracking-wider">
            ← Mission Control
          </Link>
          <span className="text-[0.65rem] font-mono font-bold text-cyber-cyan uppercase tracking-widest">Turn Annotations</span>
          <span className="text-[0.55rem] font-mono text-slate-600 border border-slate-700 px-1.5 py-0.5 rounded">
            {visible.length} annotations
          </span>
          <div className="flex-1" />
          <Link href="/replay" className="text-[0.6rem] font-mono text-slate-500 hover:text-cyber-cyan transition-colors border border-slate-700 hover:border-cyber-cyan/30 px-2 py-0.5 rounded">
            ⏮ Replay
          </Link>
        </div>
      </header>

      <main className="flex-1 p-4 max-w-4xl mx-auto w-full">
        {/* filters */}
        <div className="flex items-center gap-2 flex-wrap mb-4">
          {/* tag filter */}
          <button
            onClick={() => setTagFilter('all')}
            className="text-[0.6rem] font-mono px-2 py-0.5 rounded border transition-colors"
            style={{
              borderColor: tagFilter === 'all' ? 'rgba(0,245,255,0.4)' : '#374151',
              color: tagFilter === 'all' ? '#00F5FF' : '#64748b',
              background: tagFilter === 'all' ? 'rgba(0,245,255,0.08)' : 'transparent',
            }}
          >
            all tags
          </button>
          {(['note', 'warning', 'bug'] as TurnAnnotationTag[]).map((tag) => (
            <button
              key={tag}
              onClick={() => setTagFilter(tag)}
              className="text-[0.6rem] font-mono px-2 py-0.5 rounded border transition-colors"
              style={{
                borderColor: tagFilter === tag ? `${TAG_COLORS[tag]}60` : '#374151',
                color: tagFilter === tag ? TAG_COLORS[tag] : '#64748b',
                background: tagFilter === tag ? `${TAG_COLORS[tag]}10` : 'transparent',
              }}
            >
              {TAG_ICONS[tag]} {tag}
            </button>
          ))}

          {/* slug filter */}
          {slugs.length > 0 && (
            <select
              value={slugFilter}
              onChange={(e) => setSlugFilter(e.target.value)}
              className="ml-auto text-[0.6rem] font-mono bg-slate-900 border border-slate-700 rounded px-2 py-0.5 text-slate-300 focus:outline-none"
            >
              <option value="">All projects</option>
              {slugs.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          )}
        </div>

        {loading ? (
          <div className="text-center py-12 text-[0.6rem] font-mono text-slate-600 animate-pulse">Loading…</div>
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center py-16 gap-3">
            <div className="text-4xl opacity-20">🏷</div>
            <p className="text-xs font-mono text-slate-500">No annotations yet</p>
            <p className="text-[0.6rem] font-mono text-slate-700">Add annotations in Session Replay by clicking the 🏷 icon on turns.</p>
            <Link href="/replay" className="mt-2 text-[0.6rem] font-mono text-cyber-cyan hover:underline">
              Go to Replay →
            </Link>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {visible.map((a) => {
              const tagColor = TAG_COLORS[a.tag as TurnAnnotationTag] ?? '#64748b'
              return (
                <div
                  key={a.id}
                  className="rounded-lg border transition-colors group"
                  style={{ borderColor: `${tagColor}25`, background: `${tagColor}04` }}
                >
                  <div className="flex items-start gap-3 px-4 py-3">
                    <span
                      className="text-[0.55rem] font-mono px-1.5 py-0.5 rounded shrink-0 mt-0.5"
                      style={{ background: `${tagColor}15`, color: tagColor, border: `1px solid ${tagColor}30` }}
                    >
                      {TAG_ICONS[a.tag as TurnAnnotationTag]} {a.tag}
                    </span>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[0.65rem] font-mono text-slate-200">{a.note || '(no note)'}</span>
                      </div>
                      <div className="flex items-center gap-3 mt-1 flex-wrap">
                        <span className="text-[0.55rem] font-mono text-slate-500">{a.slug}</span>
                        <span className="text-[0.55rem] font-mono text-slate-700">T{a.turn_index + 1}</span>
                        {a.session_file && (
                          <span className="text-[0.5rem] font-mono text-slate-700 truncate max-w-32">{a.session_file.split('/').pop()}</span>
                        )}
                        <span className="text-[0.5rem] font-mono text-slate-700">{fmtDate(a.created_at)}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => openReplay(a)}
                        className="text-[0.55rem] font-mono px-1.5 py-0.5 rounded border border-slate-700 text-slate-500 hover:text-cyber-cyan hover:border-cyber-cyan/30 transition-colors"
                        title="Open in Replay"
                      >
                        ⏮ replay
                      </button>
                      <button
                        onClick={() => deleteAnnotation(a.id)}
                        className="text-[0.55rem] font-mono px-1.5 py-0.5 rounded border border-slate-700 text-slate-500 hover:text-red-400 hover:border-red-500/30 transition-colors"
                        title="Delete annotation"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </main>
    </div>
  )
}
