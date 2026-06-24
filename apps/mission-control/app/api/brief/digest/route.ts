import { createHash } from 'crypto'
import { computeFindings, hasProjects, type Finding } from '../../../../lib/attention-findings'
import { getLastDigestHash, setLastDigestHash } from '../../../../src/db'

export const dynamic = 'force-dynamic'

export interface DigestResponse {
  changed: boolean // finding-id set differs from the last sent/committed digest
  hash: string // hash of the current critical+warn finding-id set
  markdown: string // Discord-ready Markdown summary
  critical: number
  warn: number
  findingCount: number // critical + warn
  allNominal: boolean
  committed: boolean // true when this call recorded the hash (POST / ?commit=1)
}

/** Public dashboard origin for absolute deep-links, falling back to the request. */
function baseUrl(req: Request): string {
  return (
    process.env.NEXT_PUBLIC_BETTER_AUTH_URL ||
    process.env.NEXTAUTH_URL ||
    new URL(req.url).origin
  ).replace(/\/$/, '')
}

function renderMarkdown(critical: Finding[], warn: Finding[], base: string): string {
  if (critical.length === 0 && warn.length === 0) {
    return '✅ **Fleet Brief** — all projects nominal. No critical or warning signals.'
  }
  const lines: string[] = ['**🛰️ Fleet Brief Digest**', '']
  const section = (label: string, emoji: string, items: Finding[]) => {
    if (items.length === 0) return
    lines.push(`${emoji} **${label}** (${items.length})`)
    for (const f of items) {
      const link = `${base}${f.href}`
      lines.push(`- **${f.slug}** — ${f.message} ([open](${link}))`)
    }
    lines.push('')
  }
  section('Critical', '🔴', critical)
  section('Warning', '🟡', warn)
  return lines.join('\n').trimEnd()
}

async function buildDigest(req: Request, commit: boolean): Promise<DigestResponse> {
  const mcdDir = process.env.MCD_CHANNELS_DIR
  const base = baseUrl(req)

  let findings: Finding[] = []
  if (mcdDir && hasProjects(mcdDir)) {
    findings = await computeFindings(mcdDir)
  }

  const critical = findings.filter((f) => f.severity === 'critical' && f.slug)
  const warn = findings.filter((f) => f.severity === 'warn' && f.slug)
  const allNominal = critical.length === 0 && warn.length === 0

  // Hash the stable, sorted finding-id set so an unchanged set yields the same
  // hash regardless of ordering. Empty set hashes to a fixed sentinel.
  const ids = [...critical, ...warn].map((f) => f.id).sort()
  const hash = createHash('sha1').update(ids.join('|') || 'nominal').digest('hex').slice(0, 16)

  const changed = hash !== getLastDigestHash()
  let committed = false
  if (commit) {
    setLastDigestHash(hash)
    committed = true
  }

  return {
    changed,
    hash,
    markdown: renderMarkdown(critical, warn, base),
    critical: critical.length,
    warn: warn.length,
    findingCount: critical.length + warn.length,
    allNominal,
    committed,
  }
}

// GET — pure preview: computes the digest and the `changed` flag without
// mutating the stored hash. Pass ?commit=1 to record the hash (idempotent).
export async function GET(req: Request): Promise<Response> {
  const commit = new URL(req.url).searchParams.get('commit') === '1'
  return Response.json(await buildDigest(req, commit))
}

// POST — compute and record the hash in one atomic call. Intended for the
// scheduler recipe: POST, then send `markdown` to Discord when `changed` is true.
export async function POST(req: Request): Promise<Response> {
  return Response.json(await buildDigest(req, true))
}
