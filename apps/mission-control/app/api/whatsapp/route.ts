import * as fs from 'fs'
import * as path from 'path'

export const dynamic = 'force-dynamic'

export type WhatsAppStatus = 'connected' | 'pairing' | 'disconnected'

export interface WhatsAppResponse {
  enabled: boolean
  status: WhatsAppStatus
  projectCount: number
  lastMessageAt: string | null
}

function readJson<T>(filePath: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T
  } catch {
    return null
  }
}

function detectStatus(authDir: string): WhatsAppStatus {
  let files: string[] = []
  try {
    files = fs.readdirSync(authDir).filter((f) => !f.startsWith('.'))
  } catch {
    return 'disconnected'
  }
  if (files.length === 0) return 'pairing'
  // presence of creds file indicates authenticated session
  const hasCreds = files.some((f) => f.includes('creds') || f.includes('session'))
  return hasCreds ? 'connected' : 'pairing'
}

export async function GET(): Promise<Response> {
  const mcdDir = process.env.MCD_CHANNELS_DIR
  if (!mcdDir) {
    return Response.json({ enabled: false, status: 'disconnected', projectCount: 0, lastMessageAt: null } satisfies WhatsAppResponse)
  }

  const authDir = path.join(mcdDir, 'whatsapp-auth')
  const enabled = fs.existsSync(authDir) || process.env.WHATSAPP_ENABLED === '1'

  if (!enabled) {
    return Response.json({ enabled: false, status: 'disconnected', projectCount: 0, lastMessageAt: null } satisfies WhatsAppResponse)
  }

  const status = detectStatus(authDir)

  const channels = readJson<{
    projects?: Record<string, { slug?: string; platform?: string }>
  }>(path.join(mcdDir, 'channels.json'))

  let projectCount = 0
  if (channels?.projects) {
    for (const proj of Object.values(channels.projects)) {
      if (proj.platform === 'whatsapp') projectCount++
    }
  }

  return Response.json({
    enabled: true,
    status,
    projectCount,
    lastMessageAt: null,
  } satisfies WhatsAppResponse)
}
