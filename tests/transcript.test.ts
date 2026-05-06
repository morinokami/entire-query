import { afterAll, beforeAll, describe, expect, test } from "vitest";

import type { TranscriptEvent } from "../src/lib/types.ts";

import transcript from "../src/commands/transcript.ts";
import { buildFixture, FIXTURE_CHECKPOINT_ID, type Fixture } from "./fixtures.ts";
import { runEq } from "./helpers.ts";

let fx: Fixture;
beforeAll(() => {
  fx = buildFixture();
});
afterAll(() => fx.cleanup());

function records(r: { output: { kind: string } }): TranscriptEvent[] {
  if (r.output.kind !== "jsonl") throw new Error("expected jsonl output");
  return (r.output as unknown as { records: TranscriptEvent[] }).records;
}

describe("eq transcript", () => {
  test("yields normalized TranscriptEvent records with stable shape", async () => {
    const r = await runEq(transcript, [FIXTURE_CHECKPOINT_ID, "--session", "0", "--repo", fx.root]);
    expect(r.exitCode).toBe(0);
    const events = records(r);
    // 4 valid JSON rows + 1 invalid line = 5 events
    expect(events).toHaveLength(5);

    expect(events.map((e) => e.event_index)).toEqual([0, 1, 2, 3, 4]);

    for (const e of events) {
      expect(e.session_id).toBe("11111111-1111-1111-1111-111111111111");
      expect(e.checkpoint_id).toBe(FIXTURE_CHECKPOINT_ID);
      expect(e.session_index).toBe(0);
    }

    expect(events[0]).toMatchObject({ role: "unknown", kind: "unknown" });
    expect(events[1]).toMatchObject({ role: "user", kind: "message", text: "Hello there" });
    expect(events[2]).toMatchObject({
      role: "assistant",
      kind: "message",
      text: "Sure, reading the file.",
    });
    expect(events[3]).toMatchObject({ role: "assistant", kind: "tool" });
    expect(events[4]).toMatchObject({ role: "unknown", kind: "unknown", text: "" });
    expect((events[4]!.raw as { _parse_error?: string })._parse_error).toBeDefined();
  });

  test("--role filters to that role only", async () => {
    const r = await runEq(transcript, [
      FIXTURE_CHECKPOINT_ID,
      "--session",
      "0",
      "--role",
      "assistant",
      "--repo",
      fx.root,
    ]);
    const events = records(r);
    expect(events.every((e) => e.role === "assistant")).toBe(true);
    expect(events).toHaveLength(2);
  });

  test("[Tool] Read text-only is reclassified to role=tool", async () => {
    const r = await runEq(transcript, [
      FIXTURE_CHECKPOINT_ID,
      "--session",
      "1",
      "--role",
      "tool",
      "--repo",
      fx.root,
    ]);
    const events = records(r);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      role: "tool",
      kind: "tool",
      subtype: "read",
      path: "src/bar.ts",
    });
  });

  test("captured stdout is one compact JSON per line", async () => {
    const r = await runEq(transcript, [FIXTURE_CHECKPOINT_ID, "--session", "0", "--repo", fx.root]);
    expect(r.exitCode).toBe(0);
    const lines = r.stdout.split("\n").filter((l) => l.length > 0);
    expect(lines).toHaveLength(5);
    expect(JSON.parse(lines[0]!).event_index).toBe(0);
  });

  test("missing transcript → transcript/not-found", async () => {
    const r = await runEq(transcript, [
      FIXTURE_CHECKPOINT_ID,
      "--session",
      "99",
      "--repo",
      fx.root,
    ]);
    expect(r.error?.kind).toBe("transcript/not-found");
  });
});
