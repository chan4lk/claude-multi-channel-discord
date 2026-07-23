/**
 * bun src/orphan-sweep.test.ts
 * Unit tests for findOrphanSessions.
 * Run: bun src/orphan-sweep.test.ts
 */
import { findOrphanSessions } from './orphan-sweep.ts'

let failed = 0
function check(label: string, cond: boolean, detail?: string) {
  const status = cond ? 'PASS' : 'FAIL'
  console.log(`${status}  ${label}${cond ? '' : `  -- ${detail ?? ''}`}`)
  if (!cond) failed++
}

// ---------------------------------------------------------------------------
// Matches — real project-session shapes
// ---------------------------------------------------------------------------
{
  const hits = findOrphanSessions([
    'mcd-claude-mcd-mrwxepkq',
    'mcd-application-collector-mrggsfaj',
    'mcd-master-mrws9mc2',
    'mcd-keyflow-mrgfkpud',
  ])
  check('matches simple slug', hits.includes('mcd-master-mrws9mc2'))
  check('matches multi-hyphen slug', hits.includes('mcd-application-collector-mrggsfaj'))
  check('matches slug containing "mcd"', hits.includes('mcd-claude-mcd-mrwxepkq'))
  check('all four project sessions matched', hits.length === 4, `got ${hits.length}`)
}

// ---------------------------------------------------------------------------
// Non-matches — server session, hand-named sessions, other tools
// ---------------------------------------------------------------------------
{
  const misses = findOrphanSessions([
    'mcd', // the MCD server's own session
    'mcd-server', // suffix not timestamp-shaped... (see edge below)
    'main',
    'work',
    'hermes',
    'mcd-x-THISISLONGSUFFIX13', // uppercase + >12 chars
    'mcd-', // no slug, no suffix
  ])
  check('bare mcd survives', !misses.includes('mcd'))
  check('main/work/hermes survive', misses.every((m) => !['main', 'work', 'hermes'].includes(m)))
  check('uppercase long suffix survives', !misses.includes('mcd-x-THISISLONGSUFFIX13'))
  check('bare mcd- survives', !misses.includes('mcd-'))
  // `mcd-server` is 'mcd' + '-server': no second segment, so the pattern
  // requires slug AND suffix — a single word after mcd- cannot satisfy both.
  check('mcd-server survives', !misses.includes('mcd-server'))
}

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------
{
  check('empty input → empty output', findOrphanSessions([]).length === 0)
  // Suffix length bounds: 4–12 lowercase base36 chars
  const bounds = findOrphanSessions(['mcd-a-abc', 'mcd-a-abcd', 'mcd-a-abcdefghijkl', 'mcd-a-abcdefghijklm'])
  check('3-char suffix rejected', !bounds.includes('mcd-a-abc'))
  check('4-char suffix accepted', bounds.includes('mcd-a-abcd'))
  check('12-char suffix accepted', bounds.includes('mcd-a-abcdefghijkl'))
  check('13-char suffix rejected', !bounds.includes('mcd-a-abcdefghijklm'))
}

console.log(failed === 0 ? '\nAll orphan-sweep tests passed.' : `\n${failed} test(s) FAILED.`)
process.exit(failed === 0 ? 0 : 1)
