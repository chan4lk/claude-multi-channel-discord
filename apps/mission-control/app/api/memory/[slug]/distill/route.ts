import { spawn } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'

export const dynamic = 'force-dynamic'

const DISTILL_PROMPT =
  'Summarise the key facts, decisions, and open questions from this session into MEMORY.md ' +
  'in 500 words or less. Merge with any existing content — do not replace sections that are ' +
  'still relevant. Write only to MEMORY.md; output nothing else.'

const DISTILL_TIMEOUT_MS = 90_000

function slugOk(slug: string): boolean {
  return /^[a-z0-9_-]+$/i.test(slug) && slug.length <= 64
}

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> }
): Promise<Response> {
  const { slug } = await params
  if (!slugOk(slug)) return Response.json({ error: 'invalid slug' }, { status: 400 })

  const mcdDir = process.env.MCD_CHANNELS_DIR
  if (!mcdDir) return Response.json({ error: 'MCD_CHANNELS_DIR not set' }, { status: 500 })

  const projectDir = path.join(mcdDir, 'projects', slug)
  if (!fs.existsSync(projectDir)) return Response.json({ error: 'project not found' }, { status: 404 })

  const claudeBin = process.env.CLAUDE_BIN ?? 'claude'

  const result = await new Promise<{ ok: boolean; error?: string; durationMs: number }>((resolve) => {
    const start = Date.now()
    const child = spawn(claudeBin, ['-p', DISTILL_PROMPT, '--permission-mode', 'auto'], {
      cwd: projectDir,
      stdio: 'pipe',
      env: { ...process.env },
    })
    let stderr = ''
    child.stderr?.on('data', (d: Buffer) => { stderr += d.toString() })

    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      resolve({ ok: false, error: 'timeout', durationMs: Date.now() - start })
    }, DISTILL_TIMEOUT_MS)

    child.on('close', (code) => {
      clearTimeout(timer)
      const durationMs = Date.now() - start
      if (code === 0) {
        resolve({ ok: true, durationMs })
      } else {
        resolve({ ok: false, error: stderr.slice(0, 200).trim() || `exit ${code}`, durationMs })
      }
    })

    child.on('error', (err) => {
      clearTimeout(timer)
      resolve({ ok: false, error: err.message, durationMs: Date.now() - start })
    })
  })

  if (!result.ok) {
    return Response.json({ error: result.error, durationMs: result.durationMs }, { status: 500 })
  }

  const memPath = path.join(mcdDir, 'projects', slug, 'MEMORY.md')
  try {
    const content = fs.readFileSync(memPath, 'utf-8')
    const stat = fs.statSync(memPath)
    return Response.json({
      ok: true,
      durationMs: result.durationMs,
      content,
      sizeBytes: stat.size,
      lastModified: stat.mtime.toISOString(),
    })
  } catch {
    return Response.json({ ok: true, durationMs: result.durationMs })
  }
}
