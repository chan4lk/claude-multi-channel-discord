import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { execSync } from 'child_process'
import { NextRequest } from 'next/server'

export const dynamic = 'force-dynamic'

export interface ImpactStats {
  slug: string
  changeName: string
  commits: number
  filesChanged: number
  linesAdded: number
  linesDeleted: number
  toolCalls: number
  durationDays: number
  createdDate: string | null
}

function readFile(p: string): string | null {
  try { return fs.readFileSync(p, 'utf-8') } catch { return null }
}

function encodeProjectCwd(realPath: string): string {
  return realPath.replace(/[^a-zA-Z0-9]/g, '-')
}

function extractCreatedDate(proposalContent: string): string | null {
  const m = proposalContent.match(/\*\*Created:\*\*\s*(\d{4}-\d{2}-\d{2})/)
  if (m) return m[1]
  const m2 = proposalContent.match(/created[:\s]+(\d{4}-\d{2}-\d{2})/i)
  if (m2) return m2[1]
  return null
}

function countToolCalls(transcriptDir: string, afterMs: number): number {
  let count = 0
  try {
    const files = fs.readdirSync(transcriptDir).filter((f) => f.endsWith('.jsonl'))
    for (const file of files) {
      try {
        const stat = fs.statSync(path.join(transcriptDir, file))
        if (stat.mtimeMs < afterMs - 7 * 86400 * 1000) continue
        const raw = fs.readFileSync(path.join(transcriptDir, file), 'utf-8')
        for (const line of raw.split('\n')) {
          if (!line.trim()) continue
          try {
            const rec = JSON.parse(line)
            const ts = rec.timestamp ? new Date(rec.timestamp).getTime() : 0
            if (ts < afterMs) continue
            if (rec.type === 'assistant') {
              const content = rec.message?.content ?? []
              for (const block of content) {
                if (block.type === 'tool_use') count++
              }
            }
          } catch {}
        }
      } catch {}
    }
  } catch {}
  return count
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string; changeName: string }> }
): Promise<Response> {
  const { slug, changeName } = await params
  const mcdDir = process.env.MCD_CHANNELS_DIR
  if (!mcdDir) return Response.json({ error: 'MCD_CHANNELS_DIR not set' }, { status: 500 })

  const projectPath = path.join(mcdDir, 'projects', slug)
  let realDir = projectPath
  try { realDir = fs.realpathSync(projectPath) } catch {}

  const changeDir = path.join(realDir, '.specclaw', 'changes', changeName)
  if (!fs.existsSync(changeDir)) {
    return Response.json({ error: 'Change not found' }, { status: 404 })
  }

  const proposalContent = readFile(path.join(changeDir, 'proposal.md'))
  const createdDate = proposalContent ? extractCreatedDate(proposalContent) : null

  let commits = 0
  let filesChanged = 0
  let linesAdded = 0
  let linesDeleted = 0
  let toolCalls = 0
  let durationDays = 0

  if (createdDate) {
    const createdMs = new Date(createdDate).getTime()
    durationDays = Math.floor((Date.now() - createdMs) / 86400000)

    try {
      const logOut = execSync(
        `git -C ${JSON.stringify(realDir)} log --oneline --after=${JSON.stringify(createdDate)} 2>/dev/null`,
        { encoding: 'utf-8', timeout: 8000 }
      ).trim()
      commits = logOut ? logOut.split('\n').length : 0
    } catch {}

    try {
      const statOut = execSync(
        `git -C ${JSON.stringify(realDir)} log --after=${JSON.stringify(createdDate)} --numstat --format="" 2>/dev/null`,
        { encoding: 'utf-8', timeout: 8000 }
      ).trim()
      const statFiles = new Set<string>()
      for (const line of statOut.split('\n')) {
        const m = line.match(/^(\d+)\s+(\d+)\s+(.+)$/)
        if (!m) continue
        linesAdded += parseInt(m[1], 10)
        linesDeleted += parseInt(m[2], 10)
        statFiles.add(m[3])
      }
      filesChanged = statFiles.size
    } catch {}

    const encoded = encodeProjectCwd(realDir)
    const transcriptDir = path.join(os.homedir(), '.claude', 'projects', encoded)
    toolCalls = countToolCalls(transcriptDir, createdMs)
  }

  return Response.json({
    slug,
    changeName,
    commits,
    filesChanged,
    linesAdded,
    linesDeleted,
    toolCalls,
    durationDays,
    createdDate,
  } satisfies ImpactStats)
}
