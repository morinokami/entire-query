import type { TranscriptEvent } from "../../types.ts";

import { buildEvent, type EventContext, isObject, parseErrorEvent, splitJSONL } from "../shared.ts";

// Copilot CLI JSONL has lines like:
//   {"type":"session.start","timestamp":"..","data":{...}}
//   {"type":"user.message","timestamp":"..","data":{"content":"..."}}
//   {"type":"assistant.message","timestamp":"..","data":{"messageId":"..","content":"..","toolRequests":[{toolCallId,name,arguments}]}}
//   {"type":"tool.execution_complete","timestamp":"..","data":{"toolCallId":"..","success":true,"result":{"content":"..","detailedContent":".."}}}
//
// Emit one event per recognized line:
//   user.message              → role=user,      kind=message
//   assistant.message         → role=assistant, kind=message (subtype "tool" if no text but toolRequests)
//   tool.execution_complete   → role=tool,      kind=tool

function extractToolPath(args: unknown): string | null {
  if (typeof args === "string") {
    try {
      return extractToolPath(JSON.parse(args));
    } catch {
      return null;
    }
  }
  if (!isObject(args)) return null;
  for (const key of ["file_path", "filePath", "path"] as const) {
    const v = args[key];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return null;
}

export function parseCopilotBody(ctx: EventContext, body: string): TranscriptEvent[] {
  const events: TranscriptEvent[] = [];
  let event_index = 0;
  for (const line of splitJSONL(body)) {
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch (err) {
      events.push(parseErrorEvent(ctx, event_index++, err, line));
      continue;
    }
    if (!isObject(raw)) continue;
    const t = raw.type;
    const data = isObject(raw.data) ? raw.data : null;

    if (t === "user.message" && data) {
      const text = typeof data.content === "string" ? data.content : "";
      if (!text) continue;
      events.push(
        buildEvent(ctx, event_index++, {
          role: "user",
          kind: "message",
          subtype: "text",
          text,
          path: null,
          raw,
        }),
      );
      continue;
    }

    if (t === "assistant.message" && data) {
      const content = typeof data.content === "string" ? data.content : "";
      const toolReqs = Array.isArray(data.toolRequests) ? data.toolRequests : [];
      // If the message has tool calls, classify as kind=tool with first tool's name.
      if (toolReqs.length > 0) {
        const first = isObject(toolReqs[0]) ? toolReqs[0] : null;
        const name = first && typeof first.name === "string" ? first.name : "";
        const path = first ? extractToolPath(first.arguments) : null;
        events.push(
          buildEvent(ctx, event_index++, {
            role: "assistant",
            kind: "tool",
            subtype: name.toLowerCase() || "unknown",
            text: content,
            path,
            raw,
          }),
        );
        continue;
      }
      if (!content) continue;
      events.push(
        buildEvent(ctx, event_index++, {
          role: "assistant",
          kind: "message",
          subtype: "text",
          text: content,
          path: null,
          raw,
        }),
      );
      continue;
    }

    if (t === "tool.execution_complete" && data) {
      const result = isObject(data.result) ? data.result : null;
      const out =
        result && typeof result.content === "string" && result.content
          ? result.content
          : result && typeof result.detailedContent === "string"
            ? result.detailedContent
            : "";
      events.push(
        buildEvent(ctx, event_index++, {
          role: "tool",
          kind: "tool",
          subtype: data.success === false ? "error" : "result",
          text: out,
          path: null,
          raw,
        }),
      );
      continue;
    }
    // session.start, etc. → drop
  }
  return events;
}
