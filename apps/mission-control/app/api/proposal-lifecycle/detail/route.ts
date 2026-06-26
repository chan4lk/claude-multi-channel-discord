import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { NextRequest } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest): Promise<Response> {
  const id = req.nextUrl.searchParams.get('id')
  if (!id) return Response.json({ error: 'missing id' }, { status: 400 })

  const parts = id.split('/')
  if (parts.length < 2) return Response.json({ error: 'invalid id' }, { status: 400 })

  const project = parts[0]!
  const changeName = parts.slice(1).join('/')

  const mcdDir =
    process.env.MCD_CHANNELS_DIR ??
    path.join(os.homedir(), '.claude', 'channels', 'discord-multi')

  let realPath = path.join(mcdDir, 'projects', project)
  try { realPath = fs.realpathSync(realPath) } catch {
    return Response.json({ error: 'project not found' }, { status: 404 })
  }

  const changeDir = path.join(realPath, '.specclaw', 'changes', changeName)

  let proposalContent = ''
  try {
    proposalContent = fs.readFileSync(path.join(changeDir, 'proposal.md'), 'utf-8')
  } catch {
    return Response.json({ error: 'proposal not found' }, { status: 404 })
  }

  let tasksContent: string | null = null
  try {
    tasksContent = fs.readFileSync(path.join(changeDir, 'tasks.md'), 'utf-8')
  } catch { /* no tasks */ }

  return Response.json({ proposal: proposalContent, tasks: tasksContent })
}
