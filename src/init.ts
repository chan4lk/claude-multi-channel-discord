#!/usr/bin/env bun
/**
 * Bootstrap script invoked by the `/discord:project init` skill.
 *
 *   bun src/init.ts \
 *     --master <chat_id> \
 *     --slug   <slug> \
 *     --prompt "<system prompt>" \
 *     [--model sonnet|opus|haiku]
 *
 * Side effects (all under MCD_CHANNELS_DIR or ~/.claude/channels/discord):
 *   1. mkdir -p projects/<slug>
 *   2. Write projects/<slug>/CLAUDE.md with the prompt
 *   3. Insert a project entry for <chat_id> into channels.json
 *   4. Set channels.json `master.chatId` to <chat_id>
 *
 * Idempotent for the master entry — re-running with the same args is a no-op
 * beyond updating timestamps. Existing CLAUDE.md content is preserved unless
 * --force-prompt is passed.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { argv, exit } from 'node:process'

import { loadConfig, saveConfig, SLUG_PATTERN } from './channels-config.ts'
import { CHANNELS_DIR, projectClaudeMd, projectDir } from './paths.ts'

interface Args {
  master?: string
  slug?: string
  prompt?: string
  model?: string
  forcePrompt: boolean
}

function parseArgs(raw: string[]): Args {
  const args: Args = { forcePrompt: false }
  for (let i = 0; i < raw.length; i++) {
    const flag = raw[i]
    switch (flag) {
      case '--master':
        args.master = raw[++i]
        break
      case '--slug':
        args.slug = raw[++i]
        break
      case '--prompt':
        args.prompt = raw[++i]
        break
      case '--model':
        args.model = raw[++i]
        break
      case '--force-prompt':
        args.forcePrompt = true
        break
      default:
        throw new Error(`unknown flag: ${flag}`)
    }
  }
  return args
}

function die(msg: string): never {
  console.error(`init: ${msg}`)
  exit(1)
}

async function main() {
  let args: Args
  try {
    args = parseArgs(argv.slice(2))
  } catch (err) {
    die((err as Error).message)
  }

  if (!args.master) die('--master <chat_id> is required')
  if (!args.slug) die('--slug <name> is required')
  if (!SLUG_PATTERN.test(args.slug)) {
    die(`slug "${args.slug}" must match ${SLUG_PATTERN}`)
  }

  const cfg = loadConfig()

  // Refuse if master already set to a different channel — re-pointing master is
  // a manual edit, not an init-time operation.
  if (cfg.master && cfg.master.chatId !== args.master) {
    die(
      `master is already set to chat_id ${cfg.master.chatId}; refusing to overwrite. ` +
        `Edit channels.json by hand if you really want to repoint it.`,
    )
  }

  // Slug must not collide with an existing project on a different chat_id.
  for (const [chatId, project] of Object.entries(cfg.projects)) {
    if (project.slug === args.slug && chatId !== args.master) {
      die(`slug "${args.slug}" is already used by chat_id ${chatId}`)
    }
  }

  const dir = projectDir(args.slug)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  mkdirSync(CHANNELS_DIR, { recursive: true, mode: 0o700 })

  const claudeMdPath = projectClaudeMd(args.slug)
  if (!existsSync(claudeMdPath) || args.forcePrompt) {
    if (!args.prompt) {
      die('--prompt is required on first init (or pass --force-prompt with new --prompt to overwrite)')
    }
    writeFileSync(claudeMdPath, `${args.prompt.trim()}\n`, { mode: 0o600 })
    console.log(`wrote ${claudeMdPath}`)
  } else {
    console.log(`kept existing ${claudeMdPath}`)
  }

  cfg.master = { chatId: args.master, commandPrefix: cfg.master?.commandPrefix ?? '!project' }
  cfg.projects[args.master] = {
    slug: args.slug,
    ...(args.model ? { model: args.model } : {}),
    ...(cfg.projects[args.master]?.git ? { git: cfg.projects[args.master].git } : {}),
  }

  saveConfig(cfg)
  console.log(`master channel set to ${args.master} (slug "${args.slug}")`)
  console.log(`channels.json updated.`)
}

main().catch((err) => die((err as Error).stack ?? (err as Error).message))
