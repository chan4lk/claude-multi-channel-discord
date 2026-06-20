import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { readFileSync } from 'node:fs'

export interface R2Config {
  bucket: string
  endpoint: string
  accessKeyId: string
  secretAccessKey: string
}

/**
 * Upload raw memory.db to R2. Returns the uploaded key on success.
 * Returns '' when config is null (no-op). Throws on upload failure.
 */
export async function backupMemory(config: R2Config | null, dbPath: string): Promise<string> {
  if (!config) return ''

  const client = new S3Client({
    region: 'auto',
    endpoint: config.endpoint,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  })

  const body = readFileSync(dbPath)
  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  const timedKey = `memory-backups/memory-${ts}.db`
  const latestKey = 'memory-backups/latest.db'

  await client.send(new PutObjectCommand({
    Bucket: config.bucket,
    Key: timedKey,
    Body: body,
    ContentType: 'application/octet-stream',
  }))

  await client.send(new PutObjectCommand({
    Bucket: config.bucket,
    Key: latestKey,
    Body: body,
    ContentType: 'application/octet-stream',
  }))

  return timedKey
}
