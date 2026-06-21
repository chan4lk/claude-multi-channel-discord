'use client'

import { useEffect, useState, Suspense } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import { AnimatePresence } from 'framer-motion'
import CommandPalette, { type InjectRequest } from './CommandPalette'
import InjectTerminal from './InjectTerminal'
import FleetAdvisorPanel from './FleetAdvisorPanel'
import SpotlightDrawer from './SpotlightDrawer'
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
      <div className="pb-14 sm:pb-0">
        {children}
      </div>
      <MobileBottomNav />
      <LogoutButton />
      <CommandPalette onInject={handleInject} />
      <FleetAdvisorPanel />
      <Suspense><SpotlightDrawer /></Suspense>
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
