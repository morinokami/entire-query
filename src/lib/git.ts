import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { fail } from "./errors.ts";
import { ENTIRE_BRANCH } from "./types.ts";

const execFileP = promisify(execFile);

export interface RepoContext {
  root: string;
  ref: string;
}

async function resolveEntireRef(root: string): Promise<string | null> {
  for (const ref of [ENTIRE_BRANCH, `refs/remotes/origin/${ENTIRE_BRANCH}`]) {
    try {
      await execFileP("git", ["rev-parse", "--verify", "--quiet", ref], { cwd: root });
      return ref;
    } catch {}
  }
  return null;
}

export async function resolveRepo(
  repoOption: string | undefined,
  cwd: string,
): Promise<RepoContext> {
  const target = repoOption ? resolve(cwd, repoOption) : cwd;
  if (!existsSync(target)) {
    fail("repo/not-found", `repo path does not exist: ${target}`);
  }
  let root: string;
  try {
    const { stdout } = await execFileP("git", ["rev-parse", "--show-toplevel"], { cwd: target });
    root = stdout.trim();
  } catch {
    fail("repo/not-a-git-repository", `not a git repository: ${target}`, {
      hint: "Run from inside an Entire-enabled repo, or pass --repo <path>",
    });
  }
  const ref = await resolveEntireRef(root);
  if (!ref) {
    fail("entire/branch-not-found", `branch not found: ${ENTIRE_BRANCH}`, {
      hint: "This repo does not appear to use Entire (no entire/checkpoints/v1 ref, local or remote)",
    });
  }
  return { root, ref };
}

export async function gitShow(repo: RepoContext, path: string): Promise<string> {
  try {
    const { stdout } = await execFileP("git", ["show", `${repo.ref}:${path}`], {
      cwd: repo.root,
      maxBuffer: 256 * 1024 * 1024,
    });
    return stdout;
  } catch (err) {
    const stderr = (err as { stderr?: string }).stderr ?? "";
    if (
      /exists on disk, but not in|does not exist|bad revision|Path/.test(stderr) ||
      /exit code 128/.test(String(err))
    ) {
      throw new GitNotFoundError(path);
    }
    throw err;
  }
}

export class GitNotFoundError extends Error {
  constructor(public path: string) {
    super(`not found in ${ENTIRE_BRANCH}: ${path}`);
  }
}

export async function gitShowJSON<T>(repo: RepoContext, path: string): Promise<T> {
  const text = await gitShow(repo, path);
  try {
    return JSON.parse(text) as T;
  } catch (err) {
    fail("parse-error", `failed to parse JSON: ${path}`, {
      details: { path, error: String(err) },
    });
  }
}

export async function gitLsTreeDirs(repo: RepoContext, path: string): Promise<string[]> {
  try {
    const { stdout } = await execFileP(
      "git",
      ["ls-tree", "--name-only", `${repo.ref}:${path || ""}`],
      {
        cwd: repo.root,
        maxBuffer: 64 * 1024 * 1024,
      },
    );
    return stdout.split("\n").filter((s) => s.length > 0);
  } catch {
    return [];
  }
}

export async function resolveCheckpointFromCommit(
  repo: RepoContext,
  sha: string,
): Promise<string | null> {
  try {
    const { stdout } = await execFileP(
      "git",
      ["show", "-s", "--format=%(trailers:key=Entire-Checkpoint,valueonly)", sha],
      { cwd: repo.root },
    );
    const lines = stdout
      .split("\n")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    return lines[0] ?? null;
  } catch {
    return null;
  }
}
