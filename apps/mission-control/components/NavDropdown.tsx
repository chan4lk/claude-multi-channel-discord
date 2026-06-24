'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { NAV_GROUPS } from './nav-groups'
import { usePinnedViews, togglePin, MAX_PINS } from '../lib/pinnedViews'

export default function NavDropdown() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const pathname = usePathname()
  const pins = usePinnedViews()
  const [capHint, setCapHint] = useState(false)

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
                      const isPinned = pins.includes(item.href)
                      return (
                        <div key={item.href} className="flex items-center gap-0.5 group/item">
                          <Link
                            href={item.href}
                            onClick={() => setOpen(false)}
                            className="flex-1 flex items-center gap-1.5 px-1.5 py-1 rounded text-[0.65rem] font-mono transition-colors min-w-0"
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
                            <span className="truncate">{item.label}</span>
                            {isActive && (
                              <span className="ml-auto text-[0.5rem]" style={{ color: group.color }}>●</span>
                            )}
                          </Link>
                          <button
                            onClick={(e) => {
                              e.preventDefault()
                              e.stopPropagation()
                              const ok = togglePin(item.href)
                              if (!ok) {
                                setCapHint(true)
                                setTimeout(() => setCapHint(false), 2500)
                              }
                            }}
                            title={isPinned ? 'Unpin view' : `Pin view (max ${MAX_PINS})`}
                            className="shrink-0 px-1 text-[0.6rem] leading-none transition-opacity"
                            style={{
                              color: isPinned ? '#FBBF24' : '#475569',
                              opacity: isPinned ? 1 : undefined,
                            }}
                          >
                            {isPinned ? '★' : '☆'}
                          </button>
                        </div>
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
              {capHint && (
                <span className="ml-auto" style={{ color: '#FBBF24' }}>max {MAX_PINS} pinned</span>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
