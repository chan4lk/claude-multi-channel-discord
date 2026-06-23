'use client'

// P164: View Cycler Hotkeys.
// `]` / `[` step to the next / previous view within the current page's
// NavDropdown category (wrapping), with a brief toast naming the destination.
// Ordering is derived from the shared NAV_GROUPS so no list is duplicated.

import { useEffect, useRef, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { categoryForPath } from './nav-groups'

export default function ViewCycler() {
  const router = useRouter()
  const pathname = usePathname()
  const [toast, setToast] = useState<string | null>(null)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Keep latest pathname in a ref so the keydown listener (bound once) reads fresh state.
  const pathRef = useRef(pathname)
  pathRef.current = pathname

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== '[' && e.key !== ']') return
      const tag = document.activeElement?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (e.metaKey || e.ctrlKey || e.altKey) return

      const group = categoryForPath(pathRef.current)
      if (!group) return // page outside any category — no-op

      const idx = group.items.findIndex((i) => i.href === pathRef.current)
      if (idx === -1) return

      e.preventDefault()
      const len = group.items.length
      const nextIdx = e.key === ']' ? (idx + 1) % len : (idx - 1 + len) % len
      const dest = group.items[nextIdx]

      setToast(`${dest.icon}  ${dest.label}`)
      if (hideTimer.current) clearTimeout(hideTimer.current)
      hideTimer.current = setTimeout(() => setToast(null), 1400)

      router.push(dest.href)
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      if (hideTimer.current) clearTimeout(hideTimer.current)
    }
  }, [router])

  if (!toast) return null

  return (
    <div
      className="fixed bottom-6 left-1/2 z-[60] -translate-x-1/2 px-3 py-1.5 rounded-md font-mono text-[0.7rem] tracking-wide pointer-events-none"
      style={{
        background: 'rgba(8,15,28,0.95)',
        color: '#22D3EE',
        border: '1px solid rgba(34,211,238,0.3)',
        boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
        backdropFilter: 'blur(6px)',
      }}
    >
      {toast}
    </div>
  )
}
