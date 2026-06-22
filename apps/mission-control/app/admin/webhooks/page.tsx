'use client'

import { useCallback, useEffect, useState } from 'react'
import GlassCard from '@/components/ui/GlassCard'

interface WebhookRow {
  id: number
  name: string
  url: string
  event_filter: string
  use_slack_format: number
  enabled: number
  created_at: number
}

interface DeliveryRow {
  id: number
  ts: number
  event_type: string
  slug: string
  status: string
  response_code: number | null
  error: string | null
}

const EVENT_OPTIONS = ['all', 'stall', 'budget', 'circuit-open', 'watchdog'] as const
const STATUS_COLORS: Record<string, string> = {
  success: 'text-emerald-400',
  error: 'text-red-400',
  timeout: 'text-amber-400',
  pending: 'text-slate-400',
}

function formatTs(ts: number): string {
  return new Date(ts * 1000).toISOString().replace('T', ' ').slice(0, 19)
}

function maskUrl(url: string): string {
  try {
    const u = new URL(url)
    return `${u.protocol}//${u.host}/…`
  } catch {
    return url.slice(0, 30) + (url.length > 30 ? '…' : '')
  }
}

export default function WebhooksPage() {
  const [webhooks, setWebhooks] = useState<WebhookRow[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [deliveries, setDeliveries] = useState<Record<number, DeliveryRow[]>>({})
  const [testStatus, setTestStatus] = useState<Record<number, string>>({})
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({ name: '', url: '', event_filter: 'all', use_slack_format: false })
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/webhooks')
      const d = await r.json() as { webhooks: WebhookRow[] }
      setWebhooks(d.webhooks)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function loadDeliveries(id: number) {
    const r = await fetch(`/api/webhooks/${id}/deliveries`)
    const d = await r.json() as { deliveries: DeliveryRow[] }
    setDeliveries((prev) => ({ ...prev, [id]: d.deliveries }))
  }

  function toggleExpand(id: number) {
    if (expandedId === id) {
      setExpandedId(null)
    } else {
      setExpandedId(id)
      loadDeliveries(id)
    }
  }

  async function handleTest(id: number) {
    setTestStatus((p) => ({ ...p, [id]: 'testing…' }))
    const r = await fetch(`/api/webhooks/${id}/test`, { method: 'POST' })
    const d = await r.json() as { status: string; responseCode: number | null }
    setTestStatus((p) => ({ ...p, [id]: d.status === 'success' ? `✓ ${d.responseCode}` : `✗ ${d.responseCode ?? d.status}` }))
    if (expandedId === id) loadDeliveries(id)
  }

  async function handleToggle(hook: WebhookRow) {
    await fetch(`/api/webhooks/${hook.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !hook.enabled }),
    })
    load()
  }

  async function handleDelete(id: number) {
    if (!confirm('Delete this webhook?')) return
    await fetch(`/api/webhooks/${id}`, { method: 'DELETE' })
    if (expandedId === id) setExpandedId(null)
    load()
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      await fetch('/api/webhooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      setForm({ name: '', url: '', event_filter: 'all', use_slack_format: false })
      setShowAdd(false)
      load()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen p-6" style={{ background: 'rgba(4,10,20,0.95)' }}>
      <div className="max-w-3xl mx-auto space-y-4">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-lg font-mono font-semibold" style={{ color: '#00F5FF' }}>
              Outbound Webhooks
            </h1>
            <p className="text-[0.7rem] font-mono mt-0.5" style={{ color: '#475569' }}>
              POST alerts to external URLs on fleet events
            </p>
          </div>
          <button
            onClick={() => setShowAdd((s) => !s)}
            className="px-3 py-1.5 rounded font-mono text-[0.7rem] border transition-colors"
            style={{
              background: showAdd ? 'rgba(0,245,255,0.1)' : 'transparent',
              borderColor: 'rgba(0,245,255,0.3)',
              color: '#00F5FF',
            }}
          >
            {showAdd ? '✕ Cancel' : '+ Add webhook'}
          </button>
        </div>

        {showAdd && (
          <GlassCard className="p-4">
            <form onSubmit={handleAdd} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[0.65rem] font-mono mb-1" style={{ color: '#64748B' }}>Name</label>
                  <input
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    placeholder="My Slack webhook"
                    className="w-full px-2 py-1.5 rounded font-mono text-[0.75rem] bg-white/5 border border-white/10 text-slate-200 focus:outline-none focus:border-cyan-500/50"
                  />
                </div>
                <div>
                  <label className="block text-[0.65rem] font-mono mb-1" style={{ color: '#64748B' }}>Event filter</label>
                  <select
                    value={form.event_filter}
                    onChange={(e) => setForm((f) => ({ ...f, event_filter: e.target.value }))}
                    className="w-full px-2 py-1.5 rounded font-mono text-[0.75rem] bg-[#0d1525] border border-white/10 text-slate-200 focus:outline-none focus:border-cyan-500/50"
                  >
                    {EVENT_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-[0.65rem] font-mono mb-1" style={{ color: '#64748B' }}>URL</label>
                <input
                  required
                  value={form.url}
                  onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
                  placeholder="https://hooks.slack.com/…"
                  className="w-full px-2 py-1.5 rounded font-mono text-[0.75rem] bg-white/5 border border-white/10 text-slate-200 focus:outline-none focus:border-cyan-500/50"
                />
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.use_slack_format}
                  onChange={(e) => setForm((f) => ({ ...f, use_slack_format: e.target.checked }))}
                  className="accent-cyan-400"
                />
                <span className="font-mono text-[0.7rem]" style={{ color: '#94A3B8' }}>Slack format (wrap as <code className="text-cyan-400">&#123; text &#125;</code>)</span>
              </label>
              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-1.5 rounded font-mono text-[0.7rem] disabled:opacity-40 transition-colors"
                  style={{ background: 'rgba(0,245,255,0.15)', color: '#00F5FF', border: '1px solid rgba(0,245,255,0.3)' }}
                >
                  {saving ? 'Saving…' : 'Save webhook'}
                </button>
              </div>
            </form>
          </GlassCard>
        )}

        {loading && (
          <p className="text-center font-mono text-[0.7rem] py-8" style={{ color: '#475569' }}>Loading…</p>
        )}

        {!loading && webhooks.length === 0 && !showAdd && (
          <GlassCard className="p-8 text-center">
            <p className="font-mono text-[0.75rem]" style={{ color: '#475569' }}>No webhooks configured.</p>
            <p className="font-mono text-[0.65rem] mt-1" style={{ color: '#334155' }}>Add one to receive fleet alerts in Slack, PagerDuty, or any HTTP endpoint.</p>
          </GlassCard>
        )}

        {webhooks.map((hook) => (
          <GlassCard key={hook.id} className="overflow-hidden">
            <div className="flex items-center gap-3 p-3">
              <div
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{ background: hook.enabled ? '#10B981' : '#374151' }}
                title={hook.enabled ? 'Enabled' : 'Disabled'}
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[0.8rem] font-semibold truncate" style={{ color: '#E2E8F0' }}>
                    {hook.name || 'Unnamed'}
                  </span>
                  <span
                    className="text-[0.58rem] font-mono px-1.5 py-0.5 rounded"
                    style={{ background: 'rgba(255,255,255,0.06)', color: '#64748B' }}
                  >
                    {hook.event_filter}
                  </span>
                  {hook.use_slack_format === 1 && (
                    <span className="text-[0.58rem] font-mono px-1.5 py-0.5 rounded" style={{ background: 'rgba(78,156,233,0.15)', color: '#7DD3FC' }}>
                      slack
                    </span>
                  )}
                </div>
                <div className="font-mono text-[0.65rem] mt-0.5 truncate" style={{ color: '#475569' }}>
                  {maskUrl(hook.url)}
                </div>
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                {testStatus[hook.id] && (
                  <span className="font-mono text-[0.65rem]" style={{ color: testStatus[hook.id]?.startsWith('✓') ? '#10B981' : '#F87171' }}>
                    {testStatus[hook.id]}
                  </span>
                )}
                <button
                  onClick={() => handleTest(hook.id)}
                  className="px-2 py-1 rounded font-mono text-[0.65rem] border transition-colors"
                  style={{ borderColor: 'rgba(148,163,184,0.2)', color: '#94A3B8' }}
                  title="Send test payload"
                >
                  Test
                </button>
                <button
                  onClick={() => handleToggle(hook)}
                  className="px-2 py-1 rounded font-mono text-[0.65rem] border transition-colors"
                  style={{ borderColor: 'rgba(148,163,184,0.2)', color: hook.enabled ? '#10B981' : '#475569' }}
                  title={hook.enabled ? 'Disable' : 'Enable'}
                >
                  {hook.enabled ? 'On' : 'Off'}
                </button>
                <button
                  onClick={() => toggleExpand(hook.id)}
                  className="px-2 py-1 rounded font-mono text-[0.65rem] border transition-colors"
                  style={{ borderColor: 'rgba(0,245,255,0.2)', color: '#00F5FF' }}
                  title="Show delivery log"
                >
                  {expandedId === hook.id ? '▲' : '▼'}
                </button>
                <button
                  onClick={() => handleDelete(hook.id)}
                  className="px-2 py-1 rounded font-mono text-[0.65rem] border transition-colors"
                  style={{ borderColor: 'rgba(239,68,68,0.2)', color: '#EF4444' }}
                  title="Delete webhook"
                >
                  ✕
                </button>
              </div>
            </div>

            {expandedId === hook.id && (
              <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                <div className="px-3 py-2">
                  <p className="font-mono text-[0.6rem] mb-2" style={{ color: '#475569' }}>
                    Last 20 deliveries
                  </p>
                  {(deliveries[hook.id] ?? []).length === 0 ? (
                    <p className="font-mono text-[0.65rem]" style={{ color: '#334155' }}>No deliveries yet.</p>
                  ) : (
                    <div className="space-y-1">
                      {(deliveries[hook.id] ?? []).map((d) => (
                        <div key={d.id} className="flex items-center gap-2 font-mono text-[0.65rem]">
                          <span style={{ color: '#475569' }}>{formatTs(d.ts)}</span>
                          <span style={{ color: '#7DD3FC' }}>{d.event_type}</span>
                          <span style={{ color: '#64748B' }}>{d.slug}</span>
                          <span className={STATUS_COLORS[d.status] ?? 'text-slate-400'}>{d.status}</span>
                          {d.response_code != null && (
                            <span style={{ color: '#475569' }}>{d.response_code}</span>
                          )}
                          {d.error && (
                            <span className="truncate max-w-[200px]" style={{ color: '#EF4444' }} title={d.error}>{d.error}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </GlassCard>
        ))}
      </div>
    </div>
  )
}
