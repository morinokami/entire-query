# entire-query

`eq` — fetch [Entire](https://entire.io/) AI session history from a Git repo as stable JSON / JSONL. Like `jq` for Entire checkpoints.

The npm package is `entire-query`; the binary is `eq`.

## Run

```bash
npx -y entire-query <subcommand> [...args]
```

No install required. Optional global install: `npm i -g entire-query`.

## Commands

```bash
eq checkpoint <id>                          # one Checkpoint JSON
eq checkpoint --commit <sha>                # resolve via Entire-Checkpoint trailer
eq checkpoint list [--file <path>]          # NDJSON stream
eq session list <id> [--file <path>]        # NDJSON of SessionSummary (with prompt_preview)
eq session get <id> --index <n>             # one Session JSON
eq prompt <id> --session <n>                # session's prompt.txt as JSON
eq transcript <id> --session <n> [--role <user|assistant|tool|unknown>]   # NDJSON of TranscriptEvent
```

All commands accept `--repo <path>` (default: cwd). JSON commands auto-emit compact JSON under AI agents; pass `--json` explicitly otherwise. Errors are `{"error":{"kind":"...","message":"..."}}` on stderr with non-zero exit.

## Why

`entire explain` returns AI-summarized prose. `eq` returns raw structured data so callers (skills, agents, scripts) can quote, aggregate, and cross-reference primary sources. Aggregation is delegated to `jq`.
