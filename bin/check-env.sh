#!/usr/bin/env bash
# Verify the multi-channel-discord install is wired up correctly.
# Checks the bot process env, on-disk config, credentials, and the
# tools the per-channel agents depend on. Exits 0 when all green,
# non-zero otherwise.
#
# Usage:
#   bin/check-env.sh                                    # checks the default state dir
#   MCD_CHANNELS_DIR=~/.claude/channels/foo bin/check-env.sh
set -u

STATE_DIR="${MCD_CHANNELS_DIR:-$HOME/.claude/channels/discord-multi}"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

PASS=0
FAIL=0
WARN=0

# Color when stdout is a TTY.
if [[ -t 1 ]]; then
  G=$'\033[32m'; R=$'\033[31m'; Y=$'\033[33m'; D=$'\033[0m'
else
  G=""; R=""; Y=""; D=""
fi

ok()   { printf '  %s✓%s %s\n' "$G" "$D" "$1"; PASS=$((PASS+1)); }
fail() { printf '  %s✗%s %s\n' "$R" "$D" "$1"; FAIL=$((FAIL+1)); }
warn() { printf '  %s!%s %s\n' "$Y" "$D" "$1"; WARN=$((WARN+1)); }
section() { printf '\n%s%s%s\n' "$G" "$1" "$D"; }

# ─── 1. tools on PATH ────────────────────────────────────────────────────
section "Tools on PATH"
for bin in bun claude tmux git gh python3 curl; do
  path=$(command -v "$bin" 2>/dev/null || true)
  if [[ -n "$path" ]]; then
    ok "$bin → $path"
  elif [[ "$bin" == "gh" ]]; then
    warn "$bin not found — agents won't be able to run \`gh pr create\` (git push still works)"
  else
    fail "$bin not on PATH"
  fi
done

# ─── 2. state-dir layout ─────────────────────────────────────────────────
section "State dir: $STATE_DIR"
[[ -d "$STATE_DIR" ]] && ok "exists" || { fail "missing — run bin/setup-new-instance.sh first"; FAIL=$((FAIL+1)); }
for f in .env access.json channels.json; do
  if [[ -r "$STATE_DIR/$f" ]]; then
    mode=$(stat -c '%a' "$STATE_DIR/$f" 2>/dev/null || stat -f '%A' "$STATE_DIR/$f" 2>/dev/null)
    if [[ "$mode" == "600" || "$mode" == "0600" ]]; then
      ok "$f present (mode 0600)"
    else
      warn "$f present but mode is $mode (expected 0600 — chmod 0600 \"$STATE_DIR/$f\")"
    fi
  else
    fail "$f missing"
  fi
done

# ─── 3. bot process ──────────────────────────────────────────────────────
section "Bot process"
# Portable PID lookup: pgrep exists on both Linux and macOS. /proc-based cwd
# detection doesn't work on macOS, so use `lsof -d cwd` (Linux + macOS) for
# the working-directory match and `ps -o command=` for the command line.
get_pid_cwd() {
  # Linux fast path
  if [[ -L "/proc/$1/cwd" ]]; then
    readlink "/proc/$1/cwd" 2>/dev/null
    return
  fi
  # macOS / BSD fallback
  lsof -a -p "$1" -d cwd -Fn 2>/dev/null | awk '/^n/ {print substr($0,2); exit}'
}
get_pid_cmd() {
  ps -p "$1" -o command= 2>/dev/null
}
BOT_PID=""
# Match the bot's exact invocation ("bun server.ts" — relative). Other bun
# processes (Lucid: `bun run /path/server.ts`, MCP shims, etc.) don't have
# that substring, so this is a tight enough filter on its own. The cwd
# check stays as a tiebreaker for multi-repo installs.
for pid in $(pgrep -f 'bun server.ts' 2>/dev/null); do
  cwd=$(get_pid_cwd "$pid")
  cmd=$(get_pid_cmd "$pid")
  if [[ "$cwd" == "$REPO_DIR" ]] && [[ "$cmd" == *"bun server.ts"* ]]; then
    BOT_PID="$pid"
    break
  fi
done
if [[ -n "$BOT_PID" ]]; then
  uptime=$(ps -o etime= -p "$BOT_PID" 2>/dev/null | tr -d ' ' || echo "?")
  # RSS via `ps -o rss=` is portable (kB on both Linux and macOS).
  rss=$(ps -o rss= -p "$BOT_PID" 2>/dev/null | tr -d ' ' || echo "?")
  ok "running (pid=$BOT_PID, uptime=$uptime, RSS=${rss}kB)"
  # Portable listening-port lookup. `ss` is Linux-only; lsof works everywhere.
  port=""
  if command -v lsof >/dev/null 2>&1; then
    port=$(lsof -nP -iTCP -sTCP:LISTEN -a -p "$BOT_PID" 2>/dev/null \
      | awk 'NR>1 {n=split($9,a,":"); print a[n]; exit}')
  fi
  if [[ -z "$port" ]] && command -v ss >/dev/null 2>&1; then
    port=$(ss -tlnp 2>/dev/null | awk -v pid="$BOT_PID" '$0 ~ "pid="pid {gsub(/.*:/, "", $4); print $4; exit}')
  fi
  if [[ -n "$port" ]]; then
    ok "MCP master listening on 127.0.0.1:$port"
    code=$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
      -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"check","version":"0"}}}' \
      "http://127.0.0.1:$port/mcp/000000000000000000" 2>/dev/null || echo "0")
    if [[ "$code" == "2"* || "$code" == "200" ]]; then
      ok "MCP initialize → HTTP $code"
    else
      warn "MCP initialize → HTTP $code (expected 2xx)"
    fi
  else
    warn "no listening port detected (bot may still be booting)"
  fi
else
  fail "not running — start with: MCD_CHANNELS_DIR=$STATE_DIR bun $REPO_DIR/server.ts"
fi

# ─── 4. bot env: tokens + provider keys ──────────────────────────────────
section "Bot process environment"
# server.ts loads $STATE_DIR/.env into its in-process env at boot, so the
# runtime variables a project spawn sees are the UNION of (parent spawn
# env) + (lines in .env). We can't see in-process additions via /proc, so
# fall back to scanning .env when the var isn't in the spawn env.
read_bot_env() {
  local var="$1"
  # Linux: read the live spawn env from /proc. macOS doesn't expose /proc;
  # `ps eww` shows env but only for the calling user's processes and is
  # truncated, so we don't rely on it. Fall back to scanning .env (which
  # server.ts loads into its in-process env at boot) — same source of truth.
  if [[ -n "$BOT_PID" ]] && [[ -r "/proc/$BOT_PID/environ" ]]; then
    if tr '\0' '\n' < "/proc/$BOT_PID/environ" 2>/dev/null | grep -q "^${var}="; then
      return 0
    fi
  fi
  if [[ -r "$STATE_DIR/.env" ]]; then
    grep -qE "^[[:space:]]*(export[[:space:]]+)?${var}=" "$STATE_DIR/.env" && return 0
  fi
  return 1
}
if [[ -n "$BOT_PID" ]]; then
  if read_bot_env DISCORD_BOT_TOKEN; then
    ok "DISCORD_BOT_TOKEN present (in spawn env or $STATE_DIR/.env)"
  else
    fail "DISCORD_BOT_TOKEN not found — add it to $STATE_DIR/.env (mode 0600) or to the bot's spawn env"
  fi
else
  warn "skipping env checks — bot not running"
fi

# Each provider's apiKeyEnv must resolve.
if [[ -r "$STATE_DIR/channels.json" ]]; then
  PROVIDER_KEYS=$(python3 -c '
import json, sys
try:
    cfg = json.load(open(sys.argv[1]))
except Exception as e:
    print("ERR " + str(e)); sys.exit(0)
ps = (cfg.get("defaults") or {}).get("providers") or {}
for alias, p in ps.items():
    print(alias + "\t" + (p.get("apiKeyEnv") or "") + "\t" + (p.get("baseUrl") or ""))
' "$STATE_DIR/channels.json")
  if [[ "$PROVIDER_KEYS" == ERR* ]]; then
    fail "channels.json parse: $PROVIDER_KEYS"
  elif [[ -z "$PROVIDER_KEYS" ]]; then
    warn "no providers configured (defaults.providers is empty — bot uses Claude subscription only)"
  else
    while IFS=$'\t' read -r alias env_var url; do
      [[ -z "$alias" ]] && continue
      if [[ -n "$BOT_PID" ]] && read_bot_env "$env_var"; then
        ok "provider \"$alias\": \$$env_var present (→ $url)"
      else
        fail "provider \"$alias\" needs \$$env_var on the bot process — currently missing"
      fi
    done <<< "$PROVIDER_KEYS"
  fi
fi

# ─── 5. git-credentials.json ─────────────────────────────────────────────
section "Git credentials"
GC="$STATE_DIR/git-credentials.json"
if [[ -r "$GC" ]]; then
  mode=$(stat -c '%a' "$GC" 2>/dev/null || stat -f '%A' "$GC" 2>/dev/null)
  if [[ "$mode" != "600" && "$mode" != "0600" ]]; then
    warn "$GC mode is $mode (expected 0600)"
  fi
  CREDS=$(python3 -c '
import json, sys
try:
    creds = json.load(open(sys.argv[1]))
except Exception as e:
    print("ERR " + str(e)); sys.exit(0)
for alias, c in creds.items():
    t = c.get("type", "")
    if t in ("github-pat", "azure-pat"):
        print(alias + "\t" + t + "\t" + (c.get("envVar") or ""))
    elif t == "ssh-key":
        print(alias + "\t" + t + "\t" + (c.get("keyPath") or ""))
    else:
        print(alias + "\t" + t + "\t?")
' "$GC")
  if [[ "$CREDS" == ERR* ]]; then
    fail "git-credentials.json parse: $CREDS"
  else
    while IFS=$'\t' read -r alias type detail; do
      [[ -z "$alias" ]] && continue
      case "$type" in
        github-pat|azure-pat)
          if [[ -n "$BOT_PID" ]] && read_bot_env "$detail"; then
            ok "$alias ($type): \$$detail present"
          else
            fail "$alias ($type) needs \$$detail on the bot process"
          fi ;;
        ssh-key)
          # Expand ~
          path="${detail/#\~/$HOME}"
          if [[ -r "$path" ]]; then
            ok "$alias (ssh-key): $path readable"
          else
            fail "$alias (ssh-key) keyPath not readable: $path"
          fi ;;
        *)
          warn "$alias has unknown type \"$type\"" ;;
      esac
    done <<< "$CREDS"
  fi
else
  warn "no git-credentials.json — agents won't be able to push to remotes"
fi

# ─── 6. tmux pool sessions ───────────────────────────────────────────────
section "Project subprocesses (tmux mcd-*)"
SESSIONS=$(tmux ls 2>/dev/null | grep -E '^mcd-' | cut -d: -f1)
if [[ -z "$SESSIONS" ]]; then
  warn "no project tmux sessions running (lazy-spawn — they appear on first message)"
else
  while read -r s; do
    [[ -z "$s" ]] && continue
    pane_pid=$(tmux display-message -p -t "$s" '#{pane_pid}' 2>/dev/null || echo "?")
    ok "$s (pane_pid=$pane_pid)"
  done <<< "$SESSIONS"
fi

# ─── 7. summary ──────────────────────────────────────────────────────────
section "Summary"
printf "  %d ok · %d warnings · %d failures\n" "$PASS" "$WARN" "$FAIL"
if [[ $FAIL -gt 0 ]]; then
  exit 1
fi
exit 0
