/**
 * bun src/shared-learnings.test.ts
 * Unit tests for appendLearning / readLearnings.
 * AC7 — append, read, tag filter, limit, newest-first.
 * AC8 — 64 KB rotation, 2 KB entry rejection.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Use a temp dir per run so tests are fully isolated
const tmpDir = mkdtempSync(join(tmpdir(), 'mcd-learnings-test-'))
process.env.MCD_CHANNELS_DIR = tmpDir

// Import AFTER setting env so sharedLearningsPath() picks up the temp dir
import { appendLearning, readLearnings } from './shared-learnings.ts'

let failed = 0
function check(label: string, cond: boolean, detail?: string) {
  const status = cond ? 'PASS' : 'FAIL'
  console.log(`${status}  ${label}${cond ? '' : `  -- ${detail ?? ''}`}`)
  if (!cond) failed++
}

// ---------------------------------------------------------------------------
// AC7 — basic append + read
// ---------------------------------------------------------------------------
{
  // fresh state (temp dir, no file yet)
  const empty = readLearnings()
  check('AC7: empty file → empty list', empty.length === 0)

  appendLearning({ slug: 'proj-a', text: 'tmux needs TUI before Enter', tags: ['tmux', 'cli'] })
  const entries = readLearnings()
  check('AC7: one entry returned', entries.length === 1)
  check('AC7: slug matches', entries[0].slug === 'proj-a')
  check('AC7: text matches', entries[0].text === 'tmux needs TUI before Enter')
  check('AC7: tags normalized', entries[0].tags.includes('tmux') && entries[0].tags.includes('cli'))
  check('AC7: ts is ISO string', /^\d{4}-\d{2}-\d{2}T/.test(entries[0].ts))
}

// ---------------------------------------------------------------------------
// AC7 — tag filter (AND semantics)
// ---------------------------------------------------------------------------
{
  appendLearning({ slug: 'proj-b', text: 'atomic rename pattern', tags: ['fs', 'atomic'] })
  appendLearning({ slug: 'proj-b', text: 'bun tsc typecheck tip', tags: ['typescript', 'cli'] })

  const byTmux = readLearnings({ tags: ['tmux'] })
  check('AC7: tag filter tmux → 1 match', byTmux.length === 1)
  check('AC7: tag filter tmux → correct entry', byTmux[0].slug === 'proj-a')

  const byCli = readLearnings({ tags: ['cli'] })
  check('AC7: tag filter cli → 2 matches (tmux+cli and typescript+cli)', byCli.length === 2)

  const byAndFilter = readLearnings({ tags: ['cli', 'tmux'] })
  check('AC7: AND tag filter cli+tmux → 1 match (only entry with both)', byAndFilter.length === 1)

  const byMiss = readLearnings({ tags: ['nonexistent'] })
  check('AC7: no tag match → empty', byMiss.length === 0)
}

// ---------------------------------------------------------------------------
// AC7 — limit + newest-first
// ---------------------------------------------------------------------------
{
  // We have 3 entries so far; append 2 more
  appendLearning({ slug: 'proj-c', text: 'fourth entry' })
  appendLearning({ slug: 'proj-c', text: 'fifth entry' })

  const limited = readLearnings({ limit: 2 })
  check('AC7: limit=2 returns 2 entries', limited.length === 2)
  check('AC7: newest entry first (fifth)', limited[0].text === 'fifth entry')
  check('AC7: second entry is fourth', limited[1].text === 'fourth entry')

  const all = readLearnings({ limit: 100 })
  check('AC7: all 5 entries present', all.length === 5)
  check('AC7: global newest-first ordering', all[0].text === 'fifth entry')
}

// ---------------------------------------------------------------------------
// AC7 — tag normalization (strip #, lowercase, drop empties)
// ---------------------------------------------------------------------------
{
  appendLearning({ slug: 'proj-d', text: 'tag norm test', tags: ['#HashTag', 'UPPER', '', '  '] })
  const [latest] = readLearnings({ limit: 1 })
  check('AC7: tag # stripped', !latest.tags.some(t => t.startsWith('#')))
  check('AC7: tags lowercased', latest.tags.includes('hashtag') && latest.tags.includes('upper'))
  check('AC7: empty tags dropped', latest.tags.every(t => t.length > 0))
}

// ---------------------------------------------------------------------------
// AC8 — 2 KB entry rejection
// ---------------------------------------------------------------------------
{
  const bigText = 'x'.repeat(2049)  // definitely over 2 KB once wrapped in line format
  let threw = false
  try {
    appendLearning({ slug: 'proj-e', text: bigText })
  } catch (e: unknown) {
    threw = true
    check('AC8: error mentions 2 KB limit', e instanceof Error && e.message.includes('2 KB'))
  }
  check('AC8: oversized entry throws', threw)
}

// ---------------------------------------------------------------------------
// AC8 — 64 KB rotation drops oldest entries
// ---------------------------------------------------------------------------
{
  // Create a fresh temp dir for this test to isolate from prior entries
  const rotateDir = mkdtempSync(join(tmpdir(), 'mcd-learnings-rotate-'))
  const origDir   = process.env.MCD_CHANNELS_DIR
  process.env.MCD_CHANNELS_DIR = rotateDir

  // Each entry is ~1 KB of text (close to the per-entry cap but under 2 KB)
  const entryText = 'r'.repeat(900)
  // Fill slightly over 64 KB: 64 KB / ~950 bytes/entry ≈ 68 entries; use 80
  const COUNT = 80
  for (let i = 0; i < COUNT; i++) {
    appendLearning({ slug: 'filler', text: `${i}-${entryText}`, tags: ['rotate'] })
  }

  const { statSync } = await import('node:fs')
  const { sharedLearningsPath } = await import('./paths.ts')
  const { size } = statSync(sharedLearningsPath())
  check('AC8: file stays ≤ 64 KB after rotation', size <= 64 * 1024, `size=${size}`)

  // The newest entries must still be present
  const newest = readLearnings({ limit: 5, tags: ['rotate'] })
  check('AC8: newest entries retained after rotation', newest.length === 5)
  check('AC8: newest entry is the last appended', newest[0].text.startsWith(`${COUNT - 1}-`))

  process.env.MCD_CHANNELS_DIR = origDir
}

// ---------------------------------------------------------------------------
// cleanup
// ---------------------------------------------------------------------------
rmSync(tmpDir, { recursive: true, force: true })

if (failed > 0) {
  console.error(`\n${failed} test(s) FAILED`)
  process.exit(1)
} else {
  console.log(`\nAll tests passed.`)
}
