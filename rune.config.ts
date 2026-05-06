import { defineConfig } from "@rune-cli/rune";

import { resolveRepo } from "./src/lib/git.ts";

export default defineConfig({
  name: "eq",
  options: [
    {
      name: "repo",
      type: "string",
      description: "Path to target Git repository (defaults to cwd)",
    },
  ],
  async locals({ options, cwd }) {
    return {
      repo: await resolveRepo(options.repo, cwd),
    };
  },
});
