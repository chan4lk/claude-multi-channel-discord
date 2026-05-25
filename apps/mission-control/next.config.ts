import type { NextConfig } from 'next'
import { seedAdminIfNeeded } from './src/seed-admin'

// Seed admin user on server startup (idempotent — no-op if users already exist)
seedAdminIfNeeded().catch(() => {})

const config: NextConfig = {
  serverExternalPackages: ['better-sqlite3'],
}
export default config
