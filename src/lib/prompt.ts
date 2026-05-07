import { GitNotFoundError, gitShow, type RepoContext } from "./git.ts";
import { checkpointDir } from "./paths.ts";

const PROMPT_SEPARATOR = "\n\n---\n\n";

// Entire writes one prompt.txt per session that may accumulate multiple
// prompts across turns, joined by `\n\n---\n\n`. Mirrors splitPromptContent
// in cli-main/cmd/entire/cli/strategy/manual_commit_condensation.go.
export function splitPrompts(text: string): string[] {
  if (text.length === 0) return [];
  return text
    .split(PROMPT_SEPARATOR)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

export async function loadPrompts(
  repo: RepoContext,
  id: string,
  index: number,
): Promise<string[] | null> {
  const path = `${checkpointDir(id)}/${index}/prompt.txt`;
  try {
    return splitPrompts(await gitShow(repo, path));
  } catch (err) {
    if (err instanceof GitNotFoundError) return null;
    throw err;
  }
}

export function buildPromptPreview(prompt: string | null, max = 200): string | null {
  if (prompt === null) return null;
  const collapsed = prompt.replace(/\s+/g, " ").trim();
  if (collapsed.length === 0) return "";
  if (collapsed.length <= max) return collapsed;
  return `${collapsed.slice(0, max)}…`;
}
