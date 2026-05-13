import { defineCommand } from "@rune-cli/rune";

import { loadSession } from "../../lib/session.ts";

export default defineCommand({
  description: "Get a single session's full metadata",
  json: true,
  args: [
    {
      name: "id",
      type: "string",
      required: true,
      description: "Checkpoint id",
    },
  ],
  options: [
    {
      name: "index",
      type: "number",
      required: true,
      description: "Session index within the checkpoint",
    },
  ],
  async run({ args, options, output, locals }) {
    const data = await loadSession(locals.repo, args.id, options.index);
    output.log(JSON.stringify(data, null, 2));

    return data;
  },
});
