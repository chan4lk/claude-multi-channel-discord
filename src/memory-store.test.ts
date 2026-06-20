/**
 * Tests for MemoryStore. Run with: bun src/memory-store.test.ts
 */
import { unlinkSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MemoryStore } from './memory-store.ts'

let failed = 0
function check(label: string, cond: boolean, detail?: string) {
  const status = cond ? 'PASS' : 'FAIL'
  console.log(`${status}  ${label}${cond ? '' : `  -- ${detail ?? ''}`}`)
  if (!cond) failed++
}

function tmpDb(): string {
  return join(tmpdir(), `test-memory-${Date.now()}-${Math.random().toString(36).slice(2)}.db`)
}

async function runTests() {
  // --- remember + recall by keyword -----------------------------------------
  {
    const path = tmpDb()
    const store = new MemoryStore(path, tmpdir())
    const id = await store.remember('proj-a', 'general', 'The quick brown fox jumps')
    check('remember: returns mem_ id', typeof id === 'string' && id.startsWith('mem_'))
    const results = await store.recall('brown fox')
    check('recall: finds by keyword', results.some(r => r.id === id))
    store.close()
    unlinkSync(path)
  }

  // --- forget ---------------------------------------------------------------
  {
    const path = tmpDb()
    const store = new MemoryStore(path, tmpdir())
    const id = await store.remember('proj-b', 'decision', 'Use bun test not jest ever')
    store.forget(id)
    const results = await store.recall('bun test not jest')
    check('forget: removed record not in recall', !results.find(r => r.id === id))
    store.close()
    unlinkSync(path)
  }

  // --- stats ----------------------------------------------------------------
  {
    const path = tmpDb()
    const store = new MemoryStore(path, tmpdir())
    await store.remember('ch1', 'general', 'alpha content one')
    await store.remember('ch1', 'decision', 'beta content two')
    await store.remember('ch2', 'pattern', 'gamma content three')
    const s = store.stats()
    check('stats: total = 3', s.total === 3, `got ${s.total}`)
    check('stats: bySlug ch1 = 2', s.bySlug['ch1'] === 2, `got ${s.bySlug['ch1']}`)
    check('stats: bySlug ch2 = 1', s.bySlug['ch2'] === 1, `got ${s.bySlug['ch2']}`)
    check('stats: byType general = 1', s.byType['general'] === 1, `got ${s.byType['general']}`)
    check('stats: byType decision = 1', s.byType['decision'] === 1)
    check('stats: byType pattern = 1', s.byType['pattern'] === 1)
    store.close()
    unlinkSync(path)
  }

  // --- slug filter ----------------------------------------------------------
  {
    const path = tmpDb()
    const store = new MemoryStore(path, tmpdir())
    await store.remember('ch-x', 'general', 'unique zork keyword here')
    await store.remember('ch-y', 'general', 'unique zork keyword here')
    const results = await store.recall('unique zork', { slug: 'ch-x' })
    check('recall slug filter: only ch-x', results.length === 1 && results[0].channel_slug === 'ch-x',
      `got ${results.map(r => r.channel_slug).join(',')}`)
    store.close()
    unlinkSync(path)
  }

  // --- null slug ------------------------------------------------------------
  {
    const path = tmpDb()
    const store = new MemoryStore(path, tmpdir())
    const id = await store.remember(null, 'coordination', 'global coordination note here')
    const results = await store.recall('global coordination note')
    const mem = results.find(r => r.id === id)
    check('null slug: recall finds it', mem !== undefined)
    check('null slug: channel_slug is null', mem?.channel_slug === null, `got ${mem?.channel_slug}`)
    store.close()
    unlinkSync(path)
  }

  // --- opens cleanly on first run (no db file) ------------------------------
  {
    const path = tmpDb()
    check('first run: file does not exist before open', !existsSync(path))
    const store = new MemoryStore(path, tmpdir())
    const s = store.stats()
    check('first run: stats total = 0', s.total === 0, `got ${s.total}`)
    store.close()
    unlinkSync(path)
  }

  if (failed > 0) {
    console.log(`\n${failed} test(s) FAILED`)
    process.exit(1)
  } else {
    console.log('\nAll tests passed.')
  }
}

runTests().catch(err => {
  console.error('Test runner error:', err)
  process.exit(1)
})
