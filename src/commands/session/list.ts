import { defineCommand } from "@rune-cli/rune";

import { loadSessionList } from "../../lib/session.ts";

export default defineCommand({
  description: "Stream sessions in a checkpoint as NDJSON",
  jsonl: true,
  args: [{ name: "id", type: "string", required: true }],
  options: [
    {
      name: "file",
      type: "string",
      description: "Filter to sessions whose files_touched includes this path",
    },
  ],
  async *run({ args, options, locals }) {
    const summaries = await loadSessionList(locals.repo, args.id, { file: options.file });
    for (const s of summaries) {
      yield s;
    }
  },
});
