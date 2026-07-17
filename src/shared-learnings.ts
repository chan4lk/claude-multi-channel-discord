/**
 * Shared learnings board — a markdown log shared across all project sessions.
 * File: <MCD_CHANNELS_DIR>/shared/learnings.md
 *
 * Entry format:
 *   - [2026-07-16T04:55:00.000Z claude-mcd] text about the thing #tag1 #tag2
 *
 * Constraints:
 *   - Entries over 2 KB are rejected.
 *   - File is capped at 64 KB; when exceeded, oldest entries are dropped.
 *   - Writes are atomic (tmp + rename).
 *   - Directory is created on first write (mkdir -p).
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { sharedLearningsPath } from './paths.ts'

const ENTRY_CAP_BYTES = 2 * 1024        // 2 KB
const FILE_CAP_BYTES  = 64 * 1024       // 64 KB

/**
 * Normalize a tag: strip leading `#`, lowercase, drop empties.
 */
function normalizeTag(raw: string): string {
  return raw.replace(/^#+/, '').toLowerCase().trim()
}

function normalizeTags(tags: string[]): string[] {
  return tags.map(normalizeTag).filter(Boolean)
}

/** Parse a single learnings.md line into its components, or null if invalid. */
function parseLine(line: string): { ts: string; slug: string; text: string; tags: string[] } | null {
  // Format: - [<ISO> <slug>] <text> #tag...
  const m = line.match(/^- \[([^\]]+?) ([^\]]+?)\] (.+)$/)
  if (!m) return null
  const ts   = m[1]
  const slug = m[2]
  const rest = m[3]
  // Extract trailing #tags (everything after the last non-tag word run)
  const tagMatches = rest.match(/#[^\s#]+/g) ?? []
  const tags = normalizeTags(tagMatches)
  // Text is rest minus the trailing tags
  const text = rest.replace(/(?: #[^\s#]+)+$/, '').trimEnd()
  return { ts, slug, text, tags }
}

/** Format a single entry line. */
function formatLine(ts: string, slug: string, text: string, tags: string[]): string {
  const normalized = normalizeTags(tags)
  const tagSuffix  = normalized.length ? ' ' + normalized.map(t => `#${t}`).join(' ') : ''
  return `- [${ts} ${slug}] ${text}${tagSuffix}`
}

/**
 * Append a learning entry to the shared board.
 * Throws if the entry (formatted) exceeds 2 KB.
 * Drops oldest entries to keep the file under 64 KB.
 * Write is atomic (tmp + rename). Directory is created if absent.
 */
export function appendLearning({
  slug,
  text,
  tags = [],
}: {
  slug: string
  text: string
  tags?: string[]
}): void {
  const ts   = new Date().toISOString()
  const line = formatLine(ts, slug, text, tags)

  if (Buffer.byteLength(line, 'utf8') > ENTRY_CAP_BYTES) {
    throw new Error(`Learning entry exceeds 2 KB limit (${Buffer.byteLength(line, 'utf8')} bytes). Shorten the text or tags.`)
  }

  const filePath = sharedLearningsPath()
  mkdirSync(dirname(filePath), { recursive: true })

  let existing = ''
  try {
    existing = readFileSync(filePath, 'utf8')
  } catch {
    // file doesn't exist yet — start fresh
  }

  const newEntry = line + '\n'
  let content    = existing + newEntry

  // Drop oldest entries until within cap
  while (Buffer.byteLength(content, 'utf8') > FILE_CAP_BYTES) {
    const firstNewline = content.indexOf('\n')
    if (firstNewline === -1) break  // single oversized line — can't shrink further
    content = content.slice(firstNewline + 1)
  }

  // Atomic write: write to tmp then rename
  const tmpPath = filePath + '.tmp'
  writeFileSync(tmpPath, content, 'utf8')
  renameSync(tmpPath, filePath)
}

export interface LearningEntry {
  ts: string
  slug: string
  text: string
  tags: string[]
}

/**
 * Read learnings from the shared board.
 * Returns entries newest-first, filtered by tags (AND semantics), up to `limit`.
 * If the file is absent, returns an empty list.
 */
export function readLearnings({
  tags,
  limit = 20,
}: {
  tags?: string[]
  limit?: number
} = {}): LearningEntry[] {
  const filePath = sharedLearningsPath()
  let raw = ''
  try {
    raw = readFileSync(filePath, 'utf8')
  } catch {
    return []
  }

  const filterTags = tags ? normalizeTags(tags) : []

  const entries: LearningEntry[] = []
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    const parsed = parseLine(line)
    if (!parsed) continue
    if (filterTags.length > 0) {
      const hasAll = filterTags.every(ft => parsed.tags.includes(ft))
      if (!hasAll) continue
    }
    entries.push(parsed)
  }

  // newest-first (lines are appended newest-last, so reverse)
  entries.reverse()

  return entries.slice(0, limit)
}
