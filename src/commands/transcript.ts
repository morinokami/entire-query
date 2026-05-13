import { defineCommand } from "@rune-cli/rune";

import { loadTranscript } from "../lib/transcript/index.ts";

export default defineCommand({
  description: "Stream a session's transcript as normalized NDJSON events",
  jsonl: true,
  args: [
    {
      name: "id",
      type: "string",
      required: true,
      description: "Checkpoint id containing the session",
    },
  ],
  options: [
    {
      name: "session",
      type: "number",
      required: true,
      description: "Session index within the checkpoint",
    },
    {
      name: "role",
      type: "enum",
      values: ["user", "assistant", "tool", "unknown"],
      description: "Filter events by role",
    },
  ],
  async *run({ args, options, locals }) {
    const events = await loadTranscript(locals.repo, args.id, options.session);
    for (const e of events) {
      if (options.role && e.role !== options.role) continue;
      yield e;
    }
  },
});
