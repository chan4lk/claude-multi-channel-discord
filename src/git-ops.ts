/**
 * Thin git wrappers used by master-channel verbs (`clone`, `pull`,
 * `remote`, `status`). All run synchronously via spawnSync so the master
 * command handler can await + return a text reply without juggling
 * streams. Output is captured for display.
 *
 * Credential plumbing is handled by buildGitEnv() — it resolves a
 * credential alias from git-credentials.json into env vars (GIT_ASKPASS
 * for PATs via a tiny helper, GIT_SSH_COMMAND for SSH keys). PATs are
 * NEVER embedded in URLs to avoid leaking into git config or remote logs.
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { resolveCredentialEnv, type Credential } from './git-credentials.ts'

export interface GitResult {
  ok: boolean
  stdout: string
  stderr: string
  code: number | null
}

/**
 * Build the env block a git/claude subprocess should inherit so authenticated
 * pushes work without leaking secrets. For PAT credentials we emit a small
 * GIT_ASKPASS script that prints the token; the token itself stays in the
 * process env, never on the command line. SSH credentials produce
 * GIT_SSH_COMMAND.
 *
 * Returns { env, cleanup } — cleanup() removes the tmp askpass script.
 */
export function buildGitEnv(credential: Credential | null, baseEnv = process.env): {
  env: NodeJS.ProcessEnv
  cleanup: () => void
} {
  const env: NodeJS.ProcessEnv = { ...baseEnv }
  if (!credential) return { env, cleanup: () => {} }

  const resolved = resolveCredentialEnv(credential)
  Object.assign(env, resolved)

  if (credential.type === 'github-pat' || credential.type === 'azure-pat') {
    // git invokes GIT_ASKPASS once for "Username for ..." and once for
    // "Password for ...". For HTTPS PATs:
    //   - GitHub: username can be anything (e.g. "x-access-token"), password is the PAT.
    //   - Azure DevOps: username is anything, password is the PAT.
    // The askpass helper detects which prompt it's answering via $1.
    const dir = mkdtempSync(join(tmpdir(), 'mcd-askpass-'))
    const helper = join(dir, 'askpass.sh')
    const script = [
      '#!/usr/bin/env bash',
      'case "$1" in',
      '  *Username*) echo "x-access-token";;',
      `  *)         echo "$${credential.envVar}";;`,
      'esac',
    ].join('\n')
    writeFileSync(helper, script, { mode: 0o700 })
    env.GIT_ASKPASS = helper
    env.GIT_TERMINAL_PROMPT = '0'
    return {
      env,
      cleanup: () => {
        try {
          spawnSync('rm', ['-rf', dir], { stdio: 'ignore' })
        } catch {}
      },
    }
  }

  return { env, cleanup: () => {} }
}

/** Run `git <args...>` in cwd with env and return captured output. */
export function runGit(cwd: string, args: string[], env: NodeJS.ProcessEnv = process.env): GitResult {
  const r = spawnSync('git', args, {
    cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return {
    ok: r.status === 0,
    stdout: r.stdout?.toString() ?? '',
    stderr: r.stderr?.toString() ?? '',
    code: r.status,
  }
}

/**
 * Clone a repo into target. Target's parent must exist; target itself
 * must NOT — git refuses to clone into a non-empty dir.
 */
export function gitClone(opts: {
  repo: string
  target: string
  branch?: string
  env?: NodeJS.ProcessEnv
}): GitResult {
  const args = ['clone']
  if (opts.branch) args.push('--branch', opts.branch)
  args.push(opts.repo, opts.target)
  // Run from /tmp; target is absolute and clone creates it.
  return runGit('/tmp', args, opts.env ?? process.env)
}

export function gitSetRemote(workingDir: string, name: string, url: string, env?: NodeJS.ProcessEnv): GitResult {
  return runGit(workingDir, ['remote', 'set-url', name, url], env ?? process.env)
}

export function gitPullFastForward(workingDir: string, branch?: string, env?: NodeJS.ProcessEnv): GitResult {
  const args = ['pull', '--ff-only']
  if (branch) args.push('origin', branch)
  return runGit(workingDir, args, env ?? process.env)
}

/**
 * Compact, chat-friendly snapshot of the working tree state. Returns
 * branch, ahead/behind vs upstream, and a count of dirty files.
 */
export function gitStatusSummary(workingDir: string): { ok: boolean; text: string } {
  const branch = runGit(workingDir, ['rev-parse', '--abbrev-ref', 'HEAD'])
  if (!branch.ok) return { ok: false, text: `git: not a working tree at ${workingDir}` }
  const branchName = branch.stdout.trim()

  const upstream = runGit(workingDir, ['rev-list', '--left-right', '--count', `${branchName}...@{upstream}`])
  let aheadBehind = '(no upstream)'
  if (upstream.ok) {
    const [ahead, behind] = upstream.stdout.trim().split(/\s+/).map((x) => Number(x) || 0)
    aheadBehind = `ahead ${ahead}, behind ${behind}`
  }

  const dirty = runGit(workingDir, ['status', '--porcelain'])
  const dirtyCount = dirty.stdout.split('\n').filter((l) => l.trim().length > 0).length

  return {
    ok: true,
    text: [`branch: \`${branchName}\``, `upstream: ${aheadBehind}`, `dirty files: ${dirtyCount}`].join(' · '),
  }
}
