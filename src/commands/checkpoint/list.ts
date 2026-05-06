import { defineCommand } from "@rune-cli/rune";

import { listCheckpoints } from "../../lib/checkpoint.ts";

export default defineCommand({
  description: "Stream checkpoints on entire/checkpoints/v1 as NDJSON",
  jsonl: true,
  options: [
    {
      name: "file",
      type: "string",
      description: "Filter to checkpoints whose files_touched includes this path",
    },
  ],
  async *run({ options, locals }) {
    for await (const cp of listCheckpoints(locals.repo, { file: options.file })) {
      yield cp;
    }
  },
});
