'use client'

import { useEffect } from 'react'

export interface ShortcutEntry {
  keys: string[]
  description: string
  context: string
}

export const KEYBINDINGS: ShortcutEntry[] = [
  // Global
  { keys: ['?'], description: 'Open keyboard shortcuts reference', context: 'Global' },
  { keys: ['V'], description: 'Toggle All Views nav dropdown', context: 'Global' },
  { keys: ['Ctrl', 'K'], description: 'Open command palette', context: 'Global' },
  { keys: ['A'], description: 'Toggle Fleet Advisor panel', context: 'Global' },
  { keys: ['Esc'], description: 'Close modal / go back', context: 'Global' },
  // Graph
  { keys: ['T'], description: 'Toggle Thought Stream (tool particles)', context: 'Graph (/graph)' },
  { keys: ['B'], description: 'Toggle Backlog halo overlay', context: 'Graph (/graph)' },
  { keys: ['Pulse toggle'], description: 'Toggle activity pulse rings', context: 'Graph (/graph)' },
  // Session Replay
  { keys: ['←', '→'], description: 'Previous / next turn', context: 'Replay (/replay)' },
  { keys: ['Space'], description: 'Toggle auto-play (3s/turn)', context: 'Replay (/replay)' },
  { keys: ['D'], description: 'Toggle turn diff mode', context: 'Replay (/replay)' },
  { keys: ['Shift', 'click turn'], description: 'Set comparison turn for diff', context: 'Replay (/replay)' },
  // Audit
  { keys: ['Replay toggle'], description: 'Enable timeline scrubber replay', context: 'Audit (/audit)' },
  // Command palette results
  { keys: ['↑', '↓'], description: 'Navigate command palette results', context: 'Command Palette' },
  { keys: ['Enter'], description: 'Execute selected command', context: 'Command Palette' },
]

const CONTEXTS = [...new Set(KEYBINDINGS.map((k) => k.context))]

function KeyBadge({ k }: { k: string }) {
  const isLong = k.length > 4
  return (
    <kbd
      className="inline-flex items-center justify-center rounded border font-mono"
      style={{
        fontSize: '0.55rem',
        padding: isLong ? '0.1rem 0.4rem' : '0.1rem 0.3rem',
        minWidth: isLong ? 'auto' : '1.2rem',
        background: '#0d1525',
        borderColor: 'rgba(0,245,255,0.25)',
        color: '#94A3B8',
        boxShadow: '0 1px 0 rgba(0,245,255,0.1)',
      }}
    >
      {k}
    </kbd>
  )
}

export default function KeyboardShortcutsModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' || e.key === '?') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      <div
        className="relative rounded-xl border w-full max-w-2xl max-h-[85vh] overflow-y-auto"
        style={{ background: '#070e1c', borderColor: 'rgba(0,245,255,0.2)', boxShadow: '0 0 40px rgba(0,245,255,0.06)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b" style={{ borderColor: 'rgba(0,245,255,0.1)' }}>
          <div>
            <h2 className="text-[0.75rem] font-mono font-bold text-cyber-cyan tracking-widest uppercase">Keyboard Shortcuts</h2>
            <p className="text-[0.5rem] font-mono text-slate-600 mt-0.5">Press <kbd className="px-1 rounded border border-white/10 text-slate-600">?</kbd> or <kbd className="px-1 rounded border border-white/10 text-slate-600">Esc</kbd> to close</p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-600 hover:text-cyber-cyan transition-colors text-lg leading-none"
          >
            ×
          </button>
        </div>

        {/* Shortcut groups */}
        <div className="p-5 grid gap-5 sm:grid-cols-2">
          {CONTEXTS.map((ctx) => {
            const entries = KEYBINDINGS.filter((k) => k.context === ctx)
            return (
              <div key={ctx}>
                <div
                  className="text-[0.5rem] font-mono uppercase tracking-widest font-bold mb-2 pb-1 border-b"
                  style={{ color: '#22D3EE', borderColor: 'rgba(34,211,238,0.15)' }}
                >
                  {ctx}
                </div>
                <div className="flex flex-col gap-1.5">
                  {entries.map((entry, i) => (
                    <div key={i} className="flex items-center justify-between gap-3">
                      <span className="text-[0.6rem] font-mono text-slate-400 flex-1">{entry.description}</span>
                      <div className="flex items-center gap-0.5 shrink-0">
                        {entry.keys.map((k, ki) => (
                          <span key={ki} className="flex items-center gap-0.5">
                            {ki > 0 && (
                              <span className="text-[0.45rem] font-mono text-slate-700 mx-0.5">+</span>
                            )}
                            <KeyBadge k={k} />
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
