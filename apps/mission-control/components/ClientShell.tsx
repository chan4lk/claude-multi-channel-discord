'use client'

import { useEffect, useState, Suspense } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import { AnimatePresence } from 'framer-motion'
import CommandPalette, { type InjectRequest } from './CommandPalette'
import InjectTerminal from './InjectTerminal'
import FleetAdvisorPanel from './FleetAdvisorPanel'
import SpotlightDrawer from './SpotlightDrawer'
import KeyboardShortcutsModal from './KeyboardShortcutsModal'
import NotificationBell from './NotificationBell'
import { FleetContextProvider } from './FleetContext'
import { authClient } from '../src/auth-client'

const MOBILE_NAV = [
  { href: '/', icon: '⌂', label: 'Home' },
  { href: '/feed', icon: '≣', label: 'Feed' },
  { href: '/galaxy', icon: '✵', label: 'Galaxy' },
  { href: '/pipeline', icon: '⬒', label: 'Pipeline' },
  { href: '/search', icon: '⌕', label: 'Search' },
] as const

function MobileBottomNav() {
  const pathname = usePathname()
  if (pathname === '/login') return null
  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 sm:hidden border-t border-cyber-cyan/15"
      style={{ background: 'rgba(5,10,20,0.97)', backdropFilter: 'blur(10px)' }}
    >
      <div className="flex">
        {MOBILE_NAV.map(({ href, icon, label }) => {
          const isActive = pathname === href
          return (
            <Link
              key={href}
              href={href}
              className="flex-1 flex flex-col items-center justify-center gap-0.5 py-2.5 relative touch-manipulation"
              style={{ color: isActive ? '#00F5FF' : '#475569' }}
            >
              {isActive && (
                <span
                  className="absolute top-0 inset-x-2 h-px rounded-full"
                  style={{ background: '#00F5FF' }}
                />
              )}
              <span className="text-base leading-none">{icon}</span>
              <span
                className="text-[0.48rem] uppercase tracking-widest font-mono"
                style={{ color: isActive ? '#00F5FF' : '#374151' }}
              >
                {label}
              </span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}

interface InjectState {
  slug: string
  initialMessage?: string
}

const SIDEBAR_ITEMS = [
  { href: '/', icon: '⌂', label: 'Dashboard' },
  { href: '/graph', icon: '⬡', label: 'Graph' },
  { href: '/graph3d', icon: '◈', label: '3D Graph' },
  { href: '/timeline', icon: '◫', label: 'Timeline' },
  { href: '/metrics', icon: '◱', label: 'Metrics' },
  { href: '/reports', icon: '◻', label: 'Reports' },
  { href: '/pipeline', icon: '⬒', label: 'Pipeline' },
  { href: '/memory-graph', icon: '✦', label: 'Memory' },
  { href: '/goals', icon: '◎', label: 'Goals' },
  { href: '/branches', icon: '⑂', label: 'Branches' },
  { href: '/heatmap', icon: '▦', label: 'Heatmap' },
  { href: '/traceability', icon: '⑂', label: 'Traceability' },
  { href: '/backlog', icon: '◈', label: 'Backlog' },
  { href: '/audit', icon: '≡', label: 'Audit' },
  { href: '/alerts', icon: '⚠', label: 'Alerts' },
  { href: '/snapshots', icon: '⊡', label: 'Snapshots' },
  { href: '/broadcast', icon: '◉', label: 'Broadcast' },
  { href: '/admin/webhooks', icon: '⇄', label: 'Webhooks' },
  { href: '/search', icon: '⌕', label: 'Search' },
] as const

function NavSidebar({ onShortcuts }: { onShortcuts?: () => void }) {
  const pathname = usePathname()
  if (pathname === '/login') return null
  return (
    <nav
      className="fixed left-0 top-0 bottom-0 z-40 flex flex-col items-center pt-3 pb-2 gap-0.5 border-r border-cyber-cyan/10"
      style={{ width: 44, background: 'rgba(4,10,20,0.93)', backdropFilter: 'blur(8px)' }}
    >
      {SIDEBAR_ITEMS.map((item) => {
        const isActive = pathname === item.href
        return (
          <Link
            key={item.href}
            href={item.href}
            title={item.label}
            className="group relative flex items-center justify-center rounded transition-all"
            style={{
              width: 32,
              height: 30,
              color: isActive ? '#00F5FF' : '#475569',
              background: isActive ? 'rgba(0,245,255,0.1)' : 'transparent',
              boxShadow: isActive ? 'inset 0 0 0 1px rgba(0,245,255,0.2)' : 'none',
            }}
          >
            <span className="text-sm leading-none select-none">{item.icon}</span>
            <span
              className="absolute left-full ml-2.5 px-2 py-1 rounded text-[0.6rem] font-mono whitespace-nowrap pointer-events-none z-50 opacity-0 group-hover:opacity-100 transition-opacity"
              style={{ background: '#080f1c', color: '#94A3B8', border: '1px solid rgba(0,245,255,0.15)' }}
            >
              {item.label}
            </span>
          </Link>
        )
      })}
      {/* Notification bell + keyboard shortcuts pinned at bottom */}
      <div className="flex-1" />
      <NotificationBell />
      <button
        onClick={onShortcuts}
        title="Keyboard shortcuts (?)"
        className="group relative flex items-center justify-center rounded transition-all"
        style={{ width: 32, height: 30, color: '#374151', background: 'transparent' }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = '#22D3EE' }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = '#374151' }}
      >
        <span className="text-xs font-mono leading-none select-none">?</span>
        <span
          className="absolute left-full ml-2.5 px-2 py-1 rounded text-[0.6rem] font-mono whitespace-nowrap pointer-events-none z-50 opacity-0 group-hover:opacity-100 transition-opacity"
          style={{ background: '#080f1c', color: '#94A3B8', border: '1px solid rgba(0,245,255,0.15)' }}
        >
          Shortcuts (?)
        </span>
      </button>
    </nav>
  )
}

function LogoutButton() {
  const router = useRouter()
  const pathname = usePathname()
  const [loading, setLoading] = useState(false)

  if (pathname === '/login') return null

  async function handleLogout() {
    setLoading(true)
    await authClient.signOut()
    router.push('/login')
  }

  return (
    <button
      onClick={handleLogout}
      disabled={loading}
      className="fixed bottom-16 sm:bottom-4 right-4 z-50 text-[0.6rem] font-mono px-2 py-1 rounded border border-slate-700/60 text-slate-600 hover:text-red-400 hover:border-red-500/40 transition-colors disabled:opacity-40"
      style={{ background: 'rgba(4,10,20,0.85)', backdropFilter: 'blur(4px)' }}
      title="Sign out"
    >
      {loading ? '…' : '⏻'}
    </button>
  )
}

function SidebarSpacer({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  if (pathname === '/login') return <>{children}</>
  return <div style={{ paddingLeft: 44 }}>{children}</div>
}

export default function ClientShell({ children }: { children: React.ReactNode }) {
  const [injectState, setInjectState] = useState<InjectState | null>(null)
  const [showShortcuts, setShowShortcuts] = useState(false)

  function handleInject(req: InjectRequest) {
    setInjectState({ slug: req.slug })
  }

  useEffect(() => {
    function onInjectEvent(e: Event) {
      const detail = (e as CustomEvent<{ slug: string; initialMessage?: string }>).detail
      if (detail?.slug) setInjectState({ slug: detail.slug, initialMessage: detail.initialMessage })
    }
    window.addEventListener('mc:inject', onInjectEvent)
    return () => window.removeEventListener('mc:inject', onInjectEvent)
  }, [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') return
      if (e.key === '?') {
        e.preventDefault()
        setShowShortcuts((s) => !s)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <FleetContextProvider>
      <NavSidebar onShortcuts={() => setShowShortcuts(true)} />
      <SidebarSpacer>
        <div className="pb-14 sm:pb-0">
          {children}
        </div>
      </SidebarSpacer>
      <MobileBottomNav />
      <LogoutButton />
      <CommandPalette onInject={handleInject} />
      <FleetAdvisorPanel />
      <Suspense><SpotlightDrawer /></Suspense>
      {showShortcuts && <KeyboardShortcutsModal onClose={() => setShowShortcuts(false)} />}
      <AnimatePresence>
        {injectState !== null && (
          <InjectTerminal
            key="inject-terminal"
            initialSlug={injectState.slug}
            initialMessage={injectState.initialMessage}
            onClose={() => setInjectState(null)}
          />
        )}
      </AnimatePresence>
    </FleetContextProvider>
  )
}
