import type { TranscriptEvent } from "../types.ts";
import type { EventContext } from "./shared.ts";

import { fail } from "../errors.ts";
import { GitNotFoundError, gitShow, type RepoContext } from "../git.ts";
import { assertCheckpointId, checkpointDir } from "../paths.ts";
import { findSessionId } from "../session.ts";
import { detectFormat, type Format } from "./detect.ts";
import { parseClaudeCodeBody } from "./parsers/claudecode.ts";
import { parseCodexBody } from "./parsers/codex.ts";
import { parseCopilotBody } from "./parsers/copilot.ts";
import { parseDroidBody } from "./parsers/droid.ts";
import { parseGeminiBody } from "./parsers/gemini.ts";
import { parseOpenCodeBody } from "./parsers/opencode.ts";

function dispatch(format: Format, ctx: EventContext, body: string): TranscriptEvent[] {
  switch (format) {
    case "opencode":
      return parseOpenCodeBody(ctx, body);
    case "gemini":
      return parseGeminiBody(ctx, body);
    case "codex":
      return parseCodexBody(ctx, body);
    case "copilot":
      return parseCopilotBody(ctx, body);
    case "droid":
      return parseDroidBody(ctx, body);
    case "claudecode":
      return parseClaudeCodeBody(ctx, body);
  }
}

export async function loadTranscript(
  repo: RepoContext,
  id: string,
  sessionIndex: number,
): Promise<TranscriptEvent[]> {
  assertCheckpointId(id);
  const path = `${checkpointDir(id)}/${sessionIndex}/full.jsonl`;
  let body: string;
  try {
    body = await gitShow(repo, path);
  } catch (err) {
    if (err instanceof GitNotFoundError) {
      fail("transcript/not-found", `transcript not found: ${path}`, {
        details: { checkpoint_id: id, session_index: sessionIndex },
      });
    }
    throw err;
  }
  const session_id = await findSessionId(repo, id, sessionIndex);
  const ctx: EventContext = {
    checkpoint_id: id,
    session_index: sessionIndex,
    session_id,
  };
  const format = detectFormat(body);
  return dispatch(format, ctx, body);
}

export { detectFormat } from "./detect.ts";
