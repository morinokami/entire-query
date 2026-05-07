import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test";

import prompt from "../src/commands/prompt.ts";
import { buildFixture, FIXTURE_CHECKPOINT_ID, type Fixture } from "./fixtures.ts";
import { runEq } from "./helpers.ts";

let fx: Fixture;
beforeAll(() => {
  fx = buildFixture();
});
afterAll(() => fx.cleanup());

describe("eq prompt", () => {
  test("splits prompt.txt on the Entire turn separator", async () => {
    const r = await runEq(prompt, [FIXTURE_CHECKPOINT_ID, "--session", "0", "--repo", fx.root]);
    expect(r.exitCode).toBe(0);
    expect(r.output).toEqual({
      kind: "json",
      document: {
        checkpoint_id: FIXTURE_CHECKPOINT_ID,
        session_index: 0,
        session_id: "11111111-1111-1111-1111-111111111111",
        prompts: [
          "Please review src/foo.ts thoroughly.",
          "Also add a unit test for it.",
        ],
      },
    });
  });

  test("missing prompt.txt → prompts: null (no error)", async () => {
    const r = await runEq(prompt, [FIXTURE_CHECKPOINT_ID, "--session", "1", "--repo", fx.root]);
    expect(r.exitCode).toBe(0);
    if (r.output.kind !== "json") throw new Error("expected json output");
    expect(r.output.document?.prompts).toBeNull();
    expect(r.output.document?.session_id).toBe("22222222-2222-2222-2222-222222222222");
  });
});
