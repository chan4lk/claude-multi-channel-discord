import { execSync } from 'child_process'
import { NextRequest } from 'next/server'
import type { Workflow, WorkflowNode, WorkflowEdge } from '../workflows/route'

export const dynamic = 'force-dynamic'

export interface RunStepResult {
  nodeId: string
  slug: string
  text: string
  status: 'sent' | 'skipped' | 'error'
  error?: string
  sentAt: string
}

export interface RunResponse {
  ok: boolean
  steps: RunStepResult[]
  error?: string
}

function sessionName(slug: string): string {
  return `mcd-${slug}`
}

function sessionExists(name: string): boolean {
  try {
    execSync(`tmux has-session -t ${JSON.stringify(name)}`, { stdio: 'ignore', timeout: 3000 })
    return true
  } catch { return false }
}

function buildEnvelope(slug: string, text: string): string {
  const ts = new Date().toISOString()
  const msgId = `mc-canvas-${Date.now().toString(36)}`
  return `<channel source="mc-canvas" chat_id="${slug}" message_id="${msgId}" user="canvas" user_id="__mc_canvas__" ts="${ts}">${text}</channel>`
}

function injectToSlug(slug: string, text: string): void {
  const session = sessionName(slug)
  const envelope = buildEnvelope(slug, text)
  execSync(`tmux send-keys -t ${JSON.stringify(session)} -l ${JSON.stringify(envelope)}`, { stdio: 'ignore', timeout: 5000 })
  execSync(`tmux send-keys -t ${JSON.stringify(session)} C-m`, { stdio: 'ignore', timeout: 3000 })
}

// Topological sort (Kahn's algorithm)
function topoSort(nodes: WorkflowNode[], edges: WorkflowEdge[]): WorkflowNode[] | null {
  const inDegree = new Map<string, number>()
  const adj = new Map<string, string[]>()

  for (const n of nodes) { inDegree.set(n.id, 0); adj.set(n.id, []) }
  for (const e of edges) {
    adj.get(e.from)?.push(e.to)
    inDegree.set(e.to, (inDegree.get(e.to) ?? 0) + 1)
  }

  const queue: string[] = []
  for (const [id, deg] of inDegree) if (deg === 0) queue.push(id)

  const sorted: WorkflowNode[] = []
  while (queue.length > 0) {
    const id = queue.shift()!
    const node = nodes.find((n) => n.id === id)
    if (node) sorted.push(node)
    for (const nextId of (adj.get(id) ?? [])) {
      const deg = (inDegree.get(nextId) ?? 1) - 1
      inDegree.set(nextId, deg)
      if (deg === 0) queue.push(nextId)
    }
  }

  if (sorted.length !== nodes.length) return null // cycle detected
  return sorted
}

export async function POST(req: NextRequest): Promise<Response> {
  let workflow: Workflow
  try {
    workflow = await req.json() as Workflow
  } catch {
    return Response.json({ ok: false, steps: [], error: 'Invalid JSON' } satisfies RunResponse, { status: 400 })
  }

  const { nodes, edges } = workflow

  if (!nodes || nodes.length === 0) {
    return Response.json({ ok: false, steps: [], error: 'No nodes in workflow' } satisfies RunResponse, { status: 400 })
  }

  const order = topoSort(nodes, edges ?? [])
  if (!order) {
    return Response.json({ ok: false, steps: [], error: 'Cycle detected in workflow edges' } satisfies RunResponse, { status: 400 })
  }

  const steps: RunStepResult[] = []

  for (const node of order) {
    const text = node.triggerText?.trim()
    if (!text) {
      steps.push({ nodeId: node.id, slug: node.slug, text: '', status: 'skipped', sentAt: new Date().toISOString() })
      continue
    }

    const session = sessionName(node.slug)
    if (!sessionExists(session)) {
      steps.push({ nodeId: node.id, slug: node.slug, text, status: 'error', error: `No active session for "${node.slug}"`, sentAt: new Date().toISOString() })
      continue
    }

    try {
      injectToSlug(node.slug, text)
      steps.push({ nodeId: node.id, slug: node.slug, text, status: 'sent', sentAt: new Date().toISOString() })

      // Respect waitForReply edges: pause 2s per outgoing edge with waitForReply=true
      const waitEdges = (edges ?? []).filter((e) => e.from === node.id && e.waitForReply)
      if (waitEdges.length > 0) {
        await new Promise((r) => setTimeout(r, 2000))
      }
    } catch (err) {
      steps.push({ nodeId: node.id, slug: node.slug, text, status: 'error', error: String(err), sentAt: new Date().toISOString() })
    }
  }

  return Response.json({ ok: true, steps } satisfies RunResponse)
}
