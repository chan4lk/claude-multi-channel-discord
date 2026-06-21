'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

interface NavItem {
  href: string
  label: string
  icon: string
}

interface NavGroup {
  category: string
  color: string
  items: NavItem[]
}

const NAV_GROUPS: NavGroup[] = [
  {
    category: 'Observability',
    color: '#22D3EE',
    items: [
      { href: '/feed', label: 'Project Feed', icon: '≣' },
      { href: '/galaxy', label: 'Galaxy Map', icon: '✵' },
      { href: '/graph', label: 'Project Graph', icon: '⬡' },
      { href: '/timeline', label: 'Timeline', icon: '◫' },
      { href: '/memory-graph', label: 'Memory Graph', icon: '✦' },
      { href: '/knowledge', label: 'Knowledge', icon: '◈' },
      { href: '/flamegraph', label: 'Turn Flame Graph', icon: '▬' },
      { href: '/ambient', label: 'Fleet Ambient', icon: '◌' },
      { href: '/ticker', label: 'Tool Call Ticker', icon: '▶' },
    ],
  },
  {
    category: 'Operations',
    color: '#F59E0B',
    items: [
      { href: '/pipeline', label: 'Specclaw Pipeline', icon: '⬒' },
      { href: '/branches', label: 'Git Branches', icon: '⑂' },
      { href: '/broadcast', label: 'Broadcast', icon: '◉' },
      { href: '/audit', label: 'Audit Log', icon: '≡' },
    ],
  },
  {
    category: 'Intelligence',
    color: '#A78BFA',
    items: [
      { href: '/goals', label: 'Goals', icon: '◎' },
      { href: '/metrics', label: 'Metrics', icon: '◱' },
      { href: '/reports', label: 'Weekly Report', icon: '◻' },
      { href: '/advisor', label: 'Fleet Advisor', icon: '◆' },
      { href: '/similarity', label: 'Memory Similarity', icon: '⬡' },
    ],
  },
  {
    category: 'Admin',
    color: '#6B7280',
    items: [
      { href: '/search', label: 'Search', icon: '⌕' },
      { href: '/admin', label: 'Admin', icon: '⚙' },
    ],
  },
]

export default function NavDropdown() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const pathname = usePathname()

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
      if (e.key === 'v' || e.key === 'V') {
        if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') return
        setOpen((o) => !o)
      }
    }
    function onOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onOutside)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onOutside)
    }
  }, [])

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="text-[0.6rem] font-mono text-slate-500 hover:text-cyber-cyan transition-colors uppercase tracking-wider border border-transparent hover:border-cyber-cyan/30 px-2 py-1.5 sm:px-1.5 sm:py-0.5 rounded flex items-center gap-1 touch-manipulation"
        title="All Views (V)"
      >
        ⊞ All Views
        <span style={{ fontSize: '0.5rem', opacity: 0.5 }}>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <>
          {/* Mobile backdrop */}
          <div
            className="fixed inset-0 z-40 sm:hidden"
            style={{ background: 'rgba(0,0,0,0.7)' }}
            onClick={() => setOpen(false)}
          />
          <div
            className="absolute left-0 top-full mt-1 z-50 rounded-lg border border-cyber-cyan/15 overflow-hidden shadow-xl"
            style={{
              background: '#080f1c',
              width: 'min(560px, calc(100vw - 24px))',
            }}
          >
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-0">
              {NAV_GROUPS.map((group) => (
                <div key={group.category} className="p-3 border-r border-white/5 last:border-r-0">
                  <div
                    className="text-[0.55rem] font-mono uppercase tracking-widest font-bold mb-2 pb-1 border-b"
                    style={{ color: group.color, borderColor: `${group.color}25` }}
                  >
                    {group.category}
                  </div>
                  <div className="flex flex-col gap-0.5">
                    {group.items.map((item) => {
                      const isActive = pathname === item.href
                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          onClick={() => setOpen(false)}
                          className="flex items-center gap-1.5 px-1.5 py-1 rounded text-[0.65rem] font-mono transition-colors"
                          style={{
                            color: isActive ? group.color : '#64748B',
                            background: isActive ? `${group.color}12` : 'transparent',
                          }}
                          onMouseEnter={(e) => {
                            if (!isActive) (e.currentTarget as HTMLElement).style.color = '#CBD5E1'
                          }}
                          onMouseLeave={(e) => {
                            if (!isActive) (e.currentTarget as HTMLElement).style.color = '#64748B'
                          }}
                        >
                          <span style={{ opacity: 0.7, fontSize: '0.7rem' }}>{item.icon}</span>
                          {item.label}
                          {isActive && (
                            <span className="ml-auto text-[0.5rem]" style={{ color: group.color }}>●</span>
                          )}
                        </Link>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
            <div className="px-3 py-1.5 border-t border-white/5 text-[0.5rem] font-mono text-slate-700 flex items-center gap-1">
              <span>Press</span>
              <kbd className="px-1 rounded border border-white/10 text-slate-600">V</kbd>
              <span>to toggle · </span>
              <kbd className="px-1 rounded border border-white/10 text-slate-600">Esc</kbd>
              <span>to close</span>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
