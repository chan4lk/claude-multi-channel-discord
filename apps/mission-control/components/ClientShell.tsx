'use client'

import { useEffect, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import CommandPalette, { type InjectRequest } from './CommandPalette'
import InjectTerminal from './InjectTerminal'

export default function ClientShell({ children }: { children: React.ReactNode }) {
  const [injectSlug, setInjectSlug] = useState<string | null>(null)

  function handleInject(req: InjectRequest) {
    setInjectSlug(req.slug)
  }

  // Listen for inject events dispatched from anywhere (e.g. InstanceGrid slug buttons)
  useEffect(() => {
    function onInjectEvent(e: Event) {
      const slug = (e as CustomEvent<{ slug: string }>).detail?.slug
      if (slug) setInjectSlug(slug)
    }
    window.addEventListener('mc:inject', onInjectEvent)
    return () => window.removeEventListener('mc:inject', onInjectEvent)
  }, [])

  return (
    <>
      {children}
      <CommandPalette onInject={handleInject} />
      <AnimatePresence>
        {injectSlug !== null && (
          <InjectTerminal
            key="inject-terminal"
            initialSlug={injectSlug}
            onClose={() => setInjectSlug(null)}
          />
        )}
      </AnimatePresence>
    </>
  )
}
