import * as fs from 'fs'
import * as path from 'path'

export const dynamic = 'force-dynamic'

export interface WorkflowNode {
  id: string
  slug: string
  triggerText: string
  x: number
  y: number
}

export interface WorkflowEdge {
  id: string
  from: string // node id
  to: string   // node id
  waitForReply: boolean
}

export interface Workflow {
  id: string
  name: string
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
  createdAt: string
  updatedAt: string
}

export interface WorkflowsFile {
  workflows: Workflow[]
}

function workflowsPath(): string | null {
  const mcdDir = process.env.MCD_CHANNELS_DIR
  if (!mcdDir) return null
  return path.join(mcdDir, 'canvas-workflows.json')
}

function readWorkflows(): Workflow[] {
  const p = workflowsPath()
  if (!p) return []
  try {
    const data = JSON.parse(fs.readFileSync(p, 'utf-8')) as WorkflowsFile
    return data.workflows ?? []
  } catch { return [] }
}

function writeWorkflows(workflows: Workflow[]): void {
  const p = workflowsPath()
  if (!p) return
  const tmp = `${p}.tmp`
  fs.writeFileSync(tmp, JSON.stringify({ workflows }, null, 2), 'utf-8')
  fs.renameSync(tmp, p)
}

export async function GET(): Promise<Response> {
  return Response.json({ workflows: readWorkflows() })
}

export async function POST(req: Request): Promise<Response> {
  const mcdDir = process.env.MCD_CHANNELS_DIR
  if (!mcdDir) return Response.json({ error: 'MCD_CHANNELS_DIR not set' }, { status: 500 })

  let body: Partial<Workflow>
  try { body = await req.json() as Partial<Workflow> } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }) }

  if (!body.name || typeof body.name !== 'string') {
    return Response.json({ error: 'name required' }, { status: 400 })
  }

  const workflows = readWorkflows()
  const now = new Date().toISOString()
  const id = `wf-${Date.now().toString(36)}`

  const workflow: Workflow = {
    id: body.id && workflows.some((w) => w.id === body.id) ? body.id : id,
    name: body.name.slice(0, 60),
    nodes: Array.isArray(body.nodes) ? body.nodes : [],
    edges: Array.isArray(body.edges) ? body.edges : [],
    createdAt: body.createdAt ?? now,
    updatedAt: now,
  }

  // Upsert
  const idx = workflows.findIndex((w) => w.id === workflow.id)
  if (idx >= 0) workflows[idx] = workflow
  else workflows.push(workflow)

  writeWorkflows(workflows)
  return Response.json({ workflow })
}

export async function DELETE(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const id = url.searchParams.get('id')
  if (!id) return Response.json({ error: 'id required' }, { status: 400 })

  const workflows = readWorkflows().filter((w) => w.id !== id)
  writeWorkflows(workflows)
  return Response.json({ ok: true })
}
