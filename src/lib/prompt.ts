import { GitNotFoundError, gitShow, type RepoContext } from "./git.ts";
import { checkpointDir } from "./paths.ts";

export async function loadPromptText(
  repo: RepoContext,
  id: string,
  index: number,
): Promise<string | null> {
  const path = `${checkpointDir(id)}/${index}/prompt.txt`;
  try {
    return await gitShow(repo, path);
  } catch (err) {
    if (err instanceof GitNotFoundError) return null;
    throw err;
  }
}

export function buildPromptPreview(text: string | null, max = 200): string | null {
  if (text === null) return null;
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length === 0) return "";
  if (collapsed.length <= max) return collapsed;
  return `${collapsed.slice(0, max)}…`;
}
