import { isObject } from "./shared.ts";

export type Format = "opencode" | "gemini" | "codex" | "copilot" | "droid" | "claudecode"; // also Cursor (same wire format)

const CLAUDE_USER_ALIASES = new Set(["user", "human"]);
const CLAUDE_DROPPED_TYPES = new Set([
  "progress",
  "file-history-snapshot",
  "queue-operation",
  "system",
]);

function probeFirstObject(body: string, max = 100): Record<string, unknown> | null {
  const lines = body.split("\n");
  let scanned = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    scanned += 1;
    try {
      const v = JSON.parse(trimmed);
      if (isObject(v)) return v;
    } catch {
      // ignore, try next line
    }
    if (scanned >= max) break;
  }
  return null;
}

function isOpenCode(body: string): boolean {
  const trimmed = body.trim();
  if (!trimmed.startsWith("{")) return false;
  try {
    const v = JSON.parse(trimmed);
    return isObject(v) && "info" in v && "messages" in v;
  } catch {
    return false;
  }
}

function isGemini(body: string): boolean {
  const trimmed = body.trim();
  if (!trimmed.startsWith("{")) return false;
  try {
    const v = JSON.parse(trimmed);
    return isObject(v) && "sessionId" in v && "messages" in v && !("info" in v);
  } catch {
    return false;
  }
}

function classifyJSONL(body: string): Format {
  // Walk lines; first decisive type/role wins.
  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    let v: unknown;
    try {
      v = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (!isObject(v)) continue;

    const type = typeof v.type === "string" ? v.type : "";

    // Codex sentinels.
    if (
      type === "session_meta" ||
      type === "response_item" ||
      type === "event_msg" ||
      type === "turn_context"
    ) {
      return "codex";
    }

    // Copilot sentinels.
    if (
      type === "session.start" ||
      type === "user.message" ||
      type === "assistant.message" ||
      type === "tool.execution_complete"
    ) {
      return "copilot";
    }

    // Droid: type=message + nested message object.
    if (type === "message" && isObject(v.message)) {
      return "droid";
    }

    // Claude Code / Cursor: user/assistant/human top-level type, or role field.
    if (CLAUDE_USER_ALIASES.has(type) || type === "assistant") {
      return "claudecode";
    }
    if (CLAUDE_DROPPED_TYPES.has(type)) {
      // Skip and keep looking.
      continue;
    }
    const role = typeof v.role === "string" ? v.role : "";
    if (CLAUDE_USER_ALIASES.has(role) || role === "assistant") {
      return "claudecode";
    }
  }
  // Fallback: treat as Claude Code so the existing parser still produces
  // best-effort events (parse-error rows etc.) instead of throwing.
  return "claudecode";
}

export function detectFormat(body: string): Format {
  if (isOpenCode(body)) return "opencode";
  if (isGemini(body)) return "gemini";
  // probe first object as a quick reject of pathological inputs (not strictly needed)
  void probeFirstObject;
  return classifyJSONL(body);
}
