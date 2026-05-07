import type { Kind, Role, TranscriptEvent } from "../../types.ts";

import {
  buildEvent,
  type EventContext,
  isObject,
  type RawObject,
  stripIDEContextTags,
} from "../shared.ts";

// OpenCode session is a single JSON object:
//   { info: {...}, messages: [
//       { info: { id, role: "user"|"assistant", time:{created,completed}, tokens:{input,output}? }, parts: [...] },
//       ...
//     ] }
// parts[] entries have type: "text" | "tool" | "step-start" | "step-finish".
// text part: { type:"text", text:"...", id? }
// tool part: { type:"tool", tool:"<name>", callID, state:{ input?, output?, status? } }

function extractToolPath(input: unknown): string | null {
  if (!isObject(input)) return null;
  for (const key of ["file_path", "filePath", "path"] as const) {
    const v = input[key];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return null;
}

interface OpenCodeMessage {
  role: Role;
  parts: RawObject[];
  raw: RawObject;
}

function readMessages(body: string): OpenCodeMessage[] {
  let session: unknown;
  try {
    session = JSON.parse(body);
  } catch {
    return [];
  }
  if (!isObject(session) || !Array.isArray(session.messages)) return [];
  const out: OpenCodeMessage[] = [];
  for (const msg of session.messages) {
    if (!isObject(msg)) continue;
    const info = isObject(msg.info) ? msg.info : null;
    const role0 = info && typeof info.role === "string" ? info.role : "";
    const role: Role = role0 === "user" ? "user" : role0 === "assistant" ? "assistant" : "unknown";
    const parts = Array.isArray(msg.parts) ? msg.parts.filter(isObject) : [];
    out.push({ role, parts, raw: msg });
  }
  return out;
}

export function parseOpenCodeBody(ctx: EventContext, body: string): TranscriptEvent[] {
  const events: TranscriptEvent[] = [];
  let event_index = 0;

  for (const msg of readMessages(body)) {
    if (msg.role === "unknown") continue;
    for (const part of msg.parts) {
      const partType = typeof part.type === "string" ? part.type : "";
      if (partType === "text") {
        const text = typeof part.text === "string" ? part.text : "";
        const stripped = msg.role === "user" ? stripIDEContextTags(text) : text;
        if (!stripped) continue;
        events.push(
          buildEvent(ctx, event_index++, {
            role: msg.role,
            kind: "message",
            subtype: "text",
            text: stripped,
            path: null,
            raw: part,
          }),
        );
        continue;
      }
      if (partType === "tool") {
        const toolName = typeof part.tool === "string" ? part.tool : "";
        const state = isObject(part.state) ? part.state : null;
        const path = state ? extractToolPath(state.input) : null;
        const status = state && typeof state.status === "string" ? state.status : "";
        const isError = status !== "" && status !== "completed" && status !== "success";
        // Emit one assistant tool_use event …
        events.push(
          buildEvent(ctx, event_index++, {
            role: "assistant",
            kind: "tool",
            subtype: toolName.toLowerCase() || "unknown",
            text: "",
            path,
            raw: part,
          }),
        );
        // … plus a tool result event when the state carries output.
        const output = state && typeof state.output === "string" ? state.output : "";
        if (output) {
          const resultRole: Role = "tool";
          const resultKind: Kind = "tool";
          events.push(
            buildEvent(ctx, event_index++, {
              role: resultRole,
              kind: resultKind,
              subtype: isError ? "error" : "result",
              text: output,
              path: null,
              raw: { _from: "opencode_tool_state", state },
            }),
          );
        }
        continue;
      }
      // step-start / step-finish / unknown → drop
    }
  }
  return events;
}
