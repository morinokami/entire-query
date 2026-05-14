# entire-query

`eq` — fetch [Entire](https://entire.io/) AI session history from a Git repo as stable JSON / JSONL. Like `jq` for Entire checkpoints.

`eq` complements the official `entire` CLI. Use `entire` for human-facing workflows such as setup, semantic search, quick explanations, summaries, rewind, and resume. Use `eq` when agents, skills, or scripts need reproducible structured output for citations, token aggregation, transcript audits, or other deterministic workflows.

The npm package is `entire-query`; the binary is `eq`.

## Agent and skill use

`eq` is designed for direct use by agent coding tools such as Claude Code and Codex, especially through companion skills. Install the skill in your agent environment, then ask plain questions like "What did we decide about error handling last time?", "Find the exact wording behind the earlier decision about this file", or "Which past exchange used the most tokens?" The skill can call `eq` behind the scenes and ground its answer in stable JSON/JSONL checkpoint data.

Install the companion skill:

```bash
npx skills add morinokami/entire-query
```

A typical skill should call `eq` to retrieve primary session data, then do any summarization, comparison, citation, or filtering in the agent layer. Prefer `eq` over `entire explain` when the agent needs deterministic JSON/JSONL, exact prompts, transcript events, token usage, or checkpoint metadata.

## Manual run

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
