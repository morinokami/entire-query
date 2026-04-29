# entire-query recipes

Recipes beyond the four inline in `SKILL.md`. Each is a compose-from-primitives pattern: `eq` provides raw data, `jq` does the aggregation. Adapt freely.

## Cost / token consumption

### Top N most expensive sessions in a branch

```bash
git log --format='%H' <BRANCH> \
  | xargs -n1 git show --format='%(trailers:key=Entire-Checkpoint,valueonly)' --no-patch \
  | sort -u | grep -v '^$' \
  | while read CKPT; do
      eq session list "$CKPT" --jsonl \
        | jq -c --arg c "$CKPT" '. + {checkpoint_id:$c}'
    done \
  | while read S; do
      CKPT=$(echo "$S" | jq -r .checkpoint_id)
      IDX=$(echo "$S" | jq -r .index)
      eq session get "$CKPT" --index "$IDX" --json
    done \
  | jq -s 'sort_by(-(.token_usage.input_tokens + .token_usage.output_tokens + .token_usage.cache_creation_tokens))[:10]
           | map({checkpoint_id, index, agent, prompt: (.token_usage), files_touched})'
```

Report `input + output + cache_creation` as the cost-relevant total. `cache_read` is near-free; do not double-count.

### Cache hit rate per session

```bash
eq session get <ckpt> --index <n> --json \
  | jq '.token_usage | {hit_rate: (.cache_read_tokens / (.cache_read_tokens + .cache_creation_tokens + .input_tokens))}'
```

### Cumulative cost for a file

```bash
eq checkpoint list --file <path> --jsonl \
  | jq -s '{
      input:          map(.token_usage.input_tokens)          | add,
      output:         map(.token_usage.output_tokens)         | add,
      cache_creation: map(.token_usage.cache_creation_tokens) | add,
      api_calls:      map(.token_usage.api_call_count)        | add,
      checkpoint_count: length
    }'
```

## Attribution

### AI-vs-human ratio at the moment a file was last touched

```bash
LATEST=$(eq checkpoint list --file <path> --jsonl | jq -s 'sort_by(.created_at) | last | .checkpoint_id' -r)
eq session list "$LATEST" --file <path> --jsonl \
  | while read S; do
      eq session get "$LATEST" --index "$(echo "$S" | jq .index)" --json
    done \
  | jq -s 'map(.initial_attribution) | {
      agent_lines: map(.agent_lines) | add,
      human_added: map(.human_added) | add,
      human_modified: map(.human_modified) | add,
      human_removed: map(.human_removed) | add
    }'
```

Always caveat: `initial_attribution` is the snapshot at session start, not a current re-measurement.

### Sessions where humans heavily rewrote agent output

Heuristic: high `human_modified`, low `agent_percentage`. Often signals "agent got it wrong, human fixed it".

```bash
eq checkpoint list --jsonl | jq -r .checkpoint_id | while read CKPT; do
  eq session list "$CKPT" --jsonl | jq -r .index | while read IDX; do
    eq session get "$CKPT" --index "$IDX" --json
  done
done | jq -s 'map(select(.initial_attribution.human_modified > 50 and .initial_attribution.agent_percentage < 30))
              | map({checkpoint_id, index, session_id, attribution: .initial_attribution})'
```

## Skill / pattern firing audits

### Did `<skill-name>` fire whenever it should have?

Two passes: detect intent in prompts, then verify actual invocation in transcripts.

```bash
# Pass 1: prompts that mention the trigger domain (e.g. "review")
eq checkpoint list --jsonl | jq -r .checkpoint_id | while read CKPT; do
  eq session list "$CKPT" --jsonl \
    | jq -c --arg c "$CKPT" '. + {checkpoint_id:$c}'
done | jq -c 'select(.prompt_preview | test("レビュー|review"; "i"))' > candidates.jsonl

# Pass 2: for each candidate, did the transcript actually load the skill file?
while read S; do
  CKPT=$(echo "$S" | jq -r .checkpoint_id)
  IDX=$(echo "$S" | jq .index)
  HIT=$(eq transcript "$CKPT" --session "$IDX" --jsonl \
        | jq -s 'any(.text // ""; test(".claude/skills/reviewer"))')
  echo "$S" | jq --argjson hit "$HIT" '. + {skill_invoked: $hit}'
done < candidates.jsonl | jq -s 'group_by(.skill_invoked) | map({invoked: .[0].skill_invoked, count: length})'
```

Report false negatives by name (`checkpoint_id`/`session_index`) — those are the actionable cases.

## Tool / Bash audits

### All Bash commands ever executed in a session

```bash
eq transcript <ckpt> --session <n> --jsonl \
  | jq -r 'select(.kind=="tool" and .subtype=="bash") | .text'
```

For Claude Code transcripts where the structured tool call is in `raw.message.content[]`:

```bash
eq transcript <ckpt> --session <n> --jsonl \
  | jq -r '.raw.message.content[]? | select(.type=="tool_use" and .name=="Bash") | .input.command'
```

### Tool histogram for a session

```bash
eq transcript <ckpt> --session <n> --jsonl \
  | jq -r '.raw.message.content[]? | select(.type=="tool_use") | .name' \
  | sort | uniq -c | sort -rn
```

### Did the session spawn subagents?

```bash
eq transcript <ckpt> --session <n> --jsonl \
  | jq 'select(.raw.message.content[]? | select(.type=="tool_use" and .name=="Task")) | {event_index, subagent: .raw.message.content[] | select(.type=="tool_use" and .name=="Task") | .input.subagent_type}'
```

## Timeline / file history

### All sessions that ever touched a file, time-ordered

```bash
eq checkpoint list --file <path> --jsonl \
  | jq -r .checkpoint_id \
  | while read CKPT; do
      eq session list "$CKPT" --file <path> --jsonl \
        | jq -c --arg c "$CKPT" '. + {checkpoint_id:$c}'
    done \
  | jq -s 'sort_by(.created_at) | map({checkpoint_id, index, agent, created_at, prompt_preview})'
```

### Rework detection: same file edited in 3+ consecutive checkpoints

Heuristic only. Look at the file's checkpoint list and flag clusters within 24h windows.

## Session reproduction

Extract a re-runnable prompt + the key files the session read:

```bash
echo "=== Original prompt ==="
eq prompt <ckpt> --session <n> --json | jq -r .prompt
echo
echo "=== Files the agent read ==="
eq transcript <ckpt> --session <n> --jsonl \
  | jq -r '.raw.message.content[]? | select(.type=="tool_use" and .name=="Read") | .input.file_path' \
  | sort -u
```

Hand this off as a "starter pack" — the human can replay the prompt against a current branch.

## Multi-checkpoint diffing

"What changed in approach between two attempts at the same feature?"

```bash
A=<ckpt-1>; B=<ckpt-2>
diff \
  <(eq prompt "$A" --session 0 --json | jq -r .prompt) \
  <(eq prompt "$B" --session 0 --json | jq -r .prompt)
```

For deeper comparison, compare the `tool_use` name+input lists rather than free transcripts.
