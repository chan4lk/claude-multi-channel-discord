import * as fs from 'fs'
import * as path from 'path'

export const dynamic = 'force-dynamic'

export type ClaudeTemplateCategory = 'coding' | 'research' | 'review' | 'custom'

export interface ClaudeTemplate {
  id: string
  name: string
  description: string
  category: ClaudeTemplateCategory
  body: string
  readonly?: boolean
  createdAt: string
  updatedAt: string
}

interface TemplatesFile {
  templates: ClaudeTemplate[]
}

const VALID_CATEGORIES: ClaudeTemplateCategory[] = ['coding', 'research', 'review', 'custom']

const BUILT_IN_TEMPLATES: ClaudeTemplate[] = [
  {
    id: '__builtin_coding_agent',
    name: 'Coding Agent',
    description: 'General-purpose coding assistant with file editing, testing, and git support.',
    category: 'coding',
    readonly: true,
    body: `You are a coding assistant running inside a git repository.

## Capabilities
- Read and edit source files
- Run tests and build commands via Bash
- Commit and push changes
- Review diffs and explain code

## Guidelines
- Always read a file before editing it
- Run tests after changes
- Write clear commit messages
- Ask before destructive operations

When you receive a message, analyze the request, plan your approach, then execute.`,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  },
  {
    id: '__builtin_research_agent',
    name: 'Research Agent',
    description: 'Deep-research assistant that searches, synthesizes, and reports findings.',
    category: 'research',
    readonly: true,
    body: `You are a research assistant. Your goal is to produce accurate, well-sourced answers.

## Process
1. Break the question into sub-questions
2. Search multiple sources
3. Synthesize findings into a structured report
4. Flag uncertainty and conflicting information

## Output format
- Use headers and bullet points
- Cite sources inline
- Summarize key findings at the top

Be thorough. Prefer depth over speed.`,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  },
  {
    id: '__builtin_code_reviewer',
    name: 'Code Reviewer',
    description: 'Reviews PRs and diffs for bugs, security issues, and style problems.',
    category: 'review',
    readonly: true,
    body: `You are a code reviewer. Review diffs and pull requests critically.

## Review dimensions
- **Correctness**: bugs, off-by-one errors, null handling
- **Security**: injection, authentication, secrets in code
- **Performance**: N+1 queries, unnecessary allocations
- **Simplicity**: over-engineering, unnecessary abstractions
- **Tests**: missing coverage, flaky patterns

## Output format
One finding per line: \`path:line: <severity>: <problem>. <fix>.\`
Severity levels: BLOCK / WARN / NOTE

End with a verdict: APPROVED / CHANGES_REQUESTED / APPROVED_WITH_NOTES`,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  },
]

function templatesPath(): string | null {
  const mcdDir = process.env.MCD_CHANNELS_DIR
  if (!mcdDir) return null
  return path.join(mcdDir, 'claude-templates.json')
}

function readUserTemplates(): ClaudeTemplate[] {
  const p = templatesPath()
  if (!p) return []
  try {
    const data = JSON.parse(fs.readFileSync(p, 'utf-8')) as TemplatesFile
    return (data.templates ?? []).filter((t) => !t.id.startsWith('__builtin_'))
  } catch { return [] }
}

function writeUserTemplates(templates: ClaudeTemplate[]): void {
  const p = templatesPath()
  if (!p) return
  const tmp = `${p}.tmp`
  fs.writeFileSync(tmp, JSON.stringify({ templates }, null, 2), 'utf-8')
  fs.renameSync(tmp, p)
}

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const category = url.searchParams.get('category') as ClaudeTemplateCategory | null
  const userTemplates = readUserTemplates()
  let all = [...BUILT_IN_TEMPLATES, ...userTemplates]
  if (category && VALID_CATEGORIES.includes(category)) {
    all = all.filter((t) => t.category === category)
  }
  return Response.json({ templates: all })
}

export async function POST(req: Request): Promise<Response> {
  const body = await req.json() as Partial<ClaudeTemplate>
  if (!body.name?.trim() || !body.body?.trim()) {
    return Response.json({ error: 'name and body required' }, { status: 400 })
  }
  if (body.category && !VALID_CATEGORIES.includes(body.category)) {
    return Response.json({ error: 'invalid category' }, { status: 400 })
  }
  const templates = readUserTemplates()
  const now = new Date().toISOString()

  if (body.id && !body.id.startsWith('__builtin_')) {
    const idx = templates.findIndex((t) => t.id === body.id)
    if (idx !== -1) {
      templates[idx] = {
        ...templates[idx],
        name: body.name.trim(),
        description: (body.description ?? '').trim(),
        category: body.category ?? 'custom',
        body: body.body.trim(),
        updatedAt: now,
      }
      writeUserTemplates(templates)
      return Response.json({ template: templates[idx] })
    }
  }

  const newTemplate: ClaudeTemplate = {
    id: `tpl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name: body.name.trim(),
    description: (body.description ?? '').trim(),
    category: body.category ?? 'custom',
    body: body.body.trim(),
    createdAt: now,
    updatedAt: now,
  }
  templates.push(newTemplate)
  writeUserTemplates(templates)
  return Response.json({ template: newTemplate }, { status: 201 })
}

export async function DELETE(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const id = url.searchParams.get('id')
  if (!id) return Response.json({ error: 'id required' }, { status: 400 })
  if (id.startsWith('__builtin_')) return Response.json({ error: 'cannot delete built-in template' }, { status: 403 })
  const templates = readUserTemplates()
  const idx = templates.findIndex((t) => t.id === id)
  if (idx === -1) return Response.json({ error: 'not found' }, { status: 404 })
  templates.splice(idx, 1)
  writeUserTemplates(templates)
  return Response.json({ ok: true })
}
