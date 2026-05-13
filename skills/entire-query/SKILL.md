---
name: entire-query
description: Query a repository's AI session history (Entire checkpoints, sessions, transcripts) via the `eq` CLI to answer questions about why code was written a certain way, what alternatives were explored, when and by which agent something was added, how many tokens a feature consumed, how much of a file was AI-generated, what tools or skills were used, and how to reproduce a past session. Use when the user asks about implementation history, intent, reasoning, prior work, AI/agent attribution, token cost, skill-firing audits, Bash command audits, or session reproduction in a repository that uses Entire (https://entire.io). Trigger words include "why", "how come", "when", "who", "history", "intent", "rationale", "previously", "past", "cost", "tokens", "attribution", "agent-written", "skill firing", and the equivalent terms in the user's language. Skip when the question is about current code behavior, future plans, or pure Git operations unrelated to AI sessions.
---

# entire-query

Tools and procedures for answering questions about a repository's AI session history. Entire records AI work as checkpoints linked to commits via an `Entire-Checkpoint: <id>` Git trailer. The official `entire` CLI is the human-facing entry point for search, explanation, rewind, resume, and v2-aware checkpoint reads. The `eq` CLI complements it by exposing checkpoint data as stable JSON / JSONL so you can verify, cite, aggregate, and audit with `jq`.

## Invoking `eq`

The CLI binary is `eq`; the npm package is `entire-query`. **No installation required** — run it through `npx`:

```bash
npx -y entire-query <subcommand> [args...]
```

The first call fetches the package over the network (a few seconds) and caches it. Later `npx` calls reuse the package cache, but still pay npm/npx startup overhead. This is the path you should default to for one-off or small lookups — never ask the user to globally install anything just to use this skill.

Optional: if `eq` is already on `PATH` (the user has done `npm i -g entire-query` / `pnpm add -g entire-query` / `bun add -g entire-query` themselves), use it directly. Detect at runtime and pick the shorter form:

```bash
command -v eq >/dev/null 2>&1 && EQ="eq" || EQ="npx -y entire-query"
```

Then prefix invocations with `$EQ` (e.g. `$EQ checkpoint <sha>`). Examples below write `eq …` for brevity — substitute `$EQ` (or `npx -y entire-query` directly) in your actual commands. **Do not run a bare `eq …` without first verifying that `command -v eq` succeeds**; on a fresh machine it will fail with `command not found` and you'll have to redo the call with `npx -y entire-query …`.

For bulk workflows, do **not** put `npx -y entire-query` inside a per-checkpoint or per-session loop. If many `eq` calls are needed, prefer an already-installed `eq` on `PATH`, or install/cache `entire-query` once into a temporary or tool-local prefix and invoke that `eq` binary directly for the rest of the workflow. Keep `npx -y entire-query` as the default for one-off or small numbers of calls.

Pitfall: `npx eq` (without `entire-query`) fetches an unrelated package of the same name. The package name is **always** `entire-query`.

## When to activate

Activate on questions about **the past**: why code is shaped this way, what was considered, when/who/which-agent did it, how much it cost, whether a skill or tool was used as expected.

Do **not** activate when:

- The user asks how the current code works ("explain this function") — read the code instead
- The user asks about future plans or design proposals
- The question is a pure Git operation ("what commits are on this branch") that doesn't need session content
- The repo doesn't use Entire (no checkpoint refs → fall back to honest "no AI history available")

Run this preflight before doing anything else:

```bash
if git rev-parse --verify entire/checkpoints/v1 >/dev/null 2>&1 ||
   git rev-parse --verify refs/remotes/origin/entire/checkpoints/v1 >/dev/null 2>&1; then
  echo "eq-readable entire history"
elif git rev-parse --verify refs/entire/checkpoints/v2/main >/dev/null 2>&1; then
  echo "entire v2 history only"
else
  echo "no entire history"
fi
```

If that prints "no entire history", say so and stop. Do not fabricate. If it prints "entire v2 history only", prefer the official `entire` CLI; `eq` currently reads `entire/checkpoints/v1`.

## How `eq` complements `entire`

Use the official `entire` CLI for human-facing workflows: broad semantic search, quick checkpoint overviews, generated summaries, rewind/resume/attach flows, and v2-aware checkpoint data.

Use `eq` when the answer must be reproducible, scriptable, grounded in primary transcript events, or aggregated across many sessions. `eq` is the right tool for stable JSON/JSONL, `jq` filters, token totals, skill/tool audits, and citations that name `checkpoint_id`, `session_id`, and `event_index`.

Treat `entire explain` as a useful lead or overview, not as the final source for evidence-heavy answers. It may show a stored AI summary, `entire explain --generate` creates one, and the default view also renders metadata, prompts, and parsed transcript excerpts directly. That output is formatted for reading, not for stable structured querying. If `entire explain` finds the likely checkpoint or gives a helpful summary, verify important claims with `eq prompt`, `eq session get`, or `eq transcript` before quoting or auditing.

## Core workflow (universal)

Every question follows this shape. Skip steps that are irrelevant.

1. **Anchor**: turn the user's question into one of `commit SHA`, `file path`, `file:line`, or free text
2. **Resolve to checkpoint(s)**: use `eq checkpoint <sha>` (best for commits — accepts any git ref), `eq checkpoint list --file <path>` (file-anchored), or `entire checkpoint search "<query>" --json` when starting from broad free text and the official CLI is available
3. **Triage sessions cheaply**: `eq session list <id>` returns `agent`, `created_at`, `turn_count`, `prompt_preview`, `files_touched`. Pick the smallest plausible set before opening any transcript
4. **Read prompt before transcript**: `eq prompt <id> --session <n>` is one short file. Often it answers the question on its own
5. **Open transcripts last** and filtered: `eq transcript <id> --session <n> --role user|assistant|tool` (NDJSON, pipe to `jq` for analytics)
6. **Cite primary sources**: every claim names `checkpoint_id` and `session_id` (and `event_index` if quoting an exchange)

**Cost discipline:** transcripts can be large. Never run `eq transcript ...` without `--role` or `| jq 'select(...)'` first unless the session has fewer than ~50 events. Always start from `eq session list` and `eq prompt`.

## Decision tree

| User input contains                | First move                                                                            |
| ---------------------------------- | ------------------------------------------------------------------------------------- |
| commit SHA / `git blame` mentions  | `eq checkpoint <sha>`                                                                 |
| file path / `path:line`            | `eq checkpoint list --file <path>` then triage by `created_at`                        |
| feature name, free text            | `entire checkpoint search "<query>" --json` for leads, then verify with `eq`          |
| "PR" / "this branch"               | `git log --grep='Entire-Checkpoint:' <range>` → trailer → `eq checkpoint <sha>`       |
| Token / cost question              | Anchor as above, then aggregate via `\| jq -s` (see [recipes](references/recipes.md)) |
| "Did skill X fire?" / "Bash audit" | Anchor → `eq transcript ... \| jq` filter (see [recipes](references/recipes.md))      |

If `entire checkpoint search` is unavailable, unauthenticated, or too broad, fall back to `eq checkpoint list` plus `jq` filters over `files_touched`, `created_at`, `agent`, and prompt previews from `eq session list`.

## Output modes (important)

- **JSON commands** (one document on stdout): `eq checkpoint`, `eq session get`, `eq prompt`
- **JSONL commands** (one record per line on stdout): `eq checkpoint list`, `eq session list`, `eq transcript`

JSONL commands have **no `--jsonl` flag** — NDJSON is their only output. Pipe directly to `jq` line-by-line, or use `jq -s '.'` to collect into an array. Passing `--json` to a JSONL command is rejected with `rune/invalid-arguments`.

## eq commands you will use

See [eq-cheatsheet.md](references/eq-cheatsheet.md) for the full reference. The five you'll reach for most:

```bash
eq checkpoint <sha-or-id>                     # → one Checkpoint JSON document (polymorphic ref)
eq checkpoint list --file <path>              # → NDJSON of Checkpoints touching <path>
eq session list <checkpoint-id>               # → NDJSON of SessionSummary (with prompt_preview)
eq prompt <checkpoint-id> --session <n>       # → one prompt JSON document with prompts: string[]
eq transcript <checkpoint-id> --session <n> --role <user|assistant|tool>   # → NDJSON of TranscriptEvent
```

Every command supports `--repo <path>` (defaults to cwd). JSON commands also accept `--json` (auto-enabled under agents) for compact output. Errors come back as `{"error":{"kind":"...","message":"...","hint":"..."}}` on **stderr** with non-zero exit (both JSON and JSONL modes). Check `kind` (e.g. `checkpoint/not-found`) before retrying.

## Recipes by question type

Inline below are the four highest-frequency recipes. For others (cost aggregation, attribution, skill-firing audit, Bash audit, session reproduction), load [references/recipes.md](references/recipes.md).

### "Why was this implemented this way?" (file:line → narrative)

```bash
SHA=$(git blame -L <LINE>,<LINE> -- <FILE> | awk '{print $1}')
CKPT=$(eq checkpoint "$SHA" --json | jq -r .checkpoint_id)
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
  | jq -s '
      def walk_tu: if . == null then empty else ., (.subagent_tokens | walk_tu) end;
      [.[] | .token_usage | walk_tu] | {
        input:           map(.input_tokens)          | add,
        output:          map(.output_tokens)         | add,
        cache_creation:  map(.cache_creation_tokens) | add,
        cache_read:      map(.cache_read_tokens)     | add,
        api_calls:       map(.api_call_count)        | add
      }
    '
```

`walk_tokens` flattens any `subagent_tokens` nesting (Claude Code Task tool etc.) — without it you'll undercount whenever subagents ran. Report all five numbers. Do not invent a dollar figure unless the user gave you per-token rates.

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
- **`turn_count` resolution order**: `session_metrics.turn_count` (hook-reported by some agents like Cursor) → `token_usage.api_call_count` (fallback) → `null`. Prefer `session_metrics.turn_count` when both are present; treat `api_call_count` as an over-count of "messages exchanged" because streaming retries and parallel tool calls inflate it.
- **Subagent token usage is nested.** When you sum tokens, walk `token_usage.subagent_tokens` recursively or you'll undercount Claude Code Task-tool work. The field is `null` when no subagents ran. Example: `[.token_usage, .token_usage.subagent_tokens // empty] | map(.input_tokens) | add`.
- **Six agents, multiple transcript dialects.** Claude Code, Cursor, OpenCode, Codex, Copilot CLI, Gemini CLI, and Factory AI Droid each have their own `full.jsonl` shape (some are even single-JSON, not JSONL). `eq transcript` auto-detects the format and normalizes events to the common `role`/`kind`/`subtype`/`text`/`path` shape. The `raw` field always preserves the original source line/object — fall back to `raw` when `text` looks empty or wrong, and check `agent` from `eq session list`/`get` to know what agent-specific fields live in `raw`.
- **`agent_percentage` is _initial_ attribution**, calculated when the session started. It does not reflect later edits. Don't quote it as the file's current AI ratio.
- **Don't grep checkpoints directly with `git grep`** — the checkpoints branch is detached from the working tree. Use `eq` (which uses `git show`) or `git grep <pattern> entire/checkpoints/v1 -- <path>` explicitly.
- **JSONL commands have no `--jsonl` flag.** `eq checkpoint list`, `eq session list`, and `eq transcript` always emit NDJSON. Don't pass `--json` to them — it's rejected. Use `| jq -s '.'` if you need an array.
- **`entire explain` is an overview, not a primary-source citation.** Use it to find likely checkpoints or understand the shape of a session. For claims that need evidence, come back to `eq` and cite the underlying prompt, metadata, or transcript event.
- **`eq` currently reads `entire/checkpoints/v1`.** If the repo is configured for checkpoints v2 only (`refs/entire/checkpoints/v2/main`), use the official `entire` CLI for checkpoint reads.
- **Build localized regexes from the user's language.** When the user asks in a non-English language, the prompts and transcripts may also be in that language. Add the relevant translations to any `test(...; "i")` filter rather than relying on English alone.

## When to load reference files

- Composing aggregations beyond the four inline recipes → load [references/recipes.md](references/recipes.md)
- An `eq` flag or schema field is unfamiliar → load [references/eq-cheatsheet.md](references/eq-cheatsheet.md)
- A transcript event has `kind: "tool"` or unknown structure and you need to interpret tool calls → load [references/transcript-events.md](references/transcript-events.md)
