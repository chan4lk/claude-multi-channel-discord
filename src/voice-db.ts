import { Database } from 'bun:sqlite'
import { join } from 'node:path'
import { channelsDir } from './paths.ts'

export interface VoiceTurnRow {
  chat_id: string
  guild_id: string
  user_id: string
  ts: string
  user_text: string
  bot_text: string
  duration_ms: number
}

let db: Database | null = null

function getDb(): Database {
  if (db) return db
  const path = join(channelsDir(), 'voice.db')
  db = new Database(path, { create: true })
  db.exec(`
    CREATE TABLE IF NOT EXISTS voice_turns (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id     TEXT    NOT NULL,
      guild_id    TEXT    NOT NULL,
      user_id     TEXT    NOT NULL,
      ts          TEXT    NOT NULL,
      user_text   TEXT    NOT NULL,
      bot_text    TEXT    NOT NULL,
      duration_ms INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS voice_turns_chat_ts ON voice_turns(chat_id, ts);
  `)
  return db
}

export function insertVoiceTurn(row: VoiceTurnRow): void {
  const d = getDb()
  d.prepare(
    `INSERT INTO voice_turns (chat_id, guild_id, user_id, ts, user_text, bot_text, duration_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(row.chat_id, row.guild_id, row.user_id, row.ts, row.user_text, row.bot_text, row.duration_ms)
}
