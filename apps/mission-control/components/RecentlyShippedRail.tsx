'use client'

// P163: Recently Shipped Rail.
// A dismissible row of chips on the home dashboard linking to the most
// recently shipped dashboard views, sourced from /api/whats-new. Dismissal
// persists in localStorage keyed by the newest item, so the rail re-appears
// when something newer ships.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import type { ShippedItem, WhatsNewResponse } from '../app/api/whats-new/route'

const LS_DISMISS_KEY = 'mc-whats-new-dismissed'

// Stable signature of the newest shipped item — dismissal is scoped to it.
function topSignature(items: ShippedItem[]): string {
  return items.length ? `${items[0].number}:${items[0].shippedAt}` : ''
}

export default function RecentlyShippedRail() {
  const [items, setItems] = useState<ShippedItem[]>([])
  const [dismissed, setDismissed] = useState(true) // hidden until we know better

  useEffect(() => {
    let cancelled = false
    fetch('/api/whats-new')
      .then((r) => (r.ok ? r.json() : null))
      .then((data: WhatsNewResponse | null) => {
        if (cancelled || !data?.items?.length) return
        setItems(data.items)
        const sig = topSignature(data.items)
        const stored = typeof window !== 'undefined' ? localStorage.getItem(LS_DISMISS_KEY) : null
        setDismissed(stored === sig)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  function dismiss() {
    setDismissed(true)
    try { localStorage.setItem(LS_DISMISS_KEY, topSignature(items)) } catch {}
  }

  if (dismissed || items.length === 0) return null

  return (
    <section className="mb-5">
      <div
        className="rounded-lg border px-4 py-3 flex flex-wrap items-center gap-2"
        style={{ borderColor: 'rgba(34,211,238,0.18)', background: 'rgba(34,211,238,0.04)' }}
      >
        <span className="text-[0.6rem] font-mono uppercase tracking-widest text-cyber-cyan/80 shrink-0 flex items-center gap-1.5">
          <span aria-hidden>✦</span> Recently Shipped
        </span>
        <div className="flex flex-wrap items-center gap-1.5 flex-1 min-w-0">
          {items.map((it) => (
            <Link
              key={it.number}
              href={it.href}
              className="group flex items-center gap-1.5 px-2 py-1 rounded-md border text-[0.65rem] font-mono transition-colors"
              style={{ borderColor: 'rgba(148,163,184,0.18)', color: '#94A3B8', background: 'rgba(255,255,255,0.02)' }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = '#22D3EE'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(34,211,238,0.4)' }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = '#94A3B8'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(148,163,184,0.18)' }}
              title={`P${it.number} · shipped ${it.shippedAt || 'recently'}`}
            >
              {it.title}
              {it.shippedAt && (
                <span className="text-[0.5rem] text-slate-600 group-hover:text-cyber-cyan/60">{it.shippedAt.slice(5)}</span>
              )}
            </Link>
          ))}
        </div>
        <button
          onClick={dismiss}
          className="shrink-0 text-[0.7rem] text-slate-600 hover:text-slate-300 transition-colors px-1.5 py-0.5 rounded"
          title="Dismiss (re-appears when a newer view ships)"
          aria-label="Dismiss recently shipped"
        >
          ✕
        </button>
      </div>
    </section>
  )
}
