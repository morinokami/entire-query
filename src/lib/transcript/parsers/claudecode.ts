import type { Kind, Role, TranscriptEvent } from "../../types.ts";

import {
  asString,
  buildEvent,
  type EventContext,
  isObject,
  matchToolText,
  parseErrorEvent,
  type RawObject,
  splitJSONL,
  stripIDEContextTags,
  unwrapUserQuery,
} from "../shared.ts";

type LinePreprocessor = (raw: RawObject) => RawObject;

function pickRole(raw: RawObject): Role {
  const direct = raw.role;
  if (direct === "user" || direct === "assistant" || direct === "tool") return direct;
  if (direct === "human") return "user";
  const message = raw.message;
  if (isObject(message)) {
    const r = message.role;
    if (r === "user" || r === "assistant") return r;
    if (r === "human") return "user";
  }
  const type = raw.type;
  if (type === "user" || type === "human") return "user";
  if (type === "assistant") return "assistant";
  return "unknown";
}

function extractText(raw: RawObject): {
  text: string;
  toolUseName: string | null;
  toolPath: string | null;
} {
  const message = raw.message;
  if (isObject(message)) {
    const content = message.content;
    if (Array.isArray(content)) {
      const parts: string[] = [];
      let toolUseName: string | null = null;
      let toolPath: string | null = null;
      for (const item of content) {
        if (!isObject(item)) continue;
        if (item.type === "text" && typeof item.text === "string") {
          parts.push(item.text);
        } else if (item.type === "tool_use") {
          if (toolUseName === null && typeof item.name === "string") {
            toolUseName = item.name;
          }
          if (toolPath === null && isObject(item.input)) {
            const inp = item.input;
            for (const key of ["file_path", "filePath", "path"] as const) {
              const v = inp[key];
              if (typeof v === "string" && v.length > 0) {
                toolPath = v;
                break;
              }
            }
          }
        } else if (item.type === "tool_result") {
          const c = item.content;
          if (typeof c === "string") parts.push(c);
        }
      }
      const joined = parts.join("\n").trim();
      return { text: stripIDEContextTags(joined), toolUseName, toolPath };
    }
    if (typeof content === "string") {
      return { text: stripIDEContextTags(content), toolUseName: null, toolPath: null };
    }
  }
  if (typeof raw.text === "string") {
    return { text: unwrapUserQuery(raw.text), toolUseName: null, toolPath: null };
  }
  return { text: "", toolUseName: null, toolPath: null };
}

function classify(
  role: Role,
  toolUseName: string | null,
  text: string,
  rawToolPath: string | null,
): { role: Role; kind: Kind; subtype: string; path: string | null } {
  // Structured tool_use (assistant): keep role=assistant, kind=tool.
  if (toolUseName !== null) {
    return {
      role,
      kind: "tool",
      subtype: toolUseName.toLowerCase(),
      path: rawToolPath,
    };
  }

  // Cursor-style "[Tool] Read: path" text-only line: reclassify to role=tool.
  const matched = matchToolText(text);
  if (matched) {
    return { role: "tool", kind: "tool", subtype: matched.subtype, path: matched.path };
  }

  if (role === "tool") {
    return { role, kind: "tool", subtype: "unknown", path: null };
  }
  if (role === "user" || role === "assistant") {
    return { role, kind: "message", subtype: "text", path: null };
  }
  return { role, kind: "unknown", subtype: "unknown", path: null };
}

export function parseClaudeCodeBody(
  ctx: EventContext,
  body: string,
  preprocess?: LinePreprocessor,
): TranscriptEvent[] {
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
    if (!isObject(raw)) {
      events.push({
        session_id: ctx.session_id,
        checkpoint_id: ctx.checkpoint_id,
        session_index: ctx.session_index,
        event_index: event_index++,
        role: "unknown",
        kind: "unknown",
        subtype: "unknown",
        text: "",
        path: null,
        raw,
      });
      continue;
    }
    const obj = preprocess ? preprocess(raw) : raw;
    const role0 = pickRole(obj);
    const { text, toolUseName, toolPath } = extractText(obj);
    const { role, kind, subtype, path } = classify(role0, toolUseName, text, toolPath);
    events.push(
      buildEvent(ctx, event_index++, {
        role,
        kind,
        subtype,
        text,
        path,
        raw: obj,
      }),
    );
  }
  // Reference asString to keep import set tidy if shared.ts widens later.
  void asString;
  return events;
}
