import { loadCheckpointMetadata } from "./checkpoint.ts";
import { fail } from "./errors.ts";
import { GitNotFoundError, gitShowJSON, type RepoContext } from "./git.ts";
import { assertCheckpointId, checkpointDir, stripLeadingSlash } from "./paths.ts";
import { buildPromptPreview, loadPrompts } from "./prompt.ts";
import {
  type InitialAttribution,
  normalizeTokenUsage,
  type Session,
  type SessionMetrics,
  type SessionSummary,
  type TokenUsage,
} from "./types.ts";

interface RawSessionMetadata {
  cli_version?: string;
  checkpoint_id?: string;
  session_id?: string;
  strategy?: string;
  created_at?: string;
  branch?: string;
  checkpoints_count?: number;
  files_touched?: string[];
  agent?: string;
  model?: string;
  turn_id?: string;
  transcript_identifier_at_start?: string;
  token_usage?: Partial<TokenUsage>;
  initial_attribution?: Partial<InitialAttribution>;
  session_metrics?: Partial<SessionMetrics>;
}

// Resolve session metrics from raw metadata, falling back to api_call_count
// for turn_count when the agent doesn't report it via hooks. Other fields stay
// null when absent — they have no meaningful fallback.
function resolveSessionMetrics(
  raw: Partial<SessionMetrics> | undefined,
  apiCallCount: number,
): SessionMetrics {
  return {
    turn_count: raw?.turn_count ?? (apiCallCount > 0 ? apiCallCount : null),
    duration_ms: raw?.duration_ms ?? null,
    context_tokens: raw?.context_tokens ?? null,
    context_window_size: raw?.context_window_size ?? null,
  };
}

function normalizeAttribution(
  raw: Partial<InitialAttribution> | undefined,
): InitialAttribution | null {
  if (!raw) return null;
  return {
    calculated_at: raw.calculated_at ?? null,
    agent_lines: raw.agent_lines ?? 0,
    human_added: raw.human_added ?? 0,
    human_modified: raw.human_modified ?? 0,
    human_removed: raw.human_removed ?? 0,
    total_committed: raw.total_committed ?? 0,
    agent_percentage: raw.agent_percentage ?? 0,
  };
}

interface SessionRefFromCheckpoint {
  index: number;
  metadataPath: string;
  promptPath: string | null;
  transcriptPath: string;
  contextPath: string | null;
  contentHashPath: string | null;
}

function indexFromMetadataPath(p: string): number | null {
  const parts = stripLeadingSlash(p).split("/");
  if (parts.length < 4) return null;
  const idx = Number.parseInt(parts[2] ?? "", 10);
  return Number.isFinite(idx) ? idx : null;
}

async function listSessionRefs(repo: RepoContext, id: string): Promise<SessionRefFromCheckpoint[]> {
  const meta = await loadCheckpointMetadata(repo, id);
  const refs: SessionRefFromCheckpoint[] = [];
  for (const s of meta.sessions ?? []) {
    if (!s?.metadata) continue;
    const metadataPath = stripLeadingSlash(s.metadata);
    const index = indexFromMetadataPath(metadataPath);
    if (index === null) continue;
    const dir = `${checkpointDir(id)}/${index}`;
    const transcriptPath = (s as { transcript?: string }).transcript
      ? stripLeadingSlash((s as { transcript: string }).transcript)
      : `${dir}/full.jsonl`;
    const promptPath = (s as { prompt?: string }).prompt
      ? stripLeadingSlash((s as { prompt: string }).prompt)
      : `${dir}/prompt.txt`;
    const contextPath = (s as { context?: string }).context
      ? stripLeadingSlash((s as { context: string }).context)
      : `${dir}/context.md`;
    const contentHashPath = (s as { content_hash?: string }).content_hash
      ? stripLeadingSlash((s as { content_hash: string }).content_hash)
      : `${dir}/content_hash.txt`;
    refs.push({ index, metadataPath, promptPath, transcriptPath, contextPath, contentHashPath });
  }
  refs.sort((a, b) => a.index - b.index);
  return refs;
}

async function readSessionMetadata(
  repo: RepoContext,
  metadataPath: string,
): Promise<RawSessionMetadata | null> {
  try {
    return await gitShowJSON<RawSessionMetadata>(repo, metadataPath);
  } catch (err) {
    if (err instanceof GitNotFoundError) return null;
    throw err;
  }
}

export async function loadSessionList(
  repo: RepoContext,
  id: string,
  opts: { file?: string } = {},
): Promise<SessionSummary[]> {
  assertCheckpointId(id);
  const refs = await listSessionRefs(repo, id);
  const out: SessionSummary[] = [];
  for (const ref of refs) {
    const meta = await readSessionMetadata(repo, ref.metadataPath);
    const filesTouched = meta?.files_touched ?? [];
    if (opts.file && !filesTouched.includes(opts.file)) continue;
    const prompts = await loadPrompts(repo, id, ref.index);
    const tokenUsage = normalizeTokenUsage(meta?.token_usage);
    const metrics = resolveSessionMetrics(meta?.session_metrics, tokenUsage.api_call_count);
    out.push({
      index: ref.index,
      session_id: meta?.session_id ?? null,
      agent: meta?.agent ?? null,
      model: meta?.model ?? null,
      created_at: meta?.created_at ?? null,
      turn_count: metrics.turn_count,
      path: `${checkpointDir(id)}/${ref.index}`,
      files_touched: filesTouched,
      prompt_preview: buildPromptPreview(prompts?.[0] ?? null),
    });
  }
  return out;
}

export async function loadSession(repo: RepoContext, id: string, index: number): Promise<Session> {
  assertCheckpointId(id);
  const refs = await listSessionRefs(repo, id);
  const ref = refs.find((r) => r.index === index);
  if (!ref) {
    fail("session/not-found", `session not found: ${id} index=${index}`, {
      details: { checkpoint_id: id, index },
    });
  }
  const meta = await readSessionMetadata(repo, ref.metadataPath);
  if (!meta) {
    fail("session/not-found", `session metadata missing: ${ref.metadataPath}`, {
      details: { checkpoint_id: id, index },
    });
  }
  const tokenUsage = normalizeTokenUsage(meta.token_usage);
  return {
    checkpoint_id: meta.checkpoint_id ?? id,
    index,
    session_id: meta.session_id ?? null,
    cli_version: meta.cli_version ?? null,
    strategy: meta.strategy ?? null,
    created_at: meta.created_at ?? null,
    branch: meta.branch ?? null,
    checkpoints_count: meta.checkpoints_count ?? null,
    files_touched: meta.files_touched ?? [],
    agent: meta.agent ?? null,
    model: meta.model ?? null,
    turn_id: meta.turn_id ?? null,
    transcript_identifier_at_start: meta.transcript_identifier_at_start ?? null,
    session_metrics: resolveSessionMetrics(meta.session_metrics, tokenUsage.api_call_count),
    token_usage: tokenUsage,
    initial_attribution: normalizeAttribution(meta.initial_attribution),
    files: {
      metadata: ref.metadataPath,
      transcript: ref.transcriptPath,
      context: ref.contextPath,
      content_hash: ref.contentHashPath,
      prompt: ref.promptPath,
    },
  };
}

export async function findSessionId(
  repo: RepoContext,
  id: string,
  index: number,
): Promise<string | null> {
  const refs = await listSessionRefs(repo, id);
  const ref = refs.find((r) => r.index === index);
  if (!ref) return null;
  const meta = await readSessionMetadata(repo, ref.metadataPath);
  return meta?.session_id ?? null;
}
