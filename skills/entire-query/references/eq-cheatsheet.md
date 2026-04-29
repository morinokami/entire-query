# eq cheatsheet

Reference for the `eq` CLI. Load when an unfamiliar flag, schema field, or error `kind` appears.

## Global

- `--repo <path>` — target Git repo (default: cwd; resolved to repo root)
- `--json` — emit one-line JSON to stdout (auto-enabled under AI agents)
- All commands return non-zero with `{"error":{"kind":"...","message":"...","hint":"..."}}` on stderr on failure

## Commands

### `eq checkpoint <id>`
Returns `Checkpoint` JSON for a single checkpoint id (12 hex chars).

### `eq checkpoint --commit <sha>`
Resolves the `Entire-Checkpoint:` trailer on the commit and returns the same `Checkpoint` JSON. Errors with `kind: "checkpoint/not-found"` if no trailer or no matching checkpoint.

### `eq checkpoint list [--file <path>]`
Returns `Checkpoint[]`. With `--file <path>`, only checkpoints whose `files_touched` includes `<path>`. Use `--jsonl` for streaming.

### `eq session list <checkpoint-id> [--file <path>]`
Returns `SessionSummary[]` for sessions under the checkpoint. `--file` filters to sessions whose own `files_touched` includes the path. Each `SessionSummary` has:
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
Returns `TranscriptEvent[]`. Flags:
- `--role <user|assistant|tool|unknown>` — filter by role
- `--jsonl` — one event per line (cannot be combined with `--json`)

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
