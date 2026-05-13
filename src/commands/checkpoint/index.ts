import { defineCommand } from "@rune-cli/rune";

import { loadCheckpoint } from "../../lib/checkpoint.ts";
import { fail } from "../../lib/errors.ts";
import { resolveCheckpointFromCommit } from "../../lib/git.ts";
import { isCheckpointId } from "../../lib/paths.ts";

export default defineCommand({
  description:
    "Fetch checkpoint metadata as JSON. Accepts either a 12-hex checkpoint id or any commit ref (HEAD, sha, branch) — commits are resolved via the Entire-Checkpoint trailer.",
  json: true,
  args: [
    {
      name: "ref",
      type: "string",
      required: true,
      description: "Checkpoint id or git ref resolved via the Entire-Checkpoint trailer",
    },
  ],
  async run({ args, output, locals }) {
    let id: string;
    if (isCheckpointId(args.ref)) {
      id = args.ref;
    } else {
      const resolved = await resolveCheckpointFromCommit(locals.repo, args.ref);
      if (!resolved) {
        fail("checkpoint/not-found", `no Entire-Checkpoint trailer on commit: ${args.ref}`, {
          details: { commit: args.ref },
        });
      }
      id = resolved;
    }

    const data = await loadCheckpoint(locals.repo, id);
    output.log(JSON.stringify(data, null, 2));

    return data;
  },
});
