# Transcript event interpretation

Load when you need to extract structured info from `eq transcript` output beyond the normalized fields. The normalized `text` / `kind` / `subtype` are conservative; the original payload is in `raw`.

## Two dialects

`full.jsonl` is recorded by the host agent, not by Entire. The two main dialects:

### Claude Code

Each row looks roughly like:

```json
{
  "parentUuid": "...",
  "sessionId": "...",
  "type": "user|assistant|progress|file-history-snapshot|...",
  "message": {
    "role": "user|assistant",
    "content": [
      { "type": "text", "text": "..." },
      { "type": "tool_use", "id": "...", "name": "Read|Edit|Bash|Task|...", "input": { ... } },
      { "type": "tool_result", "tool_use_id": "...", "content": [...], "is_error": true|false }
    ]
  }
}
```

Useful jq patterns:

```bash
# user text
.raw.message.content[]? | select(.type=="text") | .text

# tool calls (name + structured input)
.raw.message.content[]? | select(.type=="tool_use") | {name, input}

# tool errors
.raw.message.content[]? | select(.type=="tool_result" and .is_error==true)

# Specific tool — Read
.raw.message.content[]? | select(.type=="tool_use" and .name=="Read") | .input.file_path

# Specific tool — Edit
.raw.message.content[]? | select(.type=="tool_use" and .name=="Edit") | {file_path: .input.file_path, old: .input.old_string, new: .input.new_string}

# Specific tool — Bash
.raw.message.content[]? | select(.type=="tool_use" and .name=="Bash") | .input.command

# Specific tool — Task (subagent)
.raw.message.content[]? | select(.type=="tool_use" and .name=="Task") | {subagent_type: .input.subagent_type, description: .input.description}
```

### Cursor

Cursor's transcript fields differ: tool calls may appear as text-prefixed strings (`[Tool] Read: ...`) rather than structured `tool_use` objects. `eq transcript` heuristically maps these to `role: "tool"`, `kind: "tool"`, `subtype: "read|edit|bash|agent"` and extracts `path` when possible. For everything else, fall back to:

```bash
.raw  # inspect the original shape
```

Do not assume Claude Code structure is present — gate every Claude-Code-specific filter on:

```bash
select(.raw.message.content?)
```

## Noise rows to ignore

These appear interleaved and have no `role`. `eq transcript` normalizes them to `role: "unknown"`.

| `raw.type` | What it is | What to do |
|---|---|---|
| `file-history-snapshot` | Tracked-file backup snapshot | skip |
| `progress` (with `data.type == "hook_progress"`) | Hook execution progress | skip |
| `system` | Internal system event | skip unless debugging |

Filter at the source:

```bash
eq transcript ... --jsonl | jq 'select(.role != "unknown")'
```

Or use `--role assistant|user|tool` which already excludes them.

## Wrapped user prompts

Claude Code often wraps the human turn in `<user_query>...</user_query>`. `eq transcript` already unwraps this for `text`. If you need the wrapper preserved (rare), use `.raw.message.content[].text`.

## Guarantees and non-guarantees

- **Guaranteed**: `event_index` is stable and 0-based per session. `raw` is byte-faithful to the JSONL line. `session_id` and `checkpoint_id` are present on every event.
- **Best-effort**: `text`, `kind`, `subtype`, `path`. Treat these as hints; cite from `raw` when stakes are high (e.g. claiming "the agent ran command X").
- **Never inferred**: timestamps per-event (Entire stores them only on rows that include them in `raw`; do not invent ordering finer than `event_index`).
