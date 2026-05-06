# eq cheatsheet

Reference for the `eq` CLI. The npm package is `entire-query`. **Default invocation is `npx -y entire-query …`** (no install required). Examples below write `eq …` for brevity; substitute `npx -y entire-query` (or `$EQ` after the detection block in `SKILL.md`) when running. Global install (`npm i -g entire-query`) is optional for users who run `eq` repeatedly — never required by the skill.

## Global

- `--repo <path>` — target Git repo (default: cwd; resolved to repo root)
- `--json` (single-document commands only) — emit compact one-line JSON to stdout (auto-enabled under AI agents). Rejected on JSONL commands (`checkpoint list`, `session list`, `transcript`)
- All commands return non-zero with `{"error":{"kind":"...","message":"...","hint":"..."}}` on stderr on failure

## Output modes

| Command                                 | Mode  | Stdout              |
| --------------------------------------- | ----- | ------------------- |
| `eq checkpoint <id>` / `--commit <sha>` | JSON  | one document        |
| `eq checkpoint list`                    | JSONL | one record per line |
| `eq session list`                       | JSONL | one record per line |
| `eq session get`                        | JSON  | one document        |
| `eq prompt`                             | JSON  | one document        |
| `eq transcript`                         | JSONL | one event per line  |

## Commands

### `eq checkpoint <id>`

Returns `Checkpoint` JSON for a single checkpoint id (12 hex chars).

### `eq checkpoint --commit <sha>`

Resolves the `Entire-Checkpoint:` trailer on the commit and returns the same `Checkpoint` JSON. Errors with `kind: "checkpoint/not-found"` if no trailer or no matching checkpoint.

### `eq checkpoint list [--file <path>]`

Streams checkpoints as NDJSON (one `Checkpoint` per line). With `--file <path>`, only checkpoints whose `files_touched` includes `<path>`. Pipe to `jq` for filtering, or `jq -s '.'` to collect into an array.

### `eq session list <checkpoint-id> [--file <path>]`

Streams `SessionSummary` records as NDJSON (one per line) for sessions under the checkpoint. `--file` filters to sessions whose own `files_touched` includes the path. Each record has:

- `index` — session index in the checkpoint (0, 1, ...)
- `session_id` — UUID
- `agent` — e.g. `"Claude Code"`, `"Cursor"`
- `model` — string or null
- `created_at` — ISO 8601
- `turn_count` — derived from `token_usage.api_call_count`
- `path` — branch-relative path to the session dir
- `prompt_preview` — first ~200 chars of `prompt.txt`

### `eq session get <checkpoint-id> --index <n>`

Returns full `Session` JSON: schema fields are checkpoint-level metadata + session-level `token_usage`, `initial_attribution`, `turn_id`, `transcript_identifier_at_start`, and `files` (paths to metadata/transcript/context/content_hash/prompt).

### `eq prompt <checkpoint-id> --session <n>`

Returns `prompt.txt` as a JSON string `{ "checkpoint_id": "...", "session_index": n, "session_id": "...", "prompt": "..." }`. Use this before opening a transcript.

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
