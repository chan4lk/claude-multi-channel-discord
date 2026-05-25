import { execSync } from 'child_process'
import Database from 'better-sqlite3'
import { unlink } from 'fs/promises'

const DB_PATH = './e2e-test.db'

async function cleanupOld() {
  for (const f of [DB_PATH, `${DB_PATH}-shm`, `${DB_PATH}-wal`]) {
    await unlink(f).catch(() => {})
  }
}

export default async function globalSetup() {
  await cleanupOld()

  // Create auth tables (better-auth schema)
  const db = new Database(DB_PATH)
  db.exec(`
    PRAGMA journal_mode=WAL;

    CREATE TABLE IF NOT EXISTS user (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      emailVerified INTEGER NOT NULL DEFAULT 0,
      image TEXT,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS session (
      id TEXT PRIMARY KEY,
      expiresAt INTEGER NOT NULL,
      token TEXT NOT NULL UNIQUE,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL,
      ipAddress TEXT,
      userAgent TEXT,
      userId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS account (
      id TEXT PRIMARY KEY,
      accountId TEXT NOT NULL,
      providerId TEXT NOT NULL,
      userId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
      accessToken TEXT,
      refreshToken TEXT,
      idToken TEXT,
      accessTokenExpiresAt INTEGER,
      refreshTokenExpiresAt INTEGER,
      scope TEXT,
      password TEXT,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS verification (
      id TEXT PRIMARY KEY,
      identifier TEXT NOT NULL,
      value TEXT NOT NULL,
      expiresAt INTEGER NOT NULL,
      createdAt INTEGER,
      updatedAt INTEGER
    );
    CREATE TABLE IF NOT EXISTS instances (
      instance_id TEXT PRIMARY KEY,
      host TEXT NOT NULL,
      user TEXT NOT NULL,
      api_key TEXT NOT NULL,
      last_seen TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      instance_id TEXT NOT NULL,
      host TEXT NOT NULL,
      user TEXT NOT NULL,
      ts TEXT NOT NULL,
      type TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_session_userId ON session(userId);
    CREATE INDEX IF NOT EXISTS idx_session_token ON session(token);
    CREATE INDEX IF NOT EXISTS idx_account_userId ON account(userId);
    CREATE INDEX IF NOT EXISTS idx_events_instance ON events(instance_id);
    CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
    CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at);
  `)

  // Seed one instance
  const now = Math.floor(Date.now() / 1000)
  db.prepare(`
    INSERT OR IGNORE INTO instances (instance_id, host, user, api_key, last_seen, created_at)
    VALUES ('test-inst-001', 'test-host', 'testuser', 'test-api-key', datetime('now'), ?)
  `).run(now)

  // Seed two events
  db.prepare(`
    INSERT INTO events (instance_id, host, user, ts, type, payload, created_at)
    VALUES ('test-inst-001', 'test-host', 'testuser', datetime('now'), 'spawn', '{"msg":"seeded"}', ?)
  `).run(now)
  db.prepare(`
    INSERT INTO events (instance_id, host, user, ts, type, payload, created_at)
    VALUES ('test-inst-001', 'test-host', 'testuser', datetime('now'), 'reply', '{"msg":"seeded2"}', ?)
  `).run(now)

  db.close()

  // Seed admin user via the app's API (server must not be running yet — use direct better-auth)
  // We use execSync to call a small inline script that seeds the admin user
  execSync(
    `MC_DB_PATH=${DB_PATH} BETTER_AUTH_SECRET=e2e-test-secret-do-not-use-in-prod BETTER_AUTH_URL=http://localhost:3002 node -e "
const { betterAuth } = require('better-auth');
const Database = require('better-sqlite3');
const db = new Database('${DB_PATH}');
const auth = betterAuth({
  database: db,
  secret: 'e2e-test-secret-do-not-use-in-prod',
  baseURL: 'http://localhost:3002',
  emailAndPassword: { enabled: true },
});
auth.api.signUpEmail({ body: { name: 'Admin', email: 'admin@test.com', password: 'testpass123' } })
  .then(() => { console.log('Admin seeded'); process.exit(0); })
  .catch((e) => { console.error('Seed failed:', e.message); process.exit(0); });
"`,
    { stdio: 'inherit', cwd: process.cwd() }
  )
}
