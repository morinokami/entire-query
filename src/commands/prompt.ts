import { defineCommand } from "@rune-cli/rune";

import type { PromptResult } from "../lib/types.ts";

import { assertCheckpointId } from "../lib/paths.ts";
import { loadPrompts } from "../lib/prompt.ts";
import { findSessionId } from "../lib/session.ts";

export default defineCommand({
  description: "Fetch a session's prompts (split on the Entire turn separator)",
  json: true,
  args: [{ name: "id", type: "string", required: true }],
  options: [
    {
      name: "session",
      type: "number",
      required: true,
      description: "Session index within the checkpoint",
    },
  ],
  async run({ args, options, output, locals }) {
    assertCheckpointId(args.id);

    const session_id = await findSessionId(locals.repo, args.id, options.session);
    const prompts = await loadPrompts(locals.repo, args.id, options.session);
    const data: PromptResult = {
      checkpoint_id: args.id,
      session_index: options.session,
      session_id,
      prompts,
    };
    output.log(JSON.stringify(data, null, 2));

    return data;
  },
});
