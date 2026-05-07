import type { TranscriptEvent } from "../../types.ts";

import { isObject, type RawObject, type EventContext } from "../shared.ts";
import { parseClaudeCodeBody } from "./claudecode.ts";

// Factory AI Droid wraps each Anthropic-style message in an envelope:
//   {"type":"message","id":"m1","timestamp":"t1","message":{"role":"user","content":...}}
// Flatten that to the plain Claude Code shape before delegating.
function unwrapDroidEnvelope(raw: RawObject): RawObject {
  if (raw.type !== "message") return raw;
  const inner = raw.message;
  if (!isObject(inner)) return raw;
  const role = inner.role;
  if (role !== "user" && role !== "human" && role !== "assistant") return raw;

  const flat: RawObject = {
    type: role === "human" ? "user" : role,
  };
  if ("timestamp" in raw) flat.timestamp = raw.timestamp;

  const innerCopy: RawObject = { ...inner };
  if (raw.id !== undefined && innerCopy.id === undefined) innerCopy.id = raw.id;
  flat.message = innerCopy;
  return flat;
}

export function parseDroidBody(ctx: EventContext, body: string): TranscriptEvent[] {
  return parseClaudeCodeBody(ctx, body, unwrapDroidEnvelope);
}
