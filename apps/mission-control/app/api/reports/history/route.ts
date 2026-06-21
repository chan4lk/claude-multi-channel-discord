import * as fs from 'fs'
import * as path from 'path'

export const dynamic = 'force-dynamic'

export interface SavedReport {
  fileName: string
  weekLabel: string
  generatedAt: string
  source: 'on-demand' | 'scheduled' | 'unknown'
  projectCount: number
  totalTurns: number
  totalCostUsd: number
}

export async function GET(): Promise<Response> {
  const mcdDir = process.env.MCD_CHANNELS_DIR
  if (!mcdDir) return Response.json({ reports: [] })

  const reportsDir = path.join(mcdDir, 'reports')
  let files: string[] = []
  try {
    files = fs.readdirSync(reportsDir).filter((f) => f.endsWith('.json')).sort().reverse()
  } catch {
    return Response.json({ reports: [] })
  }

  const reports: SavedReport[] = []
  for (const f of files.slice(0, 50)) {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(reportsDir, f), 'utf-8'))
      reports.push({
        fileName: f,
        weekLabel: raw.weekLabel ?? f.replace('.json', ''),
        generatedAt: raw.generatedAt ?? '',
        source: raw.source ?? 'scheduled',
        projectCount: raw.fleet?.projectCount ?? 0,
        totalTurns: raw.fleet?.totalTurns ?? 0,
        totalCostUsd: raw.fleet?.totalEstimatedCostUsd ?? 0,
      })
    } catch {}
  }

  return Response.json({ reports })
}
