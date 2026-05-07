import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test";

import checkpoint from "../src/commands/checkpoint/index.ts";
import checkpointList from "../src/commands/checkpoint/list.ts";
import { buildFixture, FIXTURE_CHECKPOINT_ID, type Fixture } from "./fixtures.ts";
import { runEq } from "./helpers.ts";

let fx: Fixture;
beforeAll(() => {
  fx = buildFixture();
});
afterAll(() => fx.cleanup());

describe("eq checkpoint", () => {
  test("returns Checkpoint JSON for a valid id", async () => {
    const r = await runEq(checkpoint, [FIXTURE_CHECKPOINT_ID, "--repo", fx.root]);
    expect(r.exitCode).toBe(0);
    expect(r.output).toMatchObject({
      kind: "json",
      document: {
        checkpoint_id: FIXTURE_CHECKPOINT_ID,
        branch: "feature/x",
        files_touched: ["src/foo.ts", "src/bar.ts"],
        sessions: [
          { index: 0, session_id: "11111111-1111-1111-1111-111111111111", path: "04/aaaaaaaaaa/0" },
          { index: 1, session_id: "22222222-2222-2222-2222-222222222222", path: "04/aaaaaaaaaa/1" },
        ],
        token_usage: { api_call_count: 5 },
      },
    });
  });

  test("paths in output never have a leading slash", async () => {
    const r = await runEq(checkpoint, [FIXTURE_CHECKPOINT_ID, "--repo", fx.root]);
    if (r.output.kind !== "json") throw new Error("expected json output");
    for (const s of r.output.document!.sessions) expect(s.path.startsWith("/")).toBe(false);
  });

  test("unknown 12-hex id → checkpoint/not-found", async () => {
    const r = await runEq(checkpoint, ["999999999999", "--repo", fx.root]);
    expect(r.error?.kind).toBe("checkpoint/not-found");
  });

  test("commit SHA with Entire-Checkpoint trailer is resolved", async () => {
    const r = await runEq(checkpoint, [fx.appCommit, "--repo", fx.root]);
    expect(r.exitCode).toBe(0);
    if (r.output.kind !== "json") throw new Error("expected json output");
    expect(r.output.document?.checkpoint_id).toBe(FIXTURE_CHECKPOINT_ID);
  });

  test("named ref (HEAD) with trailer is resolved", async () => {
    const r = await runEq(checkpoint, ["HEAD", "--repo", fx.root]);
    expect(r.exitCode).toBe(0);
    if (r.output.kind !== "json") throw new Error("expected json output");
    expect(r.output.document?.checkpoint_id).toBe(FIXTURE_CHECKPOINT_ID);
  });

  test("commit without trailer → checkpoint/not-found", async () => {
    const r = await runEq(checkpoint, ["main~1", "--repo", fx.root]);
    expect(r.error?.kind).toBe("checkpoint/not-found");
  });

  test("garbage ref (neither id nor valid git ref) → checkpoint/not-found", async () => {
    const r = await runEq(checkpoint, ["zzz", "--repo", fx.root]);
    expect(r.error?.kind).toBe("checkpoint/not-found");
  });

  test("missing entire branch → entire/branch-not-found", async () => {
    const fx2 = buildFixture();
    const { execFileSync } = await import("node:child_process");
    execFileSync("git", ["branch", "-D", "entire/checkpoints/v1"], { cwd: fx2.root });
    const r = await runEq(checkpoint, [FIXTURE_CHECKPOINT_ID, "--repo", fx2.root]);
    expect(r.error?.kind).toBe("entire/branch-not-found");
    fx2.cleanup();
  });
});

describe("eq checkpoint list", () => {
  test("yields all checkpoints as NDJSON records", async () => {
    const r = await runEq(checkpointList, ["--repo", fx.root]);
    expect(r.exitCode).toBe(0);
    if (r.output.kind !== "jsonl") throw new Error("expected jsonl output");
    expect(r.output.records).toHaveLength(1);
    expect(r.output.records[0]!.checkpoint_id).toBe(FIXTURE_CHECKPOINT_ID);
  });

  test("--file filters by files_touched", async () => {
    const hit = await runEq(checkpointList, ["--file", "src/foo.ts", "--repo", fx.root]);
    if (hit.output.kind !== "jsonl") throw new Error("expected jsonl output");
    expect(hit.output.records).toHaveLength(1);
    const miss = await runEq(checkpointList, ["--file", "src/none.ts", "--repo", fx.root]);
    if (miss.output.kind !== "jsonl") throw new Error("expected jsonl output");
    expect(miss.output.records).toHaveLength(0);
  });

  test("captured stdout is one compact JSON per line", async () => {
    const r = await runEq(checkpointList, ["--repo", fx.root]);
    expect(r.exitCode).toBe(0);
    const lines = r.stdout.split("\n").filter((l) => l.length > 0);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!).checkpoint_id).toBe(FIXTURE_CHECKPOINT_ID);
  });
});
