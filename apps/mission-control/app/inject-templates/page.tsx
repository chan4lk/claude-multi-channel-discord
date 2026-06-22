'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import type { InjectTemplate, TemplateCategory } from '../api/inject-templates/route'
import type { ScheduleRow } from '../api/schedules/route'

const CATEGORIES: TemplateCategory[] = ['standup', 'review', 'report', 'custom']
const CAT_COLORS: Record<TemplateCategory, string> = {
  standup: '#4ADE80',
  review:  '#38BDF8',
  report:  '#A855F7',
  custom:  '#64748b',
}

const PLACEHOLDER_VARS = ['{{slug}}', '{{date}}', '{{time}}', '{{turnsToday}}', '{{contextPct}}']

function resolveVars(body: string, slug = ''): string {
  const now = new Date()
  return body
    .replace(/\{\{slug\}\}/g, slug || '<slug>')
    .replace(/\{\{date\}\}/g, now.toLocaleDateString())
    .replace(/\{\{time\}\}/g, now.toLocaleTimeString())
}

function fmtAge(iso: string | null): string {
  if (!iso) return '—'
  const diff = Date.now() - new Date(iso).getTime()
  const days = Math.floor(diff / 86400000)
  if (days > 0) return `${days}d ago`
  const hours = Math.floor(diff / 3600000)
  if (hours > 0) return `${hours}h ago`
  return 'just now'
}

interface FormState { name: string; body: string; category: TemplateCategory }
const EMPTY_FORM: FormState = { name: '', body: '', category: 'custom' }

export default function InjectTemplatesPage() {
  const [tab, setTab] = useState<'templates' | 'scheduled'>('templates')
  const [templates, setTemplates] = useState<InjectTemplate[]>([])
  const [schedules, setSchedules] = useState<ScheduleRow[]>([])
  const [loading, setLoading] = useState(true)
  const [catFilter, setCatFilter] = useState<TemplateCategory | 'all'>('all')
  const [editing, setEditing] = useState<string | null>(null) // template id or 'new'
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [previewSlug, setPreviewSlug] = useState('')
  const [search, setSearch] = useState('')

  const load = useCallback(async () => {
    const [tRes, sRes] = await Promise.all([
      fetch('/api/inject-templates'),
      fetch('/api/schedules'),
    ])
    const tData = await tRes.json() as { templates: InjectTemplate[] }
    const sData = await sRes.json() as ScheduleRow[]
    setTemplates(tData.templates ?? [])
    setSchedules((sData ?? []).filter((s) => s.type === 'inject'))
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  function startNew() {
    setEditing('new')
    setForm(EMPTY_FORM)
  }

  function startEdit(t: InjectTemplate) {
    setEditing(t.id)
    setForm({ name: t.name, body: t.body, category: t.category })
  }

  function cancelEdit() { setEditing(null); setForm(EMPTY_FORM) }

  async function save() {
    if (!form.name.trim() || !form.body.trim()) return
    setSaving(true)
    const body = {
      ...(editing !== 'new' ? { id: editing } : {}),
      name: form.name,
      body: form.body,
      category: form.category,
    }
    await fetch('/api/inject-templates', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    await load()
    setEditing(null)
    setSaving(false)
  }

  async function del(id: string) {
    await fetch(`/api/inject-templates?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
    await load()
    if (editing === id) { setEditing(null); setForm(EMPTY_FORM) }
  }

  const visible = templates
    .filter((t) => catFilter === 'all' || t.category === catFilter)
    .filter((t) => !search || t.name.toLowerCase().includes(search.toLowerCase()) || t.body.toLowerCase().includes(search.toLowerCase()))

  const topByUse = [...templates].sort((a, b) => b.useCount - a.useCount).slice(0, 5)

  if (loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center" style={{ background: '#060d1a' }}>
        <div className="text-xs font-mono text-slate-600 animate-pulse">Loading templates…</div>
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
            Inject Templates
          </h1>
          <span className="text-[0.55rem] font-mono text-slate-600 border border-slate-700 px-2 py-0.5 rounded">
            {templates.length} templates · {schedules.length} scheduled
          </span>
          <div className="flex gap-1 ml-2">
            {(['templates', 'scheduled'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className="text-[0.6rem] font-mono px-2 py-0.5 rounded border transition-colors capitalize"
                style={{
                  color: tab === t ? '#00F5FF' : '#64748b',
                  borderColor: tab === t ? 'rgba(0,245,255,0.3)' : '#374151',
                  background: tab === t ? 'rgba(0,245,255,0.08)' : 'transparent',
                }}
              >
                {t}
              </button>
            ))}
          </div>
          <div className="flex-1" />
          {tab === 'templates' && (
            <button
              onClick={startNew}
              className="text-[0.6rem] font-mono font-bold px-3 py-1 rounded uppercase tracking-wider transition-all"
              style={{ background: 'rgba(0,245,255,0.12)', color: '#00F5FF', border: '1px solid rgba(0,245,255,0.3)' }}
            >
              + New Template
            </button>
          )}
        </div>
      </header>

      <main className="flex-1 p-6 max-w-6xl mx-auto w-full">
        {tab === 'templates' ? (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left: template list */}
            <div className="lg:col-span-2 flex flex-col gap-4">
              {/* Filters */}
              <div className="flex gap-2 flex-wrap items-center">
                <button
                  onClick={() => setCatFilter('all')}
                  className="text-[0.6rem] font-mono px-2 py-0.5 rounded border transition-colors"
                  style={{ color: catFilter === 'all' ? '#00F5FF' : '#64748b', borderColor: catFilter === 'all' ? 'rgba(0,245,255,0.3)' : '#374151' }}
                >
                  All ({templates.length})
                </button>
                {CATEGORIES.map((c) => {
                  const count = templates.filter((t) => t.category === c).length
                  return (
                    <button
                      key={c}
                      onClick={() => setCatFilter(c)}
                      className="text-[0.6rem] font-mono px-2 py-0.5 rounded border transition-colors capitalize"
                      style={{ color: catFilter === c ? CAT_COLORS[c] : '#64748b', borderColor: catFilter === c ? `${CAT_COLORS[c]}50` : '#374151' }}
                    >
                      {c} ({count})
                    </button>
                  )
                })}
                <input
                  className="text-[0.6rem] font-mono bg-transparent border border-slate-700 rounded px-2 py-0.5 text-slate-300 placeholder-slate-700 outline-none focus:border-cyber-cyan/40 ml-auto w-36"
                  placeholder="Search…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>

              {/* Template cards */}
              {visible.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 gap-3">
                  <div className="text-4xl opacity-15">◎</div>
                  <p className="text-xs font-mono text-slate-500">No templates yet</p>
                  <button onClick={startNew} className="text-[0.6rem] font-mono text-cyber-cyan hover:underline">Create first template →</button>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {visible.map((t) => (
                    <div
                      key={t.id}
                      className="rounded-lg border p-4 group transition-colors"
                      style={{
                        borderColor: editing === t.id ? 'rgba(0,245,255,0.3)' : 'rgba(0,245,255,0.08)',
                        background: editing === t.id ? 'rgba(0,245,255,0.04)' : 'rgba(0,245,255,0.015)',
                      }}
                    >
                      <div className="flex items-start justify-between gap-2 mb-1.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-mono font-bold text-slate-200">{t.name}</span>
                          <span
                            className="text-[0.5rem] font-mono px-1 py-0.5 rounded capitalize"
                            style={{ color: CAT_COLORS[t.category], background: `${CAT_COLORS[t.category]}15` }}
                          >
                            {t.category}
                          </span>
                          {t.useCount > 0 && (
                            <span className="text-[0.5rem] font-mono text-slate-600">
                              used {t.useCount}× · last {fmtAge(t.lastUsed)}
                            </span>
                          )}
                        </div>
                        <div className="flex gap-2 flex-shrink-0">
                          <button
                            onClick={() => startEdit(t)}
                            className="text-[0.55rem] font-mono text-slate-500 hover:text-cyber-cyan transition-colors opacity-0 group-hover:opacity-100"
                          >
                            ✎ Edit
                          </button>
                          <button
                            onClick={() => del(t.id)}
                            className="text-[0.55rem] font-mono text-slate-500 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                      <pre className="text-[0.6rem] font-mono text-slate-500 whitespace-pre-wrap line-clamp-3 leading-relaxed">{t.body}</pre>
                      {PLACEHOLDER_VARS.some((v) => t.body.includes(v)) && (
                        <p className="text-[0.45rem] font-mono text-slate-700 mt-1">
                          Variables: {PLACEHOLDER_VARS.filter((v) => t.body.includes(v)).join(' · ')}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Right: edit form + leaderboard */}
            <div className="flex flex-col gap-4">
              {editing ? (
                <div className="rounded-lg border border-cyber-cyan/20 p-4" style={{ background: 'rgba(0,245,255,0.03)' }}>
                  <p className="text-[0.6rem] font-mono text-cyber-cyan uppercase tracking-wider mb-3">
                    {editing === 'new' ? '+ New Template' : '✎ Edit Template'}
                  </p>
                  <div className="flex flex-col gap-2">
                    <input
                      className="text-[0.65rem] font-mono bg-transparent border border-slate-700 rounded px-2 py-1.5 text-slate-200 placeholder-slate-600 outline-none focus:border-cyber-cyan/40 w-full"
                      placeholder="Template name…"
                      value={form.name}
                      onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                      maxLength={40}
                    />

                    <div className="flex gap-1.5 flex-wrap">
                      {CATEGORIES.map((c) => (
                        <button
                          key={c}
                          onClick={() => setForm((f) => ({ ...f, category: c }))}
                          className="text-[0.55rem] font-mono px-1.5 py-0.5 rounded capitalize border transition-colors"
                          style={{
                            color: form.category === c ? CAT_COLORS[c] : '#64748b',
                            borderColor: form.category === c ? `${CAT_COLORS[c]}50` : '#374151',
                          }}
                        >
                          {c}
                        </button>
                      ))}
                    </div>

                    <textarea
                      className="text-[0.65rem] font-mono bg-transparent border border-slate-700 rounded px-2 py-1.5 text-slate-300 placeholder-slate-600 outline-none focus:border-cyber-cyan/40 w-full resize-y"
                      placeholder={`Template body…\nUse {{slug}}, {{date}}, {{time}}, {{turnsToday}}, {{contextPct}}`}
                      rows={6}
                      value={form.body}
                      onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
                      maxLength={4000}
                    />

                    {form.body && (
                      <div className="rounded border border-white/5 p-2" style={{ background: '#020810' }}>
                        <div className="flex items-center gap-1.5 mb-1">
                          <p className="text-[0.45rem] font-mono text-slate-600 uppercase tracking-wider">Preview</p>
                          <input
                            className="text-[0.5rem] font-mono bg-transparent border border-slate-700 rounded px-1 py-0.5 text-slate-500 outline-none w-20"
                            placeholder="slug…"
                            value={previewSlug}
                            onChange={(e) => setPreviewSlug(e.target.value)}
                          />
                        </div>
                        <pre className="text-[0.6rem] font-mono text-slate-400 whitespace-pre-wrap">{resolveVars(form.body, previewSlug)}</pre>
                      </div>
                    )}

                    <div className="flex gap-2 mt-1">
                      <button
                        onClick={save}
                        disabled={saving || !form.name.trim() || !form.body.trim()}
                        className="text-[0.6rem] font-mono px-2 py-1 rounded border border-cyber-cyan/30 text-cyber-cyan disabled:opacity-40 transition-colors hover:bg-cyber-cyan/10"
                      >
                        {saving ? '…' : 'Save'}
                      </button>
                      <button onClick={cancelEdit} className="text-[0.6rem] font-mono px-2 py-1 rounded border border-slate-700 text-slate-500 hover:text-slate-300 transition-colors">
                        Cancel
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <button
                  onClick={startNew}
                  className="rounded-lg border border-dashed border-cyber-cyan/20 p-6 text-center hover:border-cyber-cyan/40 transition-colors"
                  style={{ background: 'rgba(0,245,255,0.01)' }}
                >
                  <p className="text-[0.6rem] font-mono text-slate-600 hover:text-cyber-cyan transition-colors">+ Create template</p>
                </button>
              )}

              {topByUse.length > 0 && (
                <div className="rounded-lg border border-cyber-cyan/12 p-4" style={{ background: 'rgba(0,245,255,0.02)' }}>
                  <p className="text-[0.55rem] font-mono text-slate-500 uppercase tracking-wider mb-3">Most Used</p>
                  <div className="flex flex-col gap-1.5">
                    {topByUse.map((t, i) => (
                      <div key={t.id} className="flex items-center gap-2">
                        <span className="text-[0.5rem] font-mono text-slate-700 w-3">{i + 1}</span>
                        <span className="text-[0.6rem] font-mono text-slate-400 flex-1 truncate">{t.name}</span>
                        <span className="text-[0.55rem] font-mono" style={{ color: CAT_COLORS[t.category] }}>{t.useCount}×</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          /* Scheduled tab */
          <ScheduledInjectsTab schedules={schedules} />
        )}
      </main>
    </div>
  )
}

function ScheduledInjectsTab({ schedules }: { schedules: ScheduleRow[] }) {
  if (schedules.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4">
        <div className="text-5xl opacity-10">⏰</div>
        <p className="text-xs font-mono text-slate-500">No scheduled injects configured</p>
        <p className="text-[0.6rem] font-mono text-slate-600 max-w-sm text-center">
          Use <code className="text-cyber-cyan/70">!project schedule inject --slug &lt;slug&gt; HH:MM &quot;&lt;template&gt;&quot;</code> to schedule a daily inject
        </p>
        <p className="text-[0.55rem] font-mono text-slate-700">
          Vars: {'{{slug}}'} · {'{{date}}'} · {'{{time}}'} · {'{{turnsToday}}'} · {'{{contextPct}}'}
        </p>
      </div>
    )
  }

  const bySlug = new Map<string, ScheduleRow[]>()
  for (const s of schedules) {
    const group = bySlug.get(s.slug) ?? []
    group.push(s)
    bySlug.set(s.slug, group)
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <p className="text-[0.6rem] font-mono text-slate-500">
          {schedules.length} scheduled inject{schedules.length !== 1 ? 's' : ''} across {bySlug.size} project{bySlug.size !== 1 ? 's' : ''}
        </p>
        <p className="text-[0.55rem] font-mono text-slate-700">Add via <code className="text-slate-500">!project schedule inject</code></p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {schedules.map((s) => (
          <div
            key={s.id}
            className="rounded-lg border p-4 flex flex-col gap-2"
            style={{
              borderColor: s.enabled ? 'rgba(0,245,255,0.12)' : 'rgba(100,116,139,0.2)',
              background: s.enabled ? 'rgba(0,245,255,0.02)' : 'rgba(0,0,0,0.15)',
            }}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span
                  className="text-[0.5rem] font-mono px-1 py-0.5 rounded"
                  style={{
                    color: s.enabled ? '#10B981' : '#64748b',
                    background: s.enabled ? 'rgba(16,185,129,0.1)' : 'rgba(100,116,139,0.1)',
                  }}
                >
                  {s.enabled ? '● active' : '○ paused'}
                </span>
                <span className="text-[0.6rem] font-mono font-bold text-slate-200">{s.slug}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[0.65rem] font-mono text-cyber-cyan/80">{s.at || s.interval}</span>
                <span className="text-[0.5rem] font-mono text-slate-700">{s.id}</span>
              </div>
            </div>

            <pre
              className="text-[0.6rem] font-mono text-slate-500 whitespace-pre-wrap line-clamp-3 leading-relaxed rounded p-2"
              style={{ background: 'rgba(0,0,0,0.3)' }}
            >
              {s.prompt}
            </pre>

            <div className="flex items-center justify-between text-[0.5rem] font-mono text-slate-700">
              <span>fired {s.runCount}×{s.maxRuns ? ` / ${s.maxRuns}` : ''}</span>
              <span>last: {fmtAge(s.lastRunAt)}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-amber-500/20 p-4" style={{ background: 'rgba(245,158,11,0.04)' }}>
        <p className="text-[0.6rem] font-mono text-amber-400/80 mb-1">Manage via Discord</p>
        <p className="text-[0.55rem] font-mono text-slate-600">
          Use <code className="text-slate-400">!project schedule pause &lt;id&gt;</code> / <code className="text-slate-400">resume &lt;id&gt;</code> / <code className="text-slate-400">rm &lt;id&gt;</code> to control schedules.
          Toggle and delete from MC UI is planned.
        </p>
      </div>
    </div>
  )
}
