/**
 * bun src/claude-process.test.ts
 * Unit tests for paneShowsReadyTui.
 * Run: bun src/claude-process.test.ts
 */
import { paneShowsReadyTui, trustDialogKeys } from './claude-process.ts'

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

// ---------------------------------------------------------------------------
// trustDialogKeys — must land on "Yes", never Enter on the default "No"
// ---------------------------------------------------------------------------
const eq = (a: string[], b: string[]) => JSON.stringify(a) === JSON.stringify(b)
const quickCheckPane = [
  ' Quick safety check: Is this a project you created or one you trust?',
  ' Claude Code\'ll be able to read, edit, and execute files here.',
  '',
  ' ❯ No, exit',
  '   Yes, I trust this folder',
  '',
  ' Enter to confirm · Esc to cancel',
].join('\n')
check('quick-check dialog: Down then Enter', eq(trustDialogKeys(quickCheckPane), ['Down', 'C-m']), JSON.stringify(trustDialogKeys(quickCheckPane)))
check(
  'cursor already on Yes: Enter only',
  eq(trustDialogKeys(' ❯ Yes, I trust this folder\n   No, exit'), ['C-m']),
)
check(
  'cursor below Yes: Up then Enter',
  eq(trustDialogKeys('   Yes, I trust this folder\n ❯ No, exit'), ['Up', 'C-m']),
)
check(
  'numbered dialog: digit then Enter',
  eq(trustDialogKeys('Do you trust the files in this folder?\n❯ 1. Yes, proceed\n  2. No, exit'), ['1', 'C-m']),
)
check('no Yes option: fall back to Enter', eq(trustDialogKeys('Trust this workspace'), ['C-m']))

if (failed > 0) {
  console.error(`\n${failed} check(s) failed`)
  process.exit(1)
}
console.log('\nall checks passed')
