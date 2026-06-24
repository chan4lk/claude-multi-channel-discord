'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { usePinnedViews } from '../lib/pinnedViews'
import { flattenNavItems } from './nav-groups'

// P184 — Pinned Views bar. Renders directly beneath the dashboard header as a
// thin strip of icon+label chips for the operator's pinned views, in pin order.
// Absent entirely when nothing is pinned (no empty shell).
export default function PinnedViewsBar() {
  const pins = usePinnedViews()
  const pathname = usePathname()

  if (pins.length === 0) return null

  const byHref = new Map(flattenNavItems().map((i) => [i.href, i]))
  const items = pins.map((href) => byHref.get(href)).filter((i): i is NonNullable<typeof i> => i != null)
  if (items.length === 0) return null

  return (
    <div className="relative z-40 border-b border-cyber-cyan/8 bg-cyber-surface/40 backdrop-blur-sm px-4 sm:px-6 py-1.5">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[0.5rem] font-mono uppercase tracking-widest text-slate-600 shrink-0">★ Pinned</span>
        {items.map((item) => {
          const isActive = pathname === item.href
          return (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[0.6rem] font-mono border transition-colors"
              style={{
                color: isActive ? '#22D3EE' : '#94A3B8',
                borderColor: isActive ? 'rgba(34,211,238,0.4)' : 'rgba(148,163,184,0.15)',
                background: isActive ? 'rgba(34,211,238,0.08)' : 'transparent',
              }}
            >
              <span style={{ opacity: 0.7, fontSize: '0.65rem' }}>{item.icon}</span>
              {item.label}
            </Link>
          )
        })}
      </div>
    </div>
  )
}
