'use client'

import CommandPalette from './CommandPalette'

export default function ClientShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <CommandPalette />
    </>
  )
}
