import { describe, expect, test } from "vite-plus/test";

import { detectFormat } from "../src/lib/transcript/index.ts";
import { parseClaudeCodeBody } from "../src/lib/transcript/parsers/claudecode.ts";
import { parseCodexBody } from "../src/lib/transcript/parsers/codex.ts";
import { parseCopilotBody } from "../src/lib/transcript/parsers/copilot.ts";
import { parseDroidBody } from "../src/lib/transcript/parsers/droid.ts";
import { parseGeminiBody } from "../src/lib/transcript/parsers/gemini.ts";
import { parseOpenCodeBody } from "../src/lib/transcript/parsers/opencode.ts";

const ctx = {
  checkpoint_id: "04aaaaaaaaaa",
  session_index: 0,
  session_id: "sess",
};

const jsonl = (rows: unknown[]) => rows.map((r) => JSON.stringify(r)).join("\n") + "\n";

describe("detectFormat", () => {
  test("opencode (single JSON with info+messages)", () => {
    const body = JSON.stringify({ info: { id: "s" }, messages: [] });
    expect(detectFormat(body)).toBe("opencode");
  });

  test("gemini (single JSON with sessionId+messages, no info)", () => {
    const body = JSON.stringify({ sessionId: "s", messages: [] });
    expect(detectFormat(body)).toBe("gemini");
  });

  test("codex (response_item)", () => {
    const body = jsonl([{ type: "session_meta" }, { type: "response_item", payload: {} }]);
    expect(detectFormat(body)).toBe("codex");
  });

  test("copilot (user.message)", () => {
    const body = jsonl([
      { type: "session.start" },
      { type: "user.message", data: { content: "hi" } },
    ]);
    expect(detectFormat(body)).toBe("copilot");
  });

  test("droid (envelope)", () => {
    const body = jsonl([
      { type: "session_start" },
      { type: "message", id: "m1", message: { role: "user", content: "hi" } },
    ]);
    expect(detectFormat(body)).toBe("droid");
  });

  test("claude code fallback", () => {
    const body = jsonl([{ role: "user", message: { content: "hi" } }]);
    expect(detectFormat(body)).toBe("claudecode");
  });
});

describe("claudecode parser", () => {
  test("user/assistant text + tool_use; preserves event_index across parse errors", () => {
    const body =
      jsonl([
        { type: "file-history-snapshot" },
        { role: "user", message: { content: [{ type: "text", text: "Hello" }] } },
        {
          role: "assistant",
          message: {
            content: [
              { type: "text", text: "Reading" },
              { type: "tool_use", name: "Read", input: { file_path: "src/foo.ts" } },
            ],
          },
        },
      ]) + "{not valid json\n";
    const events = parseClaudeCodeBody(ctx, body);
    expect(events.map((e) => e.event_index)).toEqual([0, 1, 2, 3]);
    expect(events[1]).toMatchObject({ role: "user", kind: "message", text: "Hello" });
    expect(events[2]).toMatchObject({
      role: "assistant",
      kind: "tool",
      subtype: "read",
      path: "src/foo.ts",
    });
    expect(events[3]?.role).toBe("unknown");
    expect((events[3]?.raw as { _parse_error?: string })._parse_error).toBeDefined();
  });
});

describe("codex parser", () => {
  test("emits user/assistant/tool events; drops session_meta and system blocks", () => {
    const body = jsonl([
      { type: "session_meta", payload: {} },
      {
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [
            { type: "input_text", text: "<environment_context>noise</environment_context>" },
            { type: "input_text", text: "Real prompt" },
          ],
        },
      },
      {
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "Reading file" }],
        },
      },
      {
        type: "response_item",
        payload: {
          type: "function_call",
          name: "Read",
          arguments: JSON.stringify({ file_path: "src/foo.ts" }),
          call_id: "c1",
        },
      },
      {
        type: "response_item",
        payload: { type: "function_call_output", call_id: "c1", output: "file contents" },
      },
    ]);
    const events = parseCodexBody(ctx, body);
    expect(events.map((e) => [e.role, e.kind, e.subtype])).toEqual([
      ["user", "message", "text"],
      ["assistant", "message", "text"],
      ["assistant", "tool", "read"],
      ["tool", "tool", "result"],
    ]);
    expect(events[0]?.text).toBe("Real prompt");
    expect(events[2]?.path).toBe("src/foo.ts");
    expect(events[3]?.text).toBe("file contents");
  });
});

describe("copilot parser", () => {
  test("user/assistant/tool with toolRequests becoming kind=tool", () => {
    const body = jsonl([
      { type: "session.start" },
      { type: "user.message", data: { content: "Read foo" } },
      {
        type: "assistant.message",
        data: {
          messageId: "m1",
          content: "",
          toolRequests: [
            {
              toolCallId: "t1",
              name: "ReadFile",
              arguments: JSON.stringify({ filePath: "src/foo.ts" }),
            },
          ],
        },
      },
      {
        type: "tool.execution_complete",
        data: { toolCallId: "t1", success: true, result: { content: "ok" } },
      },
    ]);
    const events = parseCopilotBody(ctx, body);
    expect(events.map((e) => [e.role, e.kind, e.subtype])).toEqual([
      ["user", "message", "text"],
      ["assistant", "tool", "readfile"],
      ["tool", "tool", "result"],
    ]);
    expect(events[1]?.path).toBe("src/foo.ts");
    expect(events[2]?.text).toBe("ok");
  });
});

describe("opencode parser", () => {
  test("emits per-part events; tool with output yields tool_use + result", () => {
    const body = JSON.stringify({
      info: { id: "s" },
      messages: [
        {
          info: { role: "user", time: { created: 1 } },
          parts: [{ type: "text", text: "Hello" }],
        },
        {
          info: { role: "assistant", time: { created: 2 } },
          parts: [
            { type: "step-start" },
            { type: "text", text: "Looking" },
            {
              type: "tool",
              tool: "Read",
              callID: "c1",
              state: { input: { file_path: "src/foo.ts" }, output: "ok", status: "completed" },
            },
          ],
        },
      ],
    });
    const events = parseOpenCodeBody(ctx, body);
    expect(events.map((e) => [e.role, e.kind, e.subtype])).toEqual([
      ["user", "message", "text"],
      ["assistant", "message", "text"],
      ["assistant", "tool", "read"],
      ["tool", "tool", "result"],
    ]);
    expect(events[2]?.path).toBe("src/foo.ts");
    expect(events[3]?.text).toBe("ok");
  });
});

describe("gemini parser", () => {
  test("info dropped; gemini message yields text + per-toolCall events", () => {
    const body = JSON.stringify({
      sessionId: "s",
      messages: [
        { id: "1", timestamp: "t", type: "info", content: "system" },
        { id: "2", timestamp: "t", type: "user", content: "Read it" },
        {
          id: "3",
          timestamp: "t",
          type: "gemini",
          content: "Ok",
          toolCalls: [
            {
              id: "tc1",
              name: "read_file",
              args: { absolute_path: "src/foo.ts" },
              status: "success",
              result: [{ functionResponse: { response: { output: "contents" } } }],
            },
          ],
        },
      ],
    });
    const events = parseGeminiBody(ctx, body);
    expect(events.map((e) => [e.role, e.kind, e.subtype])).toEqual([
      ["user", "message", "text"],
      ["assistant", "message", "text"],
      ["assistant", "tool", "read_file"],
      ["tool", "tool", "result"],
    ]);
    expect(events[2]?.path).toBe("src/foo.ts");
    expect(events[3]?.text).toBe("contents");
  });
});

describe("droid parser", () => {
  test("envelope is unwrapped before claude code parsing", () => {
    const body = jsonl([
      { type: "session_start" },
      {
        type: "message",
        id: "m1",
        timestamp: "t",
        message: {
          role: "user",
          content: [{ type: "text", text: "Hi" }],
        },
      },
      {
        type: "message",
        id: "m2",
        timestamp: "t",
        message: {
          role: "assistant",
          content: [{ type: "tool_use", name: "Edit", input: { file_path: "src/foo.ts" } }],
        },
      },
    ]);
    const events = parseDroidBody(ctx, body);
    // session_start envelope falls through claude code dispatch as unknown raw
    // (kind=unknown), so we expect at least the user + assistant rows tagged.
    const tagged = events.filter((e) => e.kind !== "unknown");
    expect(tagged.map((e) => [e.role, e.kind, e.subtype])).toEqual([
      ["user", "message", "text"],
      ["assistant", "tool", "edit"],
    ]);
    expect(tagged[1]?.path).toBe("src/foo.ts");
  });
});

