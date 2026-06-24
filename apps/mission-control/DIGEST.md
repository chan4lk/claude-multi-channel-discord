# Fleet Brief Digest → Discord (P210)

The unified attention engine (P208) only surfaces findings when the operator
opens the dashboard. For an autonomous harness, critical/warning signals should
reach the master Discord channel proactively. `/api/brief/digest` renders the
current critical + warning findings as Discord-ready Markdown so a scheduled job
can push them to the master channel on a daily cadence.

## Endpoint

`GET /api/brief/digest`
- Computes the digest and the `changed` flag **without** mutating state (preview).
- Pass `?commit=1` to also record the current hash (idempotent).

`POST /api/brief/digest`
- Computes **and** records the hash in one atomic call.

Response shape (`DigestResponse`):

```jsonc
{
  "changed": true,          // finding-id set differs from the last committed digest
  "hash": "a1b2c3d4e5f6...", // hash of the sorted critical+warn finding-id set
  "markdown": "**🛰️ Fleet Brief Digest** ...", // Discord-ready Markdown, absolute deep-links
  "critical": 2,
  "warn": 3,
  "findingCount": 5,        // critical + warn
  "allNominal": false,      // true → no critical/warn signals
  "committed": true         // true when this call recorded the hash (POST / ?commit=1)
}
```

- **De-dupe guard:** `changed` compares the current finding-id set hash to the
  last committed hash (stored in the `digest_state` table). An unchanged set
  yields `changed: false`, so the scheduler can skip re-sending.
- **All-nominal:** when no critical/warn signals exist, `markdown` is an explicit
  `✅ Fleet Brief — all projects nominal.` line and `allNominal` is `true`.
  Send it (a reassuring daily heartbeat) or skip it — your choice.
- **Deep-links** are absolute, built from `NEXT_PUBLIC_BETTER_AUTH_URL` /
  `NEXTAUTH_URL`, falling back to the request origin.

## Daily master-channel recipe

Add a daily MCD schedule (`!project schedule add`) on the **master** channel with
a prompt like:

```
POST http://127.0.0.1:3000/api/brief/digest (the mission-control dashboard).
If the JSON response has "changed": true AND "findingCount" > 0, reply to this
channel with the "markdown" field verbatim. Otherwise reply nothing (or a short
"fleet nominal" note). Always call mcp__mcd__reply when you post.
```

Because `POST` commits the hash, the next day's run only re-sends when the
finding set actually changed — a stalled project stays surfaced once, not every
day, until its signal clears or a new one appears.

To preview without affecting the de-dupe state, use `GET /api/brief/digest`
(no `commit`). The dashboard itself never commits the hash on read.
