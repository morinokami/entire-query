import { fail } from "./errors.ts";

const CHECKPOINT_ID_RE = /^[0-9a-f]{12}$/;

export function isCheckpointId(s: string): boolean {
  return CHECKPOINT_ID_RE.test(s);
}

export function assertCheckpointId(id: string): asserts id is string {
  if (!isCheckpointId(id)) {
    fail("invalid-arguments", `invalid checkpoint id: ${id}`, {
      hint: "Checkpoint ids are 12 lowercase hex characters",
    });
  }
}

export function checkpointDir(id: string): string {
  return `${id.slice(0, 2)}/${id.slice(2)}`;
}

export function stripLeadingSlash(p: string): string {
  return p.replace(/^\/+/, "");
}

export function joinBranchPath(...parts: string[]): string {
  return parts
    .map((p) => stripLeadingSlash(p))
    .filter((p) => p.length > 0)
    .join("/");
}
