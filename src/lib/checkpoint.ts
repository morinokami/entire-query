import { fail } from "./errors.ts";
import { GitNotFoundError, gitLsTreeDirs, gitShowJSON, type RepoContext } from "./git.ts";
import { assertCheckpointId, checkpointDir, stripLeadingSlash } from "./paths.ts";
import {
  type Checkpoint,
  type CheckpointSessionRef,
  type TokenUsage,
  ZERO_TOKEN_USAGE,
} from "./types.ts";

interface RawCheckpointMetadata {
  cli_version?: string;
  checkpoint_id?: string;
  strategy?: string;
  branch?: string;
  checkpoints_count?: number;
  files_touched?: string[];
  sessions?: { metadata?: string; transcript?: string }[];
  token_usage?: Partial<TokenUsage>;
}

interface RawSessionMetadata {
  session_id?: string;
}

function normalizeTokenUsage(raw: Partial<TokenUsage> | undefined): TokenUsage {
  if (!raw) return { ...ZERO_TOKEN_USAGE };
  return {
    input_tokens: raw.input_tokens ?? 0,
    cache_creation_tokens: raw.cache_creation_tokens ?? 0,
    cache_read_tokens: raw.cache_read_tokens ?? 0,
    output_tokens: raw.output_tokens ?? 0,
    api_call_count: raw.api_call_count ?? 0,
  };
}

function indexFromMetadataPath(p: string): number | null {
  // e.g. "/04/c6b0cd0999/0/metadata.json" → 0
  const parts = stripLeadingSlash(p).split("/");
  if (parts.length < 4) return null;
  const idx = Number.parseInt(parts[2] ?? "", 10);
  return Number.isFinite(idx) ? idx : null;
}

export async function loadCheckpointMetadata(
  repo: RepoContext,
  id: string,
): Promise<RawCheckpointMetadata> {
  assertCheckpointId(id);
  const path = `${checkpointDir(id)}/metadata.json`;
  try {
    return await gitShowJSON<RawCheckpointMetadata>(repo, path);
  } catch (err) {
    if (err instanceof GitNotFoundError) {
      fail("checkpoint/not-found", `checkpoint not found: ${id}`, {
        details: { checkpoint_id: id },
      });
    }
    throw err;
  }
}

async function readSessionId(repo: RepoContext, metadataPath: string): Promise<string | null> {
  try {
    const meta = await gitShowJSON<RawSessionMetadata>(repo, metadataPath);
    return meta.session_id ?? null;
  } catch {
    return null;
  }
}

export async function loadCheckpoint(repo: RepoContext, id: string): Promise<Checkpoint> {
  const meta = await loadCheckpointMetadata(repo, id);
  const dir = checkpointDir(id);
  const sessions: CheckpointSessionRef[] = [];
  for (const s of meta.sessions ?? []) {
    if (!s?.metadata) continue;
    const metadataPath = stripLeadingSlash(s.metadata);
    const index = indexFromMetadataPath(metadataPath);
    if (index === null) continue;
    const sessionPath = `${dir}/${index}`;
    const session_id = await readSessionId(repo, metadataPath);
    sessions.push({ index, session_id, path: sessionPath });
  }
  sessions.sort((a, b) => a.index - b.index);
  return {
    checkpoint_id: meta.checkpoint_id ?? id,
    cli_version: meta.cli_version ?? null,
    strategy: meta.strategy ?? null,
    branch: meta.branch ?? null,
    checkpoints_count: meta.checkpoints_count ?? null,
    files_touched: meta.files_touched ?? [],
    sessions,
    token_usage: normalizeTokenUsage(meta.token_usage),
  };
}

export async function* iterateCheckpointIds(repo: RepoContext): AsyncGenerator<string> {
  const shards = await gitLsTreeDirs(repo, "");
  for (const shard of shards) {
    if (!/^[0-9a-f]{2}$/.test(shard)) continue;
    const remainders = await gitLsTreeDirs(repo, shard);
    for (const r of remainders) {
      if (!/^[0-9a-f]{10}$/.test(r)) continue;
      yield `${shard}${r}`;
    }
  }
}

export async function* listCheckpoints(
  repo: RepoContext,
  opts: { file?: string } = {},
): AsyncGenerator<Checkpoint> {
  for await (const id of iterateCheckpointIds(repo)) {
    let cp: Checkpoint;
    try {
      cp = await loadCheckpoint(repo, id);
    } catch {
      continue;
    }
    if (opts.file && !cp.files_touched.includes(opts.file)) continue;
    yield cp;
  }
}
