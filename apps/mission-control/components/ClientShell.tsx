'use client'

import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import { AnimatePresence } from 'framer-motion'
import CommandPalette, { type InjectRequest } from './CommandPalette'
import InjectTerminal from './InjectTerminal'
import FleetAdvisorPanel from './FleetAdvisorPanel'
import { FleetContextProvider } from './FleetContext'
import { authClient } from '../src/auth-client'

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
  { href: '/audit', icon: '≡', label: 'Audit' },
  { href: '/broadcast', icon: '◉', label: 'Broadcast' },
  { href: '/search', icon: '⌕', label: 'Search' },
] as const

function NavSidebar() {
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
      className="fixed top-3 right-4 z-50 text-[0.6rem] font-mono px-2.5 py-1 rounded border border-slate-700 text-slate-500 hover:text-red-400 hover:border-red-500/40 transition-colors disabled:opacity-40"
      style={{ background: 'rgba(4,10,20,0.85)', backdropFilter: 'blur(4px)' }}
      title="Sign out"
    >
      {loading ? '…' : '⏻ logout'}
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

  return (
    <FleetContextProvider>
      <NavSidebar />
      <SidebarSpacer>
        {children}
      </SidebarSpacer>
      <LogoutButton />
      <CommandPalette onInject={handleInject} />
      <FleetAdvisorPanel />
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
