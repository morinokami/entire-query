export const ENTIRE_BRANCH = "entire/checkpoints/v1";

export interface TokenUsage {
  input_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
  output_tokens: number;
  api_call_count: number;
}

export interface InitialAttribution {
  calculated_at: string | null;
  agent_lines: number;
  human_added: number;
  human_modified: number;
  human_removed: number;
  total_committed: number;
  agent_percentage: number;
}

export interface CheckpointSessionRef {
  index: number;
  session_id: string | null;
  path: string;
}

export interface Checkpoint {
  checkpoint_id: string;
  cli_version: string | null;
  strategy: string | null;
  branch: string | null;
  checkpoints_count: number | null;
  files_touched: string[];
  sessions: CheckpointSessionRef[];
  token_usage: TokenUsage;
}

export interface SessionSummary {
  index: number;
  session_id: string | null;
  agent: string | null;
  model: string | null;
  created_at: string | null;
  turn_count: number | null;
  path: string;
  files_touched: string[];
  prompt_preview: string | null;
}

export interface Session {
  checkpoint_id: string;
  index: number;
  session_id: string | null;
  cli_version: string | null;
  strategy: string | null;
  created_at: string | null;
  branch: string | null;
  checkpoints_count: number | null;
  files_touched: string[];
  agent: string | null;
  model: string | null;
  turn_id: string | null;
  transcript_identifier_at_start: string | null;
  session_metrics: { turn_count: number | null };
  token_usage: TokenUsage;
  initial_attribution: InitialAttribution | null;
  files: {
    metadata: string;
    transcript: string;
    context: string | null;
    content_hash: string | null;
    prompt: string | null;
  };
}

export interface PromptResult {
  checkpoint_id: string;
  session_index: number;
  session_id: string | null;
  prompt: string | null;
}

export type Role = "user" | "assistant" | "tool" | "unknown";
export type Kind = "message" | "tool" | "unknown";

export interface TranscriptEvent {
  session_id: string | null;
  checkpoint_id: string;
  session_index: number;
  event_index: number;
  role: Role;
  kind: Kind;
  subtype: string;
  text: string;
  path: string | null;
  raw: unknown;
}

export const ZERO_TOKEN_USAGE: TokenUsage = {
  input_tokens: 0,
  cache_creation_tokens: 0,
  cache_read_tokens: 0,
  output_tokens: 0,
  api_call_count: 0,
};
