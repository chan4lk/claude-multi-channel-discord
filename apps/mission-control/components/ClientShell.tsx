'use client'

import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
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
      {children}
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
