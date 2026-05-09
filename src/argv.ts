/**
 * Tiny shell-like splitter for `!project ...` command lines.
 * Handles single- and double-quoted strings with backslash escapes.
 * No globbing, no env-var expansion, no command substitution — these run in
 * trusted-but-still-untrustworthy Discord chat, not in bash.
 */
export function splitArgv(line: string): string[] {
  const out: string[] = []
  let buf = ''
  let i = 0
  let quote: '"' | "'" | null = null

  while (i < line.length) {
    const ch = line[i]!

    if (quote) {
      if (ch === '\\' && i + 1 < line.length) {
        buf += line[i + 1]
        i += 2
        continue
      }
      if (ch === quote) {
        quote = null
        i++
        continue
      }
      buf += ch
      i++
      continue
    }

    if (ch === '"' || ch === "'") {
      quote = ch
      i++
      continue
    }

    if (ch === '\\' && i + 1 < line.length) {
      buf += line[i + 1]
      i += 2
      continue
    }

    if (/\s/.test(ch)) {
      if (buf.length > 0) {
        out.push(buf)
        buf = ''
      }
      i++
      continue
    }

    buf += ch
    i++
  }

  if (quote) throw new Error(`unterminated ${quote}-quoted string`)
  if (buf.length > 0) out.push(buf)
  return out
}

/**
 * Pull `--name value` / `--name=value` / `--bool` flags out of an argv tail,
 * returning {flags, positional}. Values are always strings; callers convert.
 */
export function parseFlags(tokens: string[]): { flags: Record<string, string | true>; positional: string[] } {
  const flags: Record<string, string | true> = {}
  const positional: string[] = []
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]!
    if (!tok.startsWith('--')) {
      positional.push(tok)
      continue
    }
    const eq = tok.indexOf('=')
    if (eq >= 0) {
      flags[tok.slice(2, eq)] = tok.slice(eq + 1)
      continue
    }
    const name = tok.slice(2)
    const next = tokens[i + 1]
    if (next === undefined || next.startsWith('--')) {
      flags[name] = true
    } else {
      flags[name] = next
      i++
    }
  }
  return { flags, positional }
}
