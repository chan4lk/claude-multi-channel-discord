---
name: run-windows
description: Install, start, stop, check or troubleshoot MCD (multi-channel-discord) on native Windows without WSL or tmux — first-time setup, running it in the foreground or as a background scheduled task, reading its logs, and fixing "no reply in Discord". Use when the user wants to run, deploy, restart or debug the bot on Windows.
---

# Run MCD on native Windows

On win32, MCD uses the **headless backend**: each channel runs as
`claude -p --input-format stream-json --output-format stream-json` over
pipes instead of in a tmux pane (`src/claude-process.ts`,
`src/claude-bin.ts`). No WSL, tmux or Git Bash is needed. Background
reading: `docs/setup.md` → "Windows".

All commands below run from the repo root in PowerShell. Windows
PowerShell 5.1 is fine.

> **Never** kill processes by name (`taskkill /im claude.exe`,
> `Stop-Process -Name claude`, or a filter on `stream-json`). The Claude
> desktop app runs its own `claude.exe` sessions, and this conversation may
> be one of them. MCD's children are the `claude.exe` processes whose
> command line contains `mcd-<slug>-…\mcp-config.json`. To stop MCD, use the
> scripts below.
>
> If this session is itself running **inside** MCD (a project channel),
> don't stop or restart the bot. That ends your own session; see
> CLAUDE.md.

## 1. Check what's already done

Run these and skip the steps that are already satisfied:

```powershell
$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')
bun --version; git --version
Test-Path "$HOME\.claude\channels\discord-multi\.env"          # setup done?
Get-ScheduledTask multi-channel-discord -ErrorAction SilentlyContinue | Select TaskName, State
```

Check that the `claude` CLI is logged in. The headless backend uses
`MCD_CLAUDE_BIN`, then `claude.exe` on PATH, then the Claude desktop app's
bundled CLI. The app is MSIX-packaged, so outside the app that CLI lives
under `%LOCALAPPDATA%\Packages\Claude_*\LocalCache\Roaming\Claude\claude-code\<ver>\<hash>\claude.exe`.

```powershell
bun -e "import('./src/claude-bin.ts').then(m => console.log(m.resolveClaudeBin()))"
& (bun -e "import('./src/claude-bin.ts').then(m => console.log(m.resolveClaudeBin()))") auth status
```

## 2. First-time setup

1. **Tools:** `winget install --id Oven-sh.Bun -e --scope user` and
   `winget install --id Git.Git -e`. The Git installer asks for admin
   (UAC); the user approves it. Then run `bun install --no-summary`.
2. **Claude login:** `loggedIn: false` above means the user must sign in.
   Open a terminal tab and run the resolved `claude.exe` with `auth login`.
   The user finishes it in the browser. Never handle their credentials
   yourself.
3. **Discord bot:** the user does this in the Developer Portal. Create an
   application. On the Bot tab, enable **Message Content Intent**, then use
   **Reset Token**. Invite it with scope `bot` and View Channels, Send
   Messages, Send Messages in Threads, Read Message History, Add Reactions
   and Manage Channels. With Developer Mode on in Discord, copy their user
   ID and the master channel ID.
4. **State dir:** start the setup **in a terminal tab** so the user types
   the values there. Never ask for the bot token in chat.

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File .\bin\Setup-McdWindows.ps1
   ```

   It prompts for the user ID, the master channel ID and the token (hidden
   input). It writes `.env`, `access.json`, `channels.json` and
   `projects\master\CLAUDE.md` under
   `~\.claude\channels\discord-multi`, restricted to the current user. It
   refuses a non-empty state dir. Afterwards, confirm those files exist.

## 3. Run it

**Foreground**, for trying it out. Run it in a terminal tab so the user can
watch it and press Ctrl-C:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\bin\Start-Mcd.ps1
```

**Background**, a scheduled task that starts at logon, runs hidden as the
user, has no time limit and restarts on crash. It must run as the user,
not LocalSystem, because the claude login lives in their profile.
Registering it changes the machine's configuration, so get the user's
go-ahead first.

```powershell
powershell -ExecutionPolicy Bypass -File .\bin\Install-McdService.ps1           # register (no admin needed)
Start-ScheduledTask -TaskName multi-channel-discord                             # start now
powershell -ExecutionPolicy Bypass -File .\bin\Install-McdService.ps1 -Stop     # stop: kills bun + its claude children
powershell -ExecutionPolicy Bypass -File .\bin\Install-McdService.ps1 -Uninstall
```

Use `-Stop`, not `Stop-ScheduledTask`. The latter only ends the PowerShell
wrapper. `Start-Mcd.ps1` keeps the server pid in
`<StateDir>\mcd-server.pid` and kills any previous instance's process tree
before starting, so there is only ever one bot. Don't start a foreground
copy while the task is running, because the second start kills the first.

## 4. Verify

The background task logs to `~\.claude\channels\discord-multi\mcd.log`
(stderr; the previous run is kept as `mcd.log.1`). The foreground run
prints to the terminal. Healthy startup shows:

```
[mcp-master] listening on http://127.0.0.1:<port>/mcp/<chat_id>
discord channel: gateway connected as <BotName>#1234
```

Then have the user send `hi` in the master channel. A good round-trip logs
`route msg=… → pool`, `headless spawn: …claude.exe -p --input-format
stream-json…`, `deliver msg_id=…`, `session-id captured: …`,
`reply tool called for …` and `dispatch chat=… chunks=1`. The first reply
takes about 10–20 s while claude starts.

```powershell
Get-Content "$HOME\.claude\channels\discord-multi\mcd.log" -Wait -Tail 50
```

## 5. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `voice … @discordjs/opus native binary unavailable` | Expected. There's no Windows prebuild for this bun, so voice is off. Harmless. |
| `[memory-store] embedding pipeline init failed … sharp` | Expected. bun skips sharp's install script, so memory search is off. Harmless. |
| Reply is `⚠️ <slug>: Not logged in · Please run /login` | The claude CLI isn't logged in for this Windows user. Redo step 2.2. |
| `deliver() called on dead ClaudeProjectProcess` | The child failed to start. The line before it, `claude exited (code=…) — last output:`, has the reason. |
| `claude spawn failed (claude): … ENOENT` | No `claude.exe` was found. Set `MCD_CLAUDE_BIN` to its full path, or install Claude Code natively. A `claude.cmd` shim alone can't be spawned. |
| No reply and nothing logged after `route … → pool` | Check `!project list` works, then look for a `kill`/`watchdog` line. Inspect the session with `claude --resume <id>` in `projects\<slug>` (the id is in `.session-id`). |
| Two bots answering | A foreground run and the task are both running, or a pre-guard version left an orphan. Run `Install-McdService.ps1 -Stop`, then start one. |
| `refusing to overwrite non-empty …` from setup | The state dir already exists. Reuse it, or move it aside only if the user explicitly wants a fresh one. |

`!project usage` shows only pid and uptime on Windows. CPU and memory need
`/proc`.
