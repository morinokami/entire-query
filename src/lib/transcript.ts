import { fail } from "./errors.ts";
import { GitNotFoundError, gitShow, type RepoContext } from "./git.ts";
import { assertCheckpointId, checkpointDir } from "./paths.ts";
import { findSessionId } from "./session.ts";
import { type Kind, type Role, type TranscriptEvent } from "./types.ts";

const TOOL_TEXT_RE = /^\[Tool\]\s+(Read|Edit|Bash|Agent):\s*(.*)$/s;

interface RawAny {
  [k: string]: unknown;
}

function isObject(v: unknown): v is RawAny {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function pickRole(raw: RawAny): Role {
  const direct = raw.role;
  if (direct === "user" || direct === "assistant" || direct === "tool") return direct;
  const message = raw.message;
  if (isObject(message)) {
    const r = message.role;
    if (r === "user" || r === "assistant") return r;
  }
  const type = raw.type;
  if (type === "user") return "user";
  if (type === "assistant") return "assistant";
  return "unknown";
}

function unwrapUserQuery(text: string): string {
  const m = text.match(/^\s*<user_query>\s*([\s\S]*?)\s*<\/user_query>\s*$/);
  return m ? (m[1] ?? text) : text;
}

function extractText(raw: RawAny): { text: string; toolUseName: string | null } {
  const message = raw.message;
  if (isObject(message)) {
    const content = message.content;
    if (Array.isArray(content)) {
      const parts: string[] = [];
      let toolUseName: string | null = null;
      for (const item of content) {
        if (!isObject(item)) continue;
        if (item.type === "text" && typeof item.text === "string") parts.push(item.text);
        if (item.type === "tool_use" && toolUseName === null && typeof item.name === "string") {
          toolUseName = item.name;
        }
      }
      const joined = parts.join("\n").trim();
      return { text: unwrapUserQuery(joined), toolUseName };
    }
    if (typeof message.content === "string") {
      return { text: unwrapUserQuery(message.content), toolUseName: null };
    }
  }
  if (typeof raw.text === "string") return { text: unwrapUserQuery(raw.text), toolUseName: null };
  return { text: "", toolUseName: null };
}

function matchToolText(text: string): { subtype: string; path: string | null } | null {
  const m = text.match(TOOL_TEXT_RE);
  if (!m) return null;
  const subtype = (m[1] ?? "").toLowerCase();
  const rest = (m[2] ?? "").trim();
  const firstToken = rest.split(/\s+/)[0] ?? "";
  const path = firstToken.length > 0 && /^[\w./@:-]+$/.test(firstToken) ? firstToken : null;
  return { subtype, path };
}

function classify(
  role: Role,
  toolUseName: string | null,
  text: string,
): { role: Role; kind: Kind; subtype: string; toolPath: string | null } {
  // Structured tool call (Claude Code): keep original role (typically assistant)
  if (toolUseName !== null) {
    return { role, kind: "tool", subtype: toolUseName.toLowerCase(), toolPath: null };
  }

  // Text-only tool record (Cursor-style "[Tool] Read: …"): reclassify to role=tool
  const matched = matchToolText(text);
  if (matched) {
    return { role: "tool", kind: "tool", subtype: matched.subtype, toolPath: matched.path };
  }

  // tool_result row with explicit role=tool
  if (role === "tool") {
    return { role, kind: "tool", subtype: "unknown", toolPath: null };
  }

  if (role === "user" || role === "assistant") {
    return { role, kind: "message", subtype: "text", toolPath: null };
  }

  return { role, kind: "unknown", subtype: "unknown", toolPath: null };
}

function normalizeLine(
  line: string,
  ctx: {
    checkpoint_id: string;
    session_index: number;
    session_id: string | null;
    event_index: number;
  },
): TranscriptEvent {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch (err) {
    return {
      session_id: ctx.session_id,
      checkpoint_id: ctx.checkpoint_id,
      session_index: ctx.session_index,
      event_index: ctx.event_index,
      role: "unknown",
      kind: "unknown",
      subtype: "unknown",
      text: "",
      path: null,
      raw: { _parse_error: String(err), _raw_line: line },
    };
  }
  if (!isObject(raw)) {
    return {
      session_id: ctx.session_id,
      checkpoint_id: ctx.checkpoint_id,
      session_index: ctx.session_index,
      event_index: ctx.event_index,
      role: "unknown",
      kind: "unknown",
      subtype: "unknown",
      text: "",
      path: null,
      raw,
    };
  }
  const role0 = pickRole(raw);
  const { text, toolUseName } = extractText(raw);
  const { role, kind, subtype, toolPath } = classify(role0, toolUseName, text);
  return {
    session_id: ctx.session_id,
    checkpoint_id: ctx.checkpoint_id,
    session_index: ctx.session_index,
    event_index: ctx.event_index,
    role,
    kind,
    subtype,
    text,
    path: toolPath,
    raw,
  };
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
  const events: TranscriptEvent[] = [];
  let event_index = 0;
  for (const line of body.split("\n")) {
    if (line.length === 0) continue;
    events.push(
      normalizeLine(line, {
        checkpoint_id: id,
        session_index: sessionIndex,
        session_id,
        event_index,
      }),
    );
    event_index += 1;
  }
  return events;
}
