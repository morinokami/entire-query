import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test";

import sessionGet from "../src/commands/session/get.ts";
import sessionList from "../src/commands/session/list.ts";
import { buildFixture, FIXTURE_CHECKPOINT_ID, type Fixture } from "./fixtures.ts";
import { runEq } from "./helpers.ts";

let fx: Fixture;
beforeAll(() => {
  fx = buildFixture();
});
afterAll(() => fx.cleanup());

function jsonDoc<T>(r: { output: { kind: string } }): T {
  if (r.output.kind !== "json") throw new Error("expected json output");
  return (r.output as unknown as { document: T }).document;
}

function records<T>(r: { output: { kind: string } }): T[] {
  if (r.output.kind !== "jsonl") throw new Error("expected jsonl output");
  return (r.output as unknown as { records: T[] }).records;
}

describe("eq session list", () => {
  test("yields SessionSummary records with prompt_preview and files_touched", async () => {
    const r = await runEq(sessionList, [FIXTURE_CHECKPOINT_ID, "--repo", fx.root]);
    expect(r.exitCode).toBe(0);
    const data = records<Record<string, unknown>>(r);
    expect(data).toHaveLength(2);
    const [s0, s1] = data;
    expect(s0).toMatchObject({
      index: 0,
      session_id: "11111111-1111-1111-1111-111111111111",
      agent: "Claude Code",
      turn_count: 7,
      path: "04/aaaaaaaaaa/0",
      files_touched: ["src/foo.ts"],
    });
    const preview = (s0 as { prompt_preview: string }).prompt_preview;
    expect(preview).toMatch(/Please review src\/foo\.ts/);
    expect(preview).not.toContain("---");
    expect(preview).not.toContain("Also add a unit test");
    expect(s1).toMatchObject({
      index: 1,
      agent: "Cursor",
      turn_count: 2,
      prompt_preview: null,
    });
  });

  test("prompt_preview collapses whitespace and truncates with …", async () => {
    const r = await runEq(sessionList, [FIXTURE_CHECKPOINT_ID, "--repo", fx.root]);
    const data = records<{ prompt_preview: string | null }>(r);
    const s0 = data[0]!;
    expect(s0.prompt_preview).not.toContain("\n");
    expect((s0.prompt_preview ?? "").length).toBeLessThanOrEqual(201);
  });

  test("--file filters sessions by their files_touched", async () => {
    const r = await runEq(sessionList, [
      FIXTURE_CHECKPOINT_ID,
      "--file",
      "src/bar.ts",
      "--repo",
      fx.root,
    ]);
    const data = records<{ index: number }>(r);
    expect(data).toHaveLength(1);
    expect(data[0]!.index).toBe(1);
  });

  test("unknown checkpoint → checkpoint/not-found", async () => {
    const r = await runEq(sessionList, ["999999999999", "--repo", fx.root]);
    expect(r.error?.kind).toBe("checkpoint/not-found");
  });
});

describe("eq session get", () => {
  test("returns full Session for a valid index", async () => {
    const r = await runEq(sessionGet, [FIXTURE_CHECKPOINT_ID, "--index", "0", "--repo", fx.root]);
    expect(r.exitCode).toBe(0);
    expect(r.output).toMatchObject({
      kind: "json",
      document: {
        checkpoint_id: FIXTURE_CHECKPOINT_ID,
        index: 0,
        session_id: "11111111-1111-1111-1111-111111111111",
        agent: "Claude Code",
        turn_id: "turn0",
        session_metrics: {
          turn_count: 7,
          duration_ms: 142340,
          context_tokens: 87521,
          context_window_size: 200000,
        },
        initial_attribution: { agent_lines: 50, agent_percentage: 80 },
        files: {
          metadata: "04/aaaaaaaaaa/0/metadata.json",
          transcript: "04/aaaaaaaaaa/0/full.jsonl",
          prompt: "04/aaaaaaaaaa/0/prompt.txt",
        },
      },
    });
  });

  test("file paths in output never have a leading slash", async () => {
    const r = await runEq(sessionGet, [FIXTURE_CHECKPOINT_ID, "--index", "0", "--repo", fx.root]);
    const data = jsonDoc<{ files: Record<string, string | null> }>(r);
    for (const v of Object.values(data.files)) {
      if (v) expect(v.startsWith("/")).toBe(false);
    }
  });

  test("token_usage.subagent_tokens is surfaced when present, null otherwise", async () => {
    const r0 = await runEq(sessionGet, [FIXTURE_CHECKPOINT_ID, "--index", "0", "--repo", fx.root]);
    expect(r0.exitCode).toBe(0);
    expect(r0.output).toMatchObject({
      kind: "json",
      document: {
        token_usage: {
          api_call_count: 4,
          subagent_tokens: {
            input_tokens: 5,
            cache_creation_tokens: 1000,
            cache_read_tokens: 2000,
            output_tokens: 80,
            api_call_count: 1,
            subagent_tokens: null,
          },
        },
      },
    });

    const r1 = await runEq(sessionGet, [FIXTURE_CHECKPOINT_ID, "--index", "1", "--repo", fx.root]);
    expect(r1.output).toMatchObject({
      kind: "json",
      document: { token_usage: { subagent_tokens: null } },
    });
  });

  test("session_metrics falls back to api_call_count when not reported", async () => {
    const r = await runEq(sessionGet, [FIXTURE_CHECKPOINT_ID, "--index", "1", "--repo", fx.root]);
    expect(r.exitCode).toBe(0);
    expect(r.output).toMatchObject({
      kind: "json",
      document: {
        index: 1,
        session_metrics: {
          turn_count: 2,
          duration_ms: null,
          context_tokens: null,
          context_window_size: null,
        },
      },
    });
  });

  test("missing index → session/not-found", async () => {
    const r = await runEq(sessionGet, [FIXTURE_CHECKPOINT_ID, "--index", "99", "--repo", fx.root]);
    expect(r.error?.kind).toBe("session/not-found");
  });
});
