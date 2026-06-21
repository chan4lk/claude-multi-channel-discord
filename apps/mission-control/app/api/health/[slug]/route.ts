import * as path from 'path'
import * as os from 'os'
import { NextRequest, NextResponse } from 'next/server'
import { computeHealth } from '../../../../lib/health'
import type { HealthScore } from '../../../../lib/health'

// Re-export HealthScore so existing imports
// (`import type { HealthScore } from '../app/api/health/[slug]/route'`)
// keep working. New code should import from `@/lib/health`.
export type { HealthScore }

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const mcdDir = process.env.MCD_CHANNELS_DIR ??
    path.join(os.homedir(), '.claude', 'channels', 'discord-multi')
  const { slug } = await params
  const result = computeHealth(slug, mcdDir)
  return NextResponse.json(result)
}
