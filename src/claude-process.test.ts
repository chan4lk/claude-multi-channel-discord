/**
 * bun src/claude-process.test.ts
 * Unit tests for paneShowsReadyTui.
 * Run: bun src/claude-process.test.ts
 */
import { paneShowsReadyTui } from './claude-process.ts'

let failed = 0
function check(label: string, cond: boolean, detail?: string) {
  const status = cond ? 'PASS' : 'FAIL'
  console.log(`${status}  ${label}${cond ? '' : `  -- ${detail ?? ''}`}`)
  if (!cond) failed++
}

// ---------------------------------------------------------------------------
// Ready — one footer per permission mode
// ---------------------------------------------------------------------------
check(
  'auto mode footer',
  paneShowsReadyTui('❯ \n  ⏵⏵ auto mode on (shift+tab to cycle)'),
)
check(
  'bypass permissions footer (--dangerously-skip-permissions via extraArgs)',
  paneShowsReadyTui('❯ \n  ⏵⏵ bypass permissions on (shift+tab to cycle) · ← for agents'),
)
check(
  'accept edits footer',
  paneShowsReadyTui('❯ \n  ⏵⏵ accept edits on (shift+tab to cycle)'),
)
check(
  'plan mode footer',
  paneShowsReadyTui('❯ \n  ⏵⏵ plan mode on (shift+tab to cycle)'),
)

// ---------------------------------------------------------------------------
// Not ready
// ---------------------------------------------------------------------------
check('empty pane', !paneShowsReadyTui(''))
check('footer without prompt cursor', !paneShowsReadyTui('⏵⏵ auto mode on (shift+tab to cycle)'))
check('prompt cursor without mode footer', !paneShowsReadyTui('❯ '))
check(
  'startup banner only',
  !paneShowsReadyTui('▐▛███▜▌   Claude Code v2.1.177\n~/.claude/channels/foo'),
)
check(
  'trust dialog pending',
  !paneShowsReadyTui('Do you trust the files in this folder?\n❯ 1. Yes, proceed'),
)

if (failed > 0) {
  console.error(`\n${failed} check(s) failed`)
  process.exit(1)
}
console.log('\nall checks passed')
