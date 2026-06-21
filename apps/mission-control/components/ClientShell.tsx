'use client'

import { useEffect, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import CommandPalette, { type InjectRequest } from './CommandPalette'
import InjectTerminal from './InjectTerminal'
import { FleetContextProvider } from './FleetContext'

interface InjectState {
  slug: string
  initialMessage?: string
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
      <CommandPalette onInject={handleInject} />
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
