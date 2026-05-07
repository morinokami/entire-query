import type { Role, TranscriptEvent } from "../../types.ts";

import {
  buildEvent,
  type EventContext,
  isObject,
  type RawObject,
  stripIDEContextTags,
} from "../shared.ts";

// Gemini CLI session is a single JSON object:
//   { sessionId, messages: [
//       { id, timestamp, type: "user"|"gemini"|"info", content: string|array, toolCalls?: [...], tokens? }
//     ] }
//
// Each toolCall has { id, name, args, result?: [{ functionResponse:{response:{output}} }], status }.

function geminiContentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    let out = "";
    for (const part of content) {
      if (isObject(part) && typeof part.text === "string") out += part.text;
    }
    return out;
  }
  return "";
}

function extractToolPath(args: unknown): string | null {
  if (!isObject(args)) return null;
  for (const key of ["file_path", "filePath", "path", "absolute_path"] as const) {
    const v = (args as RawObject)[key];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return null;
}

function toolOutputText(result: unknown): string {
  if (!Array.isArray(result) || result.length === 0) return "";
  const first = result[0];
  if (!isObject(first)) return "";
  const fr = first.functionResponse;
  if (!isObject(fr)) return "";
  const resp = fr.response;
  if (!isObject(resp)) return "";
  return typeof resp.output === "string" ? resp.output : "";
}

export function parseGeminiBody(ctx: EventContext, body: string): TranscriptEvent[] {
  const events: TranscriptEvent[] = [];
  let event_index = 0;

  let session: unknown;
  try {
    session = JSON.parse(body);
  } catch {
    return events;
  }
  if (!isObject(session) || !Array.isArray(session.messages)) return events;

  for (const msg of session.messages) {
    if (!isObject(msg)) continue;
    const t = typeof msg.type === "string" ? msg.type : "";
    if (t === "info") continue;

    if (t === "user") {
      const text = stripIDEContextTags(geminiContentText(msg.content));
      if (!text) continue;
      events.push(
        buildEvent(ctx, event_index++, {
          role: "user",
          kind: "message",
          subtype: "text",
          text,
          path: null,
          raw: msg,
        }),
      );
      continue;
    }

    if (t === "gemini") {
      const text = geminiContentText(msg.content);
      if (text) {
        events.push(
          buildEvent(ctx, event_index++, {
            role: "assistant",
            kind: "message",
            subtype: "text",
            text,
            path: null,
            raw: msg,
          }),
        );
      }
      const calls = Array.isArray(msg.toolCalls) ? msg.toolCalls : [];
      for (const tc of calls) {
        if (!isObject(tc)) continue;
        const name = typeof tc.name === "string" ? tc.name : "";
        const path = extractToolPath(tc.args);
        events.push(
          buildEvent(ctx, event_index++, {
            role: "assistant",
            kind: "tool",
            subtype: name.toLowerCase() || "unknown",
            text: "",
            path,
            raw: tc,
          }),
        );
        const out = toolOutputText(tc.result);
        const status = typeof tc.status === "string" ? tc.status : "";
        const isError = status !== "" && status !== "success";
        if (out) {
          const resultRole: Role = "tool";
          events.push(
            buildEvent(ctx, event_index++, {
              role: resultRole,
              kind: "tool",
              subtype: isError ? "error" : "result",
              text: out,
              path: null,
              raw: { _from: "gemini_tool_result", result: tc.result },
            }),
          );
        }
      }
      continue;
    }
  }
  return events;
}
