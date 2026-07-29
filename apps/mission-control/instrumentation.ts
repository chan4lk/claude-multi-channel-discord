// Module-level flag: Next dev can invoke register() more than once per
// process — the ingester's own in-flight guard makes overlapping passes safe,
// but this prevents stacking multiple intervals.
let ingesterStarted = false

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { seedAdminIfNeeded } = await import('./src/seed-admin')
    seedAdminIfNeeded().catch(() => {})

    if (!ingesterStarted) {
      ingesterStarted = true
      try {
        const os = await import('os')
        const path = await import('path')
        const { ingestOnce } = await import('./src/fact-index')
        // Same resolution as the API routes (e.g. app/api/turn-duration/route.ts).
        const mcdDir =
          process.env.MCD_CHANNELS_DIR ??
          path.join(os.homedir(), '.claude', 'channels', 'discord-multi')
        const intervalMs =
          parseInt(process.env.INGEST_INTERVAL_MS ?? '', 10) || 30_000
        const run = () => {
          ingestOnce(mcdDir).catch((err) =>
            console.error('[fact-index] ingest pass failed:', err)
          )
        }
        run() // immediate background run at boot — first pass backfills
        setInterval(run, intervalMs).unref()
      } catch (err) {
        // Ingest is best-effort telemetry — never crash boot over it.
        ingesterStarted = false
        console.error('[fact-index] failed to start ingester:', err)
      }
    }
  }
}
