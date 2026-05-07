import type { Kind, Role, TranscriptEvent } from "../../types.ts";

import {
  buildEvent,
  type EventContext,
  isObject,
  parseErrorEvent,
  type RawObject,
  splitJSONL,
  stripIDEContextTags,
} from "../shared.ts";

// Codex JSONL has top-level lines like:
//   {"timestamp":"...","type":"response_item","payload":{...}}
//   {"timestamp":"...","type":"event_msg","payload":{"type":"token_count",...}}
//   {"timestamp":"...","type":"session_meta", ...}
//   {"timestamp":"...","type":"turn_context", ...}
//
// Only response_item lines carry transcript content. payload.type is one of:
//   - "message" with role "user"|"assistant", content: [{type:"input_text",text} | {type:"output_text",text}]
//   - "function_call" with name/arguments(JSON string)/call_id
//   - "function_call_output" with call_id/output(string)
//   - "custom_tool_call" with name/input(string)/call_id
//   - "custom_tool_call_output" with call_id/output({type:"text",text})

const SYSTEM_PREFIXES = [
  "<permissions",
  "<collaboration_mode>",
  "<skills_instructions>",
  "<environment_context>",
  "<turn_aborted>",
  "# AGENTS.md",
];

function isCodexSystemContent(text: string): boolean {
  return SYSTEM_PREFIXES.some((p) => text.startsWith(p));
}

function extractInputText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (!isObject(block)) continue;
    if (block.type !== "input_text") continue;
    const text = typeof block.text === "string" ? block.text : "";
    if (!text || isCodexSystemContent(text)) continue;
    const stripped = stripIDEContextTags(text);
    if (stripped) parts.push(stripped);
  }
  return parts.join("\n\n");
}

function extractOutputText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (!isObject(block)) continue;
    if (block.type === "output_text" && typeof block.text === "string" && block.text) {
      parts.push(block.text);
    }
  }
  return parts.join("\n\n");
}

function extractToolPath(input: unknown): string | null {
  if (typeof input === "string") {
    // function_call.arguments is a JSON string; try to parse.
    try {
      return extractToolPath(JSON.parse(input));
    } catch {
      return null;
    }
  }
  if (!isObject(input)) return null;
  for (const key of ["file_path", "filePath", "path"] as const) {
    const v = input[key];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return null;
}

function customToolOutput(payload: RawObject): string {
  const out = payload.output;
  if (typeof out === "string") return out;
  if (isObject(out)) {
    if (typeof out.text === "string") return out.text;
  }
  return "";
}

interface ClassifiedPayload {
  role: Role;
  kind: Kind;
  subtype: string;
  text: string;
  path: string | null;
  emit: boolean;
}

function classifyPayload(payload: RawObject): ClassifiedPayload {
  const t = typeof payload.type === "string" ? payload.type : "";
  const role = typeof payload.role === "string" ? payload.role : "";

  if (t === "message" && role === "user") {
    const text = extractInputText(payload.content);
    return {
      role: "user",
      kind: "message",
      subtype: "text",
      text,
      path: null,
      emit: text.length > 0,
    };
  }
  if (t === "message" && role === "assistant") {
    const text = extractOutputText(payload.content);
    return {
      role: "assistant",
      kind: "message",
      subtype: "text",
      text,
      path: null,
      emit: text.length > 0,
    };
  }
  if (t === "function_call" || t === "custom_tool_call") {
    const name = typeof payload.name === "string" ? payload.name : "";
    const inputRaw = t === "function_call" ? payload.arguments : payload.input;
    const path = extractToolPath(inputRaw);
    return {
      role: "assistant",
      kind: "tool",
      subtype: name.toLowerCase(),
      text: "",
      path,
      emit: true,
    };
  }
  if (t === "function_call_output") {
    const out = typeof payload.output === "string" ? payload.output : "";
    return { role: "tool", kind: "tool", subtype: "result", text: out, path: null, emit: true };
  }
  if (t === "custom_tool_call_output") {
    const out = customToolOutput(payload);
    return { role: "tool", kind: "tool", subtype: "result", text: out, path: null, emit: true };
  }
  return {
    role: "unknown",
    kind: "unknown",
    subtype: "unknown",
    text: "",
    path: null,
    emit: false,
  };
}

export function parseCodexBody(ctx: EventContext, body: string): TranscriptEvent[] {
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
    if (raw.type !== "response_item") continue; // drop session_meta/event_msg/turn_context
    const payload = raw.payload;
    if (!isObject(payload)) continue;
    const c = classifyPayload(payload);
    if (!c.emit) continue;
    events.push(
      buildEvent(ctx, event_index++, {
        role: c.role,
        kind: c.kind,
        subtype: c.subtype,
        text: c.text,
        path: c.path,
        raw,
      }),
    );
  }
  return events;
}
