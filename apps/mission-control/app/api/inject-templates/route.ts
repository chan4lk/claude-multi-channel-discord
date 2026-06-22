import * as fs from 'fs'
import * as path from 'path'

export const dynamic = 'force-dynamic'

export type TemplateCategory = 'standup' | 'review' | 'report' | 'custom'

export interface InjectTemplate {
  id: string
  name: string
  body: string
  category: TemplateCategory
  useCount: number
  lastUsed: string | null
  createdAt: string
  updatedAt: string
}

interface TemplatesFile {
  templates: InjectTemplate[]
}

function templatesPath(): string | null {
  const mcdDir = process.env.MCD_CHANNELS_DIR
  if (!mcdDir) return null
  return path.join(mcdDir, 'inject-templates.json')
}

function readTemplates(): InjectTemplate[] {
  const p = templatesPath()
  if (!p) return []
  try {
    const data = JSON.parse(fs.readFileSync(p, 'utf-8')) as TemplatesFile
    return data.templates ?? []
  } catch { return [] }
}

function writeTemplates(templates: InjectTemplate[]): void {
  const p = templatesPath()
  if (!p) return
  const tmp = `${p}.tmp`
  fs.writeFileSync(tmp, JSON.stringify({ templates }, null, 2), 'utf-8')
  fs.renameSync(tmp, p)
}

const VALID_CATEGORIES: TemplateCategory[] = ['standup', 'review', 'report', 'custom']

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const category = url.searchParams.get('category') as TemplateCategory | null
  let templates = readTemplates()
  if (category && VALID_CATEGORIES.includes(category)) {
    templates = templates.filter((t) => t.category === category)
  }
  // Sort by use count desc, then name
  templates.sort((a, b) => b.useCount - a.useCount || a.name.localeCompare(b.name))
  return Response.json({ templates })
}

export async function POST(req: Request): Promise<Response> {
  const mcdDir = process.env.MCD_CHANNELS_DIR
  if (!mcdDir) return Response.json({ error: 'MCD_CHANNELS_DIR not set' }, { status: 500 })

  let body: Partial<InjectTemplate> & { incrementUse?: boolean }
  try { body = await req.json() } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const templates = readTemplates()
  const now = new Date().toISOString()

  // Increment use count for existing template
  if (body.id && body.incrementUse) {
    const idx = templates.findIndex((t) => t.id === body.id)
    if (idx >= 0) {
      templates[idx] = { ...templates[idx], useCount: templates[idx].useCount + 1, lastUsed: now, updatedAt: now }
      writeTemplates(templates)
      return Response.json({ template: templates[idx] })
    }
  }

  if (!body.name || typeof body.name !== 'string') return Response.json({ error: 'name required' }, { status: 400 })
  if (!body.body || typeof body.body !== 'string') return Response.json({ error: 'body required' }, { status: 400 })

  const category: TemplateCategory = VALID_CATEGORIES.includes(body.category as TemplateCategory)
    ? (body.category as TemplateCategory)
    : 'custom'

  const id = body.id ?? `tpl-${Date.now().toString(36)}`
  const existing = templates.findIndex((t) => t.id === id)

  const template: InjectTemplate = {
    id,
    name: body.name.slice(0, 40),
    body: body.body.slice(0, 4000),
    category,
    useCount: existing >= 0 ? templates[existing].useCount : 0,
    lastUsed: existing >= 0 ? templates[existing].lastUsed : null,
    createdAt: existing >= 0 ? templates[existing].createdAt : now,
    updatedAt: now,
  }

  if (existing >= 0) templates[existing] = template
  else templates.push(template)

  writeTemplates(templates)
  return Response.json({ template })
}

export async function DELETE(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const id = url.searchParams.get('id')
  if (!id) return Response.json({ error: 'id required' }, { status: 400 })

  const templates = readTemplates().filter((t) => t.id !== id)
  writeTemplates(templates)
  return Response.json({ ok: true })
}
