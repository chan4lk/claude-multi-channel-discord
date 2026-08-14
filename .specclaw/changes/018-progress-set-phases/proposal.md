# Proposal: progress --set phases — accept valid schema value

**Created:** 2026-07-18
**Status:** ✅ Approved (operator: backlog P309, build ordered 2026-07-18)

## Problem

`ProgressModeSchema` (`src/channels-config.ts:56`) includes `phases` as a valid enum value, but the `progress` verb's `--set` validator (`src/master-commands.ts:2016`) only allows `['off', 'edit', 'post']`. Running `!project progress <slug> --set phases` fails with `` `--set` must be one of: `off`, `edit`, `post` `` — the phases progress mode shipped in P308 is unreachable via master command; operators must hand-edit `channels.json`.

## Proposed Solution

- `src/master-commands.ts:2016`: add `'phases'` to the validator array and to the error message
- `src/master-commands.ts:242`: help text — `--set off|edit|post|phases`
- Test: `progress <slug> --set phases` round-trip in `src/master-commands.test.ts`

## Scope

### In Scope
- Validator array + error message + help text + tests

### Out of Scope
- Any change to phases progress mode behavior itself (shipped in P308)

## Impact

- **Files affected:** 2 — `src/master-commands.ts`, `src/master-commands.test.ts`
- **Complexity:** trivial
- **Risk:** none — widens validator to match existing schema
