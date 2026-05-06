# Testing Commands

## Import

```ts
import { createRunCommand, runCommand } from "@rune-cli/rune/test";
```

`runCommand()` works with any test runner (Vitest, Jest, Node.js built-in test runner).

Tests can live in a separate `tests/` directory or next to the command under `src/commands`. Rune ignores colocated `.test.ts` and `.spec.ts` files during command routing.

## runCommand()

Exercises a command through Rune's real parse-and-execute pipeline in-process — no child process is spawned.

```ts
async function runCommand(
  command: DefinedCommand,
  argv?: string[],
  context?: RunCommandContext,
): Promise<CommandExecutionResult<TCommandDocument, TCommandRecord>>;
```

The output shape is inferred from the passed command: text commands return `output.kind === "text"`, `json: true` commands expose the `run()` return type through `output.document`, and `jsonl: true` commands expose yielded records through `output.records`.

The `argv` parameter accepts the same CLI tokens a user would type. Option parsing, type coercion, schema validation, env fallback resolution, required/default handling, duplicate detection, and `multiple: true` repeated-option collection all run exactly as in a real invocation.

Top-level CLI behavior (command routing, help rendering) is **not** included. `runCommand()` tests only the resolved command itself.

## CommandExecutionResult

| Property   | Type                          | Description                                                                       |
| ---------- | ----------------------------- | --------------------------------------------------------------------------------- |
| `exitCode` | `number`                      | `0` for success, non-zero for failure                                             |
| `stdout`   | `string`                      | Captured `output.log()` output                                                    |
| `stderr`   | `string`                      | Captured `output.error()` output and error messages                               |
| `error`    | `CommandFailure \| undefined` | Structured error (`kind`, `message`, `hint?`, `details?`, `exitCode`)             |
| `output`   | discriminated union           | `{ kind: "text" }`, `{ kind: "json"; document }`, or `{ kind: "jsonl"; records }` |

## Testing patterns

### Basic

```ts
import { runCommand } from "@rune-cli/rune/test";
import { expect, test } from "vitest";
import greeting from "../src/commands/index";

test("greets by name", async () => {
  const result = await runCommand(greeting, ["world"]);

  expect(result.exitCode).toBe(0);
  expect(result.stdout).toBe("Hello, world!\n");
});

test("greets loudly with --loud flag", async () => {
  const result = await runCommand(greeting, ["world", "--loud"]);

  expect(result.stdout).toBe("HELLO, WORLD!\n");
});
```

### Errors

```ts
import { defineCommand, CommandError } from "@rune-cli/rune";
import { runCommand } from "@rune-cli/rune/test";

const command = defineCommand({
  run() {
    throw new CommandError({
      kind: "config/not-found",
      message: "Config file was not found",
      hint: "Create rune.config.ts",
      exitCode: 7,
    });
  },
});

test("returns structured error", async () => {
  const result = await runCommand(command);

  expect(result.exitCode).toBe(7);
  expect(result.error).toEqual({
    kind: "config/not-found",
    message: "Config file was not found",
    hint: "Create rune.config.ts",
    exitCode: 7,
  });
});
```

Unexpected (non-CommandError) exceptions are wrapped with `kind: "rune/unexpected"`.

### JSON mode

```ts
const command = defineCommand({
  json: true,
  run({ output }) {
    output.log("suppressed with --json");
    return { items: [1, 2, 3] };
  },
});

test("returns structured document with --json", async () => {
  const result = await runCommand(command, ["--json"]);

  // result.output.document is typed as { items: number[] } | undefined
  expect(result.stdout).toBe("");
  expect(result.output.document).toEqual({ items: [1, 2, 3] });
});

test("document is populated even without --json", async () => {
  const result = await runCommand(command);

  expect(result.stdout).toBe("suppressed with --json\n");
  expect(result.output.document).toEqual({ items: [1, 2, 3] });
});
```

`result.output.document` is populated regardless of `--json`. The flag controls only whether `output.log()` is suppressed and whether `options.json` is `true` inside `run()`.

At real CLI invocation, Rune auto-enables JSON mode under AI agents even without `--json`; this also makes `options.json` true inside `run()`. `runCommand()` disables this auto-detection by default (`simulateAgent: false`) so test outcomes do not depend on the host environment. The `RUNE_DISABLE_AUTO_JSON` environment variable that opts out of auto-activation in real CLI runs has no effect here either — `simulateAgent` is the only signal `runCommand()` uses. Pass `{ simulateAgent: true }` as the third argument when you specifically want to exercise the agent auto-enable path:

```ts
const result = await runCommand(command, [], { simulateAgent: true });

expect(result.stdout).toBe("");
expect(result.output.document).toEqual({ items: [1, 2, 3] });
```

### JSON Lines mode

For `jsonl: true` commands, `runCommand()` captures the raw JSON Lines stdout and the yielded records:

```ts
const command = defineCommand({
  jsonl: true,
  async *run() {
    yield { id: "a" };
    yield { id: "b" };
  },
});

const result = await runCommand(command);

expect(result.stdout).toBe('{"id":"a"}\n{"id":"b"}\n');
expect(result.output.records).toEqual([{ id: "a" }, { id: "b" }]);
```

### Validation errors

```ts
const command = defineCommand({
  args: [{ name: "id", type: "string", required: true }],
  async run(ctx) {
    ctx.output.log(ctx.args.id);
  },
});

test("rejects missing required argument", async () => {
  const result = await runCommand(command, []);

  expect(result.exitCode).toBe(1);
  expect(result.error?.kind).toBe("rune/invalid-arguments");
});
```

### Context injection

Override `ctx.cwd` without changing `process.cwd()`:

```ts
const command = defineCommand({
  run({ cwd, output }) {
    output.log(cwd);
  },
});

test("uses injected cwd", async () => {
  const result = await runCommand(command, [], { cwd: "/tmp/test-project" });

  expect(result.stdout).toBe("/tmp/test-project\n");
});
```

Inject env values for options that declare `env`. The provided env map replaces `process.env` for that command test; it is not merged automatically and defaults to an empty map so tests stay isolated from the host environment.

```ts
const command = defineCommand({
  options: [{ name: "port", type: "number", env: "PORT", default: 3000 }],
  run({ options, output }) {
    output.log(String(options.port));
  },
});

test("uses injected env", async () => {
  const result = await runCommand(command, [], { env: { PORT: "4000" } });

  expect(result.stdout).toBe("4000\n");
});
```

If you intentionally want to inherit the current process environment, merge it explicitly:

```ts
const result = await runCommand(command, [], {
  env: { ...process.env, PORT: "4000" },
});
```

Inject stdin with the `stdin` context field. This feeds `ctx.stdin` without
touching `process.stdin`; omitted stdin is an isolated empty TTY-like input.

```ts
const result = await runCommand(command, [], { stdin: "hello\n" });
```

### Global options

When a project defines global options, hooks, or locals with `defineConfig()`, create a project-aware helper with `createRunCommand(config)` and use it like `runCommand()`:

```ts
import { createRunCommand } from "@rune-cli/rune/test";

import config from "../rune.config";
import deploy from "../src/commands/deploy";

const runCommand = createRunCommand(config);

test("uses the configured profile", async () => {
  const result = await runCommand(deploy, ["--profile", "dev"]);

  expect(result.exitCode).toBe(0);
});
```

This injects `config.options`, `config.hooks`, and `config.locals` into each command test so parsing, validation, project hooks, and project locals match the real CLI. `RunCommandContext.globalOptions`, `RunCommandContext.globalHooks`, `RunCommandContext.createLocals`, and `RunCommandContext.locals` exist as low-level escape hatches and override the config-provided values for a specific test, but normal project tests should prefer `createRunCommand(config)`.

For tests that only need a fixed locals object, pass `locals`:

```ts
const result = await runCommand(command, [], {
  locals: { workspace: fakeWorkspace, api: fakeApi },
});
```

Use `createLocals` when the test needs to assert or depend on the locals factory context. Do not pass both `locals` and `createLocals`.

When testing a hook that depends on route metadata, pass `commandMetadata` explicitly. `runCommand()` does not perform manifest routing and otherwise uses empty metadata:

```ts
const result = await runCommand(command, [], {
  commandMetadata: { cliName: "my-cli", path: ["deploy"], name: "deploy" },
});
```
