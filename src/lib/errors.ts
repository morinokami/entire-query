import { CommandError } from "@rune-cli/rune";

export type ErrorKind =
  | "repo/not-found"
  | "repo/not-a-git-repository"
  | "entire/branch-not-found"
  | "checkpoint/not-found"
  | "session/not-found"
  | "transcript/not-found"
  | "invalid-arguments"
  | "parse-error";

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };

export function fail(
  kind: ErrorKind,
  message: string,
  opts: { hint?: string; details?: JsonValue; exitCode?: number } = {},
): never {
  throw new CommandError({
    kind,
    message,
    hint: opts.hint,
    details: opts.details,
    exitCode: opts.exitCode ?? 2,
  });
}
