---
name: entire-query
description: Query a repository's AI session history (Entire checkpoints, sessions, transcripts) via the `eq` CLI to answer questions about why code was written a certain way, what alternatives were explored, when and by which agent something was added, how many tokens a feature consumed, how much of a file was AI-generated, what tools or skills were used, and how to reproduce a past session. Use when the user asks about implementation history, intent, reasoning, prior work, AI/agent attribution, token cost, skill-firing audits, Bash command audits, or session reproduction in a repository that uses Entire (https://entire.io). Trigger words include "why", "how come", "when", "who", "history", "intent", "rationale", "previously", "past", "cost", "tokens", "attribution", "agent-written", "skill firing", and the equivalent terms in the user's language. Skip when the question is about current code behavior, future plans, or pure Git operations unrelated to AI sessions.
---

# entire-query

Tools and procedures for answering questions about a repository's AI session history. The repository stores Entire checkpoints on the `entire/checkpoints/v1` branch and links them to commits via an `Entire-Checkpoint: <id>` Git trailer. The `eq` CLI exposes that data as stable JSON / JSONL so you can compose answers with `jq`.

## Invoking `eq`

The CLI binary is `eq`; the npm package is `entire-query`. **No installation required** — run it through `npx`:

```bash
npx -y entire-query <subcommand> [args...]
```

The first call fetches the package over the network (a few seconds) and caches it; subsequent calls within the npm cache window are fast. This is the path you should default to — never ask the user to globally install anything just to use this skill.

Optional: if `eq` is already on `PATH` (the user has done `npm i -g entire-query` / `pnpm add -g entire-query` / `bun add -g entire-query` themselves), use it directly. Detect at runtime and pick the shorter form:

```bash
command -v eq >/dev/null 2>&1 && EQ="eq" || EQ="npx -y entire-query"
```

Then prefix invocations with `$EQ` (e.g. `$EQ checkpoint --commit <sha>`). Examples below write `eq …` for brevity — substitute `$EQ` (or `npx -y entire-query` directly) in your actual commands. **Do not run a bare `eq …` without first verifying that `command -v eq` succeeds**; on a fresh machine it will fail with `command not found` and you'll have to redo the call with `npx -y entire-query …`.

Pitfall: `npx eq` (without `entire-query`) fetches an unrelated package of the same name. The package name is **always** `entire-query`.

## When to activate

Activate on questions about **the past**: why code is shaped this way, what was considered, when/who/which-agent did it, how much it cost, whether a skill or tool was used as expected.

Do **not** activate when:

- The user asks how the current code works ("explain this function") — read the code instead
- The user asks about future plans or design proposals
- The question is a pure Git operation ("what commits are on this branch") that doesn't need session content
- The repo doesn't use Entire (no `entire/checkpoints/v1` ref → fall back to honest "no AI history available")

Run this preflight before doing anything else:

```bash
git rev-parse --verify entire/checkpoints/v1 >/dev/null 2>&1 || echo "no entire history"
```

If that prints "no entire history", say so and stop. Do not fabricate.

## Why `eq` and not `entire explain`

`entire explain` returns an AI-summarized text answer. That hides the primary sources from you and prevents quoting / cross-referencing. Use `eq` for everything in this skill — it returns raw structured data so **you** do the reasoning and cite specific sessions. Only fall back to `entire explain --raw-transcript` if `eq` itself is unavailable.

## Core workflow (universal)

Every question follows this shape. Skip steps that are irrelevant.

1. **Anchor**: turn the user's question into one of `commit SHA`, `file path`, `file:line`, or free text
2. **Resolve to checkpoint(s)**: use `eq checkpoint --commit` (best), or `eq checkpoint list --file <path>` (file-anchored), or `eq checkpoint list` + filter (free text)
3. **Triage sessions cheaply**: `eq session list <id>` returns `agent`, `created_at`, `turn_count`, `prompt_preview`, `files_touched`. Pick the smallest plausible set before opening any transcript
4. **Read prompt before transcript**: `eq prompt <id> --session <n>` is one short file. Often it answers the question on its own
5. **Open transcripts last** and filtered: `eq transcript <id> --session <n> --role user|assistant|tool` (NDJSON, pipe to `jq` for analytics)
6. **Cite primary sources**: every claim names `checkpoint_id` and `session_id` (and `event_index` if quoting an exchange)

**Cost discipline:** transcripts can be large. Never run `eq transcript ...` without `--role` or `| jq 'select(...)'` first unless the session has fewer than ~50 events. Always start from `eq session list` and `eq prompt`.

## Decision tree

| User input contains                | First move                                                                            |
| ---------------------------------- | ------------------------------------------------------------------------------------- |
| commit SHA / `git blame` mentions  | `eq checkpoint --commit <sha>`                                                        |
| file path / `path:line`            | `eq checkpoint list --file <path>` then triage by `created_at`                        |
| feature name, free text            | `eq checkpoint list \| jq 'select(.files_touched[] \| contains("..."))'`              |
| "PR" / "this branch"               | `git log --grep='Entire-Checkpoint:' <range>` → trailer → `eq checkpoint --commit`    |
| Token / cost question              | Anchor as above, then aggregate via `\| jq -s` (see [recipes](references/recipes.md)) |
| "Did skill X fire?" / "Bash audit" | Anchor → `eq transcript ... \| jq` filter (see [recipes](references/recipes.md))      |

## Output modes (important)

- **JSON commands** (one document on stdout): `eq checkpoint`, `eq session get`, `eq prompt`
- **JSONL commands** (one record per line on stdout): `eq checkpoint list`, `eq session list`, `eq transcript`

JSONL commands have **no `--jsonl` flag** — NDJSON is their only output. Pipe directly to `jq` line-by-line, or use `jq -s '.'` to collect into an array. Passing `--json` to a JSONL command is rejected with `rune/invalid-arguments`.

## eq commands you will use

See [eq-cheatsheet.md](references/eq-cheatsheet.md) for the full reference. The five you'll reach for most:

```bash
eq checkpoint --commit <sha>                  # → one Checkpoint JSON document
eq checkpoint list --file <path>              # → NDJSON of Checkpoints touching <path>
eq session list <checkpoint-id>               # → NDJSON of SessionSummary (with prompt_preview)
eq prompt <checkpoint-id> --session <n>       # → one prompt JSON document
eq transcript <checkpoint-id> --session <n> --role <user|assistant|tool>   # → NDJSON of TranscriptEvent
```

Every command supports `--repo <path>` (defaults to cwd). JSON commands also accept `--json` (auto-enabled under agents) for compact output. Errors come back as `{"error":{"kind":"...","message":"...","hint":"..."}}` on stderr with non-zero exit; check `kind` (e.g. `checkpoint/not-found`) before retrying.

## Recipes by question type

Inline below are the four highest-frequency recipes. For others (cost aggregation, attribution, skill-firing audit, Bash audit, session reproduction), load [references/recipes.md](references/recipes.md).

### "Why was this implemented this way?" (file:line → narrative)

```bash
SHA=$(git blame -L <LINE>,<LINE> -- <FILE> | awk '{print $1}')
CKPT=$(eq checkpoint --commit "$SHA" --json | jq -r .checkpoint_id)
eq session list "$CKPT" | jq '{index, agent, prompt_preview, turn_count}'
# pick the session whose prompt_preview matches the topic, then:
eq prompt "$CKPT" --session <n>
eq transcript "$CKPT" --session <n> --role assistant | jq -r 'select(.kind=="message") | .text' | head -c 8000
```

Cite `checkpoint_id`, `session_id`, and quote 1–3 short assistant turns.

### "What alternatives were considered?"

Same anchor as above. Then read **assistant** turns (where exploration happens) and tool turns (which files the agent looked at before deciding):

```bash
eq transcript "$CKPT" --session <n> \
  | jq 'select(.role=="assistant" and .kind=="message") | .text' \
  | head -c 12000
```

Look for hedging language ("alternatively", "another option", "instead"). Quote inline.

### "How much did this feature cost in tokens?"

Resolve a commit range to checkpoints, then sum `token_usage`:

```bash
git log --format='%H' <BASE>..<HEAD> \
  | xargs -n1 git show --format='%(trailers:key=Entire-Checkpoint,valueonly)' --no-patch \
  | sort -u | grep -v '^$' \
  | while read CKPT; do eq checkpoint "$CKPT" --json; done \
  | jq -s '{
      input:           map(.token_usage.input_tokens)          | add,
      output:          map(.token_usage.output_tokens)         | add,
      cache_creation:  map(.token_usage.cache_creation_tokens) | add,
      cache_read:      map(.token_usage.cache_read_tokens)     | add,
      api_calls:       map(.token_usage.api_call_count)        | add
    }'
```

Report all five numbers. Do not invent a dollar figure unless the user gave you per-token rates.

### "Has skill X been firing on the right tasks?"

When the user names a skill (e.g. `reviewer`), build the regex from the skill's intent terms — include localized synonyms if the project uses them. Two-pass detection:

```bash
# Pass 1: prompts that look like the skill's domain
eq checkpoint list | jq -r .checkpoint_id | while read CKPT; do
  eq session list "$CKPT" | jq -c --arg c "$CKPT" '. + {checkpoint_id:$c}'
done | jq -s 'map(select(.prompt_preview | test("review"; "i")))'
```

Pass 2: for each candidate, confirm the skill file was actually loaded and a matching tool call ran:

```bash
eq transcript "$CKPT" --session <n> \
  | jq 'select((.text // "") | test(".claude/skills/reviewer"))'
```

Report false negatives (matched the trigger but no skill call) explicitly — those are the actionable cases.

## Output and citation rules

- Always cite `checkpoint_id` (12-hex) and `session_id` (UUID). Add `session_index` when ambiguous.
- When you quote a transcript turn, name `event_index` so a human can re-fetch it.
- Separate **what the transcript says** from **your interpretation**. Use a short blockquote for the former.
- For multi-session answers, use a list — one bullet per session — not a single fused narrative.
- If the answer is "the history doesn't say", say so. Do not extrapolate from filenames or commit messages alone.

## Gotchas

- **`full.jsonl` contains noise rows** (`type: "file-history-snapshot"`, `type: "progress"`) that have no `role`. `eq transcript` normalizes them to `role: "unknown"`, `kind: "unknown"`. Filter with `--role` or `select(.role != "unknown")` — don't try to interpret them.
- **`session_id` is not in checkpoint `metadata.json`**. It's only in each session's own `metadata.json`. `eq session list` already resolves this; if you're tempted to read `metadata.json` directly via `git show`, use `eq` instead.
- **Paths in checkpoint metadata start with `/`** (e.g. `/04/c6b0cd0999/0/metadata.json`). `eq` strips the leading slash on output. If you ever see a leading `/` in `eq` output, that's a bug — report it, don't normalize silently.
- **`turn_count` is derived**, not stored. It comes from `token_usage.api_call_count`. Do not present it as authoritative for "messages exchanged".
- **Two agents, two transcript dialects.** Claude Code transcripts have `role` + `message.content[]`; Cursor transcripts may differ. The `raw` field of every event preserves the original — fall back to `raw` when `text` looks empty or wrong.
- **`agent_percentage` is _initial_ attribution**, calculated when the session started. It does not reflect later edits. Don't quote it as the file's current AI ratio.
- **Don't grep checkpoints directly with `git grep`** — the checkpoints branch is detached from the working tree. Use `eq` (which uses `git show`) or `git grep <pattern> entire/checkpoints/v1 -- <path>` explicitly.
- **JSONL commands have no `--jsonl` flag.** `eq checkpoint list`, `eq session list`, and `eq transcript` always emit NDJSON. Don't pass `--json` to them — it's rejected. Use `| jq -s '.'` if you need an array.
- **`entire explain` is not your friend here.** Its summary is opinionated and uncitable. Reach for it only as a last resort and label its output as such.
- **Build localized regexes from the user's language.** When the user asks in a non-English language, the prompts and transcripts may also be in that language. Add the relevant translations to any `test(...; "i")` filter rather than relying on English alone.

## When to load reference files

- Composing aggregations beyond the four inline recipes → load [references/recipes.md](references/recipes.md)
- An `eq` flag or schema field is unfamiliar → load [references/eq-cheatsheet.md](references/eq-cheatsheet.md)
- A transcript event has `kind: "tool"` or unknown structure and you need to interpret tool calls → load [references/transcript-events.md](references/transcript-events.md)
