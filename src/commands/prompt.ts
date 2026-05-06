import { defineCommand } from "@rune-cli/rune";

import { assertCheckpointId } from "../lib/paths.ts";
import { loadPromptText } from "../lib/prompt.ts";
import { findSessionId } from "../lib/session.ts";

export default defineCommand({
  description: "Fetch a session's prompt.txt",
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
    const prompt = await loadPromptText(locals.repo, args.id, options.session);
    const data = {
      checkpoint_id: args.id,
      session_index: options.session,
      session_id,
      prompt,
    };
    output.log(JSON.stringify(data, null, 2));

    return data;
  },
});
