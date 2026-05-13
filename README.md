# entire-query

`eq` — fetch [Entire](https://entire.io/) AI session history from a Git repo as stable JSON / JSONL. Like `jq` for Entire checkpoints.

`eq` complements the official `entire` CLI. Use `entire` for human-facing workflows such as setup, semantic search, quick explanations, summaries, rewind, and resume. Use `eq` when you need reproducible structured output for agents, scripts, citations, token aggregation, or transcript audits.

The npm package is `entire-query`; the binary is `eq`.

## Run

```bash
npx -y entire-query <subcommand> [...args]
```

No install required. Optional global install: `npm i -g entire-query`.

## Commands

```bash
eq checkpoint <id-or-ref>                   # one Checkpoint JSON; git refs resolve via Entire-Checkpoint trailer
eq checkpoint list [--file <path>]          # NDJSON stream
eq session list <id> [--file <path>]        # NDJSON of SessionSummary (with prompt_preview)
eq session get <id> --index <n>             # one Session JSON
eq prompt <id> --session <n>                # session's prompt.txt as JSON
eq transcript <id> --session <n> [--role <user|assistant|tool|unknown>]   # NDJSON of TranscriptEvent
```

All commands accept `--repo <path>` (default: cwd). JSON commands auto-emit compact JSON under AI agents; pass `--json` explicitly otherwise. Errors are `{"error":{"kind":"...","message":"..."}}` on stderr with non-zero exit.

## Why

`entire explain` is useful for getting oriented and finding likely checkpoints. It is a human-readable CLI view: it can show a stored AI summary, `entire explain --generate` creates one, and the default view also renders metadata, prompts, and parsed transcript excerpts directly. `eq` is for the next step: reading the underlying checkpoint data as raw structured output so callers can quote, aggregate, audit, and cross-reference primary sources. Aggregation is delegated to `jq`.

`eq` currently reads the `entire/checkpoints/v1` branch. For checkpoints v2-only repositories or workflows that need remote fetch, generated summaries, rewind, or resume, use the official `entire` CLI.
