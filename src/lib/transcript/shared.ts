import type { Kind, Role, TranscriptEvent } from "../types.ts";

export interface EventContext {
  checkpoint_id: string;
  session_index: number;
  session_id: string | null;
}

export interface PartialEvent {
  role: Role;
  kind: Kind;
  subtype: string;
  text: string;
  path: string | null;
  raw: unknown;
}

export function buildEvent(
  ctx: EventContext,
  event_index: number,
  p: PartialEvent,
): TranscriptEvent {
  return {
    session_id: ctx.session_id,
    checkpoint_id: ctx.checkpoint_id,
    session_index: ctx.session_index,
    event_index,
    role: p.role,
    kind: p.kind,
    subtype: p.subtype,
    text: p.text,
    path: p.path,
    raw: p.raw,
  };
}

export function parseErrorEvent(
  ctx: EventContext,
  event_index: number,
  err: unknown,
  line: string,
): TranscriptEvent {
  return buildEvent(ctx, event_index, {
    role: "unknown",
    kind: "unknown",
    subtype: "unknown",
    text: "",
    path: null,
    raw: { _parse_error: String(err), _raw_line: line },
  });
}

export interface RawObject {
  [k: string]: unknown;
}

export function isObject(v: unknown): v is RawObject {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

const USER_QUERY_RE = /^\s*<user_query>\s*([\s\S]*?)\s*<\/user_query>\s*$/;

export function unwrapUserQuery(text: string): string {
  const m = text.match(USER_QUERY_RE);
  return m ? (m[1] ?? text) : text;
}

// Strip IDE-injected context tags Cursor/Claude wrap around the real prompt.
// Mirrors textutil.StripIDEContextTags from the Entire CLI.
const IDE_TAG_RE =
  /<(ide_opened_file|ide_visible_files|ide_selection|ide_active_file|ide_workspace|ide_diagnostics|user_query)\b[^>]*>[\s\S]*?<\/\1>\s*/g;

export function stripIDEContextTags(text: string): string {
  if (!text) return text;
  // First pull the inner <user_query>... if present.
  const unwrapped = unwrapUserQuery(text);
  return unwrapped.replace(IDE_TAG_RE, "").trim();
}

const SAFE_PATH_RE = /^[\w./@:-]+$/;

function safePath(s: string): string | null {
  return s.length > 0 && SAFE_PATH_RE.test(s) ? s : null;
}

const TOOL_TEXT_RE = /^\[Tool\]\s+(Read|Edit|Bash|Agent):\s*(.*)$/s;

export function matchToolText(text: string): { subtype: string; path: string | null } | null {
  const m = text.match(TOOL_TEXT_RE);
  if (!m) return null;
  const subtype = (m[1] ?? "").toLowerCase();
  const rest = (m[2] ?? "").trim();
  const firstToken = rest.split(/\s+/)[0] ?? "";
  return { subtype, path: safePath(firstToken) };
}

export function splitJSONL(body: string): string[] {
  return body.split("\n").filter((l) => l.length > 0);
}
