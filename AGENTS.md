# CLAUDE.md

`eq` (npm: `entire-query`) — a CLI that fetches [Entire](https://entire.io/) AI session history from Git as stable JSON/JSONL. See @README.md for user-facing docs.

## Stack

- TypeScript + **Rune** (`@rune-cli/rune`), file-based command routing under `src/commands/`.
- Package manager: **pnpm**. Node `>=22.12.0`.
- Tests: **vitest via `vite-plus`** (`pnpm test`, not `pnpm vitest`).

## Commands

- `vp run start <subcommand> [...args]` — run CLI without building (e.g. `vp run start checkpoint <id>`).
- `vp run build` — `rune build` → `dist/cli.mjs` (npm bin entry).
- `vp run test` — full vitest run. Prefer single-file: `vp run test tests/session.test.ts`.
- `vp run rune sync` — regenerate Rune types after adding/renaming commands.

## Architecture rules

- **One command per file** under `src/commands/`. Path = command path. Group folders use `_group.ts` (`defineGroup`).
- Commands MUST declare exactly one output mode: `json: true` (single document, `run()` returns data) or `jsonl: true` (stream, `run()` is `async *` yielding records). Never both. `--json` is auto-added to JSON commands and auto-rejected for JSONL.
- Non-routing code goes in `src/lib/`, NOT under `src/commands/` (Rune treats every `commands/*.ts` as a command).
- Global option `--repo` is defined in `rune.config.ts` and resolved into `locals.repo`. Commands MUST read the repo from `locals.repo`, not re-resolve it.
- All errors must be thrown via `CommandError` from `src/lib/errors.ts` with a stable `kind`. Don't `console.error` or `process.exit`.

## Project-specific gotchas

- **Read the Entire branch with `git show`**, never check it out. Use `gitShow` / `gitLsTree` from `src/lib/git.ts`. The branch is `entire/checkpoints/v1` (see `ENTIRE_BRANCH` in `src/lib/types.ts`).
- Entire stores paths with a leading `/`. **Always strip it** before emitting (`replace(/^\//, "")`). Output paths are branch-root-relative, never absolute.
- Checkpoint IDs are 12-hex; the directory layout is `<id[:2]>/<id[2:]>/`. Use helpers in `src/lib/paths.ts`.
- `eq checkpoint <ref>` is **polymorphic**: 12-hex → checkpoint id; anything else → git ref resolved via `Entire-Checkpoint` trailer. Do not reintroduce a `--commit` flag.
- `prompt.txt` is multi-turn, joined by `\n\n---\n\n`. `eq prompt` returns `prompts: string[]`. `SessionSummary.prompt_preview` is built from **only the first** prompt (200 chars, newlines→space, `…` on truncate).
- `token_usage.subagent_tokens` is **recursive** and uses presence-by-default (`null` when absent, not `omitempty`). Always go through `normalizeTokenUsage` in `src/lib/types.ts`.
- `SessionSummary.turn_count` / `Session.session_metrics.turn_count` fallback chain: `session_metrics.turn_count` → `token_usage.api_call_count` (if >0) → `null`. Both `session list` and `session get` must agree.
- Transcript normalization is intentionally lossy-tolerant: unknown rows fall back to `role/kind/subtype = "unknown"`, `text = ""`, and the original line is preserved in `raw`. Parse failures do **not** abort the stream.
- JSONL commands must stream via `async *` generators — do NOT buffer `full.jsonl` or the full checkpoint list into memory.

## Testing

- Use `runEq` from `tests/helpers.ts` (wraps Rune's `createRunCommand`). Don't shell out to the built binary in tests.
- Build fixture repos with helpers in `tests/fixtures.ts` (`mkdtemp` + `git init` + orphan `entire/checkpoints/v1`).
- Assert via the typed `result.output.document` (JSON) / `result.output.records` (JSONL) union, and `result.error.kind` for failures. Avoid asserting on raw stdout unless the test is specifically about formatting.

## Release

- Versioning via **Changesets** (`.changeset/`). When making a user-visible change, run `pnpm changeset` and commit the generated file; releases are tagged and published by CI.
- `package.json` `files` is `["dist"]` — never widen it without reason.
