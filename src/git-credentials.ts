import { existsSync, readFileSync, statSync } from 'node:fs'
import { z } from 'zod'

import { credsFile } from './paths.ts'

const GithubPatSchema = z.object({
  type: z.literal('github-pat'),
  envVar: z.string().min(1),
})

const AzurePatSchema = z.object({
  type: z.literal('azure-pat'),
  envVar: z.string().min(1),
})

const SshKeySchema = z.object({
  type: z.literal('ssh-key'),
  keyPath: z.string().min(1),
})

const CredentialSchema = z.discriminatedUnion('type', [GithubPatSchema, AzurePatSchema, SshKeySchema])
export type Credential = z.infer<typeof CredentialSchema>

export const CredentialsFileSchema = z.record(z.string(), CredentialSchema)
export type CredentialsFile = z.infer<typeof CredentialsFileSchema>

export class CredentialsLookupError extends Error {}

export function loadCredentials(path: string = credsFile()): CredentialsFile {
  if (!existsSync(path)) return {}
  // Refuse to load if the file is world- or group-readable; PATs/keys live here.
  const mode = statSync(path).mode & 0o777
  if (mode & 0o077) {
    throw new CredentialsLookupError(
      `${path} has insecure mode ${mode.toString(8)}; chmod 0600 it before reuse`,
    )
  }
  const raw = readFileSync(path, 'utf8')
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    throw new CredentialsLookupError(`${path} is not valid JSON: ${(err as Error).message}`)
  }
  const result = CredentialsFileSchema.safeParse(parsed)
  if (!result.success) {
    throw new CredentialsLookupError(`${path} failed schema validation:\n${result.error.toString()}`)
  }
  return result.data
}

export function getCredential(creds: CredentialsFile, name: string): Credential {
  const cred = creds[name]
  if (!cred) {
    throw new CredentialsLookupError(`unknown credential alias "${name}" — defined in git-credentials.json?`)
  }
  return cred
}

/**
 * Resolve a credential to env-var assignments + setup notes. Token-bearing
 * credentials must already be available via the named env var; we never read
 * tokens from the JSON itself, only the alias for the env var.
 */
export function resolveCredentialEnv(cred: Credential): Record<string, string> {
  switch (cred.type) {
    case 'github-pat':
    case 'azure-pat': {
      const value = process.env[cred.envVar]
      if (!value) {
        throw new CredentialsLookupError(
          `credential ${cred.type} expects env var ${cred.envVar} to be set on the bot process`,
        )
      }
      return { [cred.envVar]: value }
    }
    case 'ssh-key': {
      const expanded = cred.keyPath.startsWith('~/')
        ? cred.keyPath.replace(/^~/, process.env.HOME ?? '')
        : cred.keyPath
      return {
        GIT_SSH_COMMAND: `ssh -i ${expanded} -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new`,
      }
    }
  }
}
