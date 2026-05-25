import { unlink } from 'fs/promises'

const DB_PATH = './e2e-test.db'

export default async function globalTeardown() {
  for (const f of [DB_PATH, `${DB_PATH}-shm`, `${DB_PATH}-wal`]) {
    await unlink(f).catch(() => {})
  }
}
