import { defineCommand } from "@rune-cli/rune";

import { loadCheckpoint } from "../../lib/checkpoint.ts";
import { fail } from "../../lib/errors.ts";
import { resolveCheckpointFromCommit } from "../../lib/git.ts";

export default defineCommand({
  description: "Fetch checkpoint metadata as JSON",
  json: true,
  args: [{ name: "id", type: "string" }],
  options: [
    {
      name: "commit",
      type: "string",
      description: "Resolve checkpoint id from a commit SHA's Entire-Checkpoint trailer",
    },
  ],
  async run({ args, options, output, locals }) {
    if (args.id && options.commit) {
      fail("invalid-arguments", "Provide either <id> or --commit, not both");
    }

    let id: string;
    if (options.commit) {
      const resolved = await resolveCheckpointFromCommit(locals.repo, options.commit);
      if (!resolved) {
        fail("checkpoint/not-found", `no Entire-Checkpoint trailer on commit: ${options.commit}`, {
          details: { commit: options.commit },
        });
      }
      id = resolved;
    } else if (args.id) {
      id = args.id;
    } else {
      fail("invalid-arguments", "Provide <id> or --commit <sha>");
    }

    const data = await loadCheckpoint(locals.repo, id);
    output.log(JSON.stringify(data, null, 2));

    return data;
  },
});
