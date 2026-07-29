// Observable one-shot fact-index backfill: runs a single ingestOnce() pass
// over every project's transcripts and prints the IngestResult summary.
// The first run against a fresh mc.db backfills everything (no offsets yet);
// subsequent runs are incremental.
//
// Run from apps/mission-control:
//   bun run ingest:backfill
// (script uses tsx → Node; better-sqlite3, a native module, crashes under bun)
//
// Respects MCD_CHANNELS_DIR (default ~/.claude/channels/discord-multi) and
// MC_DB_PATH (default ./mc.db, resolved by src/db.ts).
import os from 'os'
import path from 'path'
import { ingestOnce } from '../src/fact-index'

async function main() {
  // Same resolution as the API routes (e.g. app/api/turn-duration/route.ts).
  const mcdDir =
    process.env.MCD_CHANNELS_DIR ??
    path.join(os.homedir(), '.claude', 'channels', 'discord-multi')
  const dbPath = process.env.MC_DB_PATH ?? 'mc.db'
  console.log(`[backfill] ingesting transcripts under ${mcdDir} (db: ${dbPath})`)

  const startedMs = Date.now()
  const r = await ingestOnce(mcdDir)
  if (r.skipped) {
    console.log('[backfill] skipped — another ingest pass was already in flight')
    return
  }
  const secs = ((Date.now() - startedMs) / 1000).toFixed(1)
  console.log(
    `[backfill] done in ${secs}s — files: ${r.files}, ingested: ${r.ingestedFiles}, ` +
      `turns: ${r.turns}, toolCalls: ${r.toolCalls}, truncations: ${r.truncations}`
  )
}

main().catch((err) => {
  console.error('[backfill] failed:', err)
  process.exit(1)
})
