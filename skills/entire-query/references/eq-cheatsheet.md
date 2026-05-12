# eq cheatsheet

Reference for the `eq` CLI. The npm package is `entire-query`. **Default invocation is `npx -y entire-query …`** (no install required). Examples below write `eq …` for brevity; substitute `npx -y entire-query` (or `$EQ` after the detection block in `SKILL.md`) when running. Global install (`npm i -g entire-query`) is optional for users who run `eq` repeatedly — never required by the skill.

## Global

- `--repo <path>` — target Git repo (default: cwd; resolved to repo root)
- `--json` (single-document commands only) — emit compact one-line JSON to stdout (auto-enabled under AI agents). Rejected on JSONL commands (`checkpoint list`, `session list`, `transcript`)
- All commands return non-zero on failure with `{"error":{"kind":"...","message":"...","hint":"..."}}` on **stderr** (both JSON and JSONL modes). `2>/dev/null` suppresses error output as expected; check exit code to detect failure.

## Output modes

| Command               | Mode  | Stdout              |
| --------------------- | ----- | ------------------- |
| `eq checkpoint <ref>` | JSON  | one document        |
| `eq checkpoint list`  | JSONL | one record per line |
| `eq session list`     | JSONL | one record per line |
| `eq session get`      | JSON  | one document        |
| `eq prompt`           | JSON  | one document        |
| `eq transcript`       | JSONL | one event per line  |

## Commands

### `eq checkpoint <ref>`

`<ref>` is **polymorphic**: a 12-hex string is treated as a checkpoint id; anything else is resolved as a git ref (commit SHA / branch / tag / `HEAD`) via the `Entire-Checkpoint:` trailer. Returns `Checkpoint` JSON either way. Errors with `kind: "checkpoint/not-found"` if the id is unknown, the ref is unresolvable, or the commit has no trailer.

```bash
eq checkpoint 04c6b0cd0999
eq checkpoint <commit-sha>
eq checkpoint HEAD
```

### `eq checkpoint list [--file <path>]`

Streams checkpoints as NDJSON (one `Checkpoint` per line). With `--file <path>`, only checkpoints whose `files_touched` includes `<path>`. Pipe to `jq` for filtering, or `jq -s '.'` to collect into an array.

### `eq session list <checkpoint-id> [--file <path>]`

Streams `SessionSummary` records as NDJSON (one per line) for sessions under the checkpoint. `--file` filters to sessions whose own `files_touched` includes the path. Each record has:

- `index` — session index in the checkpoint (0, 1, ...)
- `session_id` — UUID
- `agent` — e.g. `"Claude Code"`, `"Cursor"`, `"OpenCode"`, `"Codex"`, `"Copilot CLI"`, `"Gemini CLI"`, `"Factory AI Droid"`
- `model` — string or null
- `created_at` — ISO 8601
- `turn_count` — `session_metrics.turn_count` from the agent's hooks if reported, otherwise falls back to `token_usage.api_call_count`
- `path` — branch-relative path to the session dir
- `prompt_preview` — first ~200 chars of `prompt.txt`'s **first prompt** (prompt.txt may concatenate multiple turns separated by `\n\n---\n\n`; only the first is used for the preview)

### `eq session get <checkpoint-id> --index <n>`

Returns full `Session` JSON: checkpoint-level metadata + session-level `token_usage`, `session_metrics`, `initial_attribution`, `turn_id`, `transcript_identifier_at_start`, and `files` (paths to metadata/transcript/context/content_hash/prompt). `session_metrics` carries `turn_count` / `duration_ms` / `context_tokens` / `context_window_size` (each `null` when the agent does not report it; `turn_count` falls back to `api_call_count`). `token_usage.subagent_tokens` is recursive (Claude Code Task tool etc.); `null` when no subagents.

### `eq prompt <checkpoint-id> --session <n>`

Returns `prompt.txt` split on the Entire turn separator (`\n\n---\n\n`):

```json
{
  "checkpoint_id": "...",
  "session_index": 0,
  "session_id": "...",
  "prompts": ["first turn prompt", "second turn prompt"]
}
```

`prompts` is `null` when `prompt.txt` does not exist, `[]` when it exists but is empty. Use this before opening a transcript — often the prompt list alone answers the question.

### `eq transcript <checkpoint-id> --session <n>`

Streams `TranscriptEvent` records as NDJSON (one per line). Flags:

- `--role <user|assistant|tool|unknown>` — filter by role

`TranscriptEvent` shape:

```json
{
  "session_id": "...",
  "checkpoint_id": "...",
  "session_index": 0,
  "event_index": 0,
  "role": "user|assistant|tool|unknown",
  "kind": "message|tool|unknown",
  "subtype": "text|read|edit|bash|agent|unknown",
  "text": "...",
  "path": "repo/relative/path or null",
  "raw": { ...original jsonl line... }
}
```

## Error kinds

- `repo/not-found`, `repo/not-a-git-repository`
- `entire/branch-not-found` — the `entire/checkpoints/v1` ref is missing
- `checkpoint/not-found`, `session/not-found`, `transcript/not-found`
- `invalid-arguments` — bad flag combo or malformed id
- `parse-error` — corrupt metadata.json or full.jsonl line (event still surfaces with `_parse_error` in raw)
- `rune/unexpected` — wrapped unhandled exception (report verbatim)
