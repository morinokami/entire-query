# Command Definition Reference

## Import

```ts
import { defineCommand, defineGroup, CommandError } from "@rune-cli/rune";
```

## defineCommand()

Creates a CLI command. The returned object must be the file's default export.

```ts
export default defineCommand({
  description: "Greet someone",
  options: [{ name: "loud", type: "boolean", short: "l" }],
  args: [{ name: "name", type: "string", required: true }],
  run({ options, args, output }) {
    const greeting = `Hello, ${args.name}!`;
    output.log(options.loud ? greeting.toUpperCase() : greeting);
  },
});
```

### Properties

| Property      | Type                                | Required | Description                                                                   |
| ------------- | ----------------------------------- | -------- | ----------------------------------------------------------------------------- |
| `description` | `string`                            | No       | One-line summary for `--help`                                                 |
| `args`        | `CommandArgField[]`                 | No       | Positional arguments, in CLI order                                            |
| `options`     | `CommandOptionField[]`              | No       | Named option flags                                                            |
| `aliases`     | `readonly string[]`                 | No       | Alternative command names (kebab-case). Root command cannot have aliases      |
| `examples`    | `readonly string[]`                 | No       | Usage examples for `--help`                                                   |
| `json`        | `true`                              | No       | Enables the built-in `--json` flag (omit to disable; `false` is not accepted) |
| `help`        | `(data: CommandHelpData) => string` | No       | Custom renderer for this command's help output                                |
| `run`         | `(ctx) => void \| Promise<void>`    | Yes      | Command logic. In `json: true` mode it may return structured data             |

### Custom help rendering

Use `help(data)` on a command when only that command needs custom `--help` output:

```ts
import { defineCommand, renderDefaultHelp } from "@rune-cli/rune";

export default defineCommand({
  help(data) {
    return `Custom header\n\n${renderDefaultHelp(data)}`;
  },
  async run() {},
});
```

For project-wide help customization, create `rune.config.ts` at the project root:

```ts
import { defineConfig, renderDefaultHelp } from "@rune-cli/rune";

export default defineConfig({
  name: "my-cli",
  version: "1.0.0",
  help(data) {
    return `${data.cliName}\n\n${renderDefaultHelp(data)}`;
  },
});
```

`defineConfig({ name, version })` controls the CLI display metadata used by help output, `--version`, and JSON help. If omitted, Rune derives these values from `package.json`. `defineConfig({ version })` does not update `package.json`; keep them synchronized in the release workflow when both are used.

`defineConfig({ options })` defines global options that are available to every executable command:

```ts
export default defineConfig({
  options: [{ name: "profile", type: "string", env: "APP_PROFILE", default: "prod" }],
});
```

Use global options after the resolved command path, e.g. `my-cli deploy --profile dev`. They appear in executable command help, but not in the help for groups that only route to subcommands. Global options must be optional: do not use `required: true` or schemas that reject `undefined`.

After changing global options in `rune.config.ts`, run `rune sync` to refresh `.rune/global-options.d.ts` for editor type inference. `rune run` refreshes it before execution, and `rune build` refreshes it and validates global options against command options.

Priority order:

1. `defineCommand({ help })`
2. `defineConfig({ help })`
3. `renderDefaultHelp()`

### JSON help

Use `--help --json` to inspect the same help data as structured JSON:

```sh
my-cli deploy --help --json
```

This works for commands, groups, and unknown-command suggestions. It does not require the command to set `json: true`; runtime JSON output and JSON help are separate features. Custom help renderers are text-only and are not applied to `--help --json`.

### CommandContext (`ctx`)

| Property  | Type                | Description                                            |
| --------- | ------------------- | ------------------------------------------------------ |
| `args`    | `object`            | Parsed positional argument values                      |
| `options` | `object`            | Parsed option values                                   |
| `cwd`     | `string`            | Working directory                                      |
| `rawArgs` | `readonly string[]` | Original unparsed argv tokens                          |
| `output`  | `CommandOutput`     | `output.log()` for stdout, `output.error()` for stderr |

Always use `output.log()` instead of `console.log()`. This allows:

- Capture in tests via `runCommand()`
- Automatic suppression in `--json` mode so stdout stays machine-readable

## Field types

A field uses exactly one of: a primitive `type` (`"string" | "number" | "boolean"`), `type: "enum"` with `values`, or `schema` (Standard Schema). Never mix these.

### Primitive fields

```ts
// Args
{ name: "target", type: "string", required: true, description: "Deploy target" }
{ name: "count", type: "number", default: 1 }

// Options (same base properties, plus `short`)
{ name: "output", type: "string", short: "o" }
{ name: "tag", type: "string", multiple: true, default: [] }
{ name: "port", type: "number", env: "PORT", default: 3000 }
{ name: "force", type: "boolean", short: "f" }
```

Primitive types: `"string"` | `"number"` | `"boolean"`

- `required: true` makes the field mandatory (omit to keep it optional; `false` is not accepted)
- `default` provides a fallback value and makes the field always present in `ctx`
- Primitive defaults are shown in `--help`, except for boolean options
- Primitive boolean options default to `false` even without an explicit `default`
- `short` (options only): single ASCII letter for shorthand (e.g. `-f`). The short name `"h"` is reserved for `--help`
- `env` (scalar options only): environment variable fallback used when the CLI flag is omitted. Priority is `CLI > env > default`; invalid env values fail instead of falling back to defaults. `env` does not affect type inference.
- `multiple: true` (options only): allowed for primitive `"string"` and `"number"` options; parsed values are arrays in declaration order. Use an array `default` such as `[]` to make the option always present. Primitive `"boolean"` options cannot be repeatable.

### Enum fields

Restrict a field to a fixed set of string or number choices without introducing a schema library:

```ts
// Args
{ name: "target", type: "enum", values: ["web", "node"], required: true }

// Options
{ name: "mode", type: "enum", values: ["dev", "prod"], default: "dev", short: "m" }
{ name: "level", type: "enum", values: ["low", 1, "high"] }
{ name: "format", type: "enum", values: ["json", "text"], multiple: true, default: [] }
```

- `values` is a `readonly (string | number)[]`. The union of allowed values is inferred automatically — no `as const` needed
- Matching is strict string comparison: `values: [1, 2]` accepts `"1"` and `"2"`, never `"007"` or `"1.0"`
- `default` must be one of `values`
- `multiple: true` (options only): repeated enum values are exposed as an array; defaults must be arrays whose values are all listed in `values`
- String values must match `/^[A-Za-z0-9_.-]+$/` (letters, digits, `_`, `.`, `-`); spaces or other special characters are rejected at definition time
- Empty strings, `NaN`, `Infinity`, and duplicates (after string conversion) are rejected at definition time
- `--help` displays the allowed values inline, e.g. `--mode <dev|prod>`
- Scalar enum options can use `env`; repeatable enum options cannot.
- For choices that also need format validation or transformation, use a schema field (`z.enum([...]).transform(...)`, etc.)

### Schema fields

Use any [Standard Schema](https://standardschema.dev) object (Zod, Valibot, etc.) for validation and transformation:

```ts
import { z } from "zod";

export default defineCommand({
  options: [
    { name: "port", schema: z.coerce.number().int().positive() },
    { name: "tag", schema: z.array(z.string()).default([]), multiple: true },
    { name: "force", schema: z.boolean(), flag: true },
  ],
  args: [
    { name: "id", schema: z.uuid() },
    { name: "mode", schema: z.string().optional() },
  ],
  async run(ctx) {
    // ctx.options.port — validated positive integer
    // ctx.options.force — boolean flag
    // ctx.args.id — validated UUID string
  },
});
```

- `flag: true` (schema options only): parsed as a boolean flag with no value. The schema receives `true` when the flag is present, `undefined` when absent.
- `multiple: true` (schema options only, not with `flag: true`): the schema receives the collected raw string values as an array, so use an array-shaped schema such as `z.array(z.string()).default([])`.
- Scalar schema options can use `env`. Schema `flag: true` options accept only `"true"` / `"false"` from env and pass the resulting boolean to the schema. Repeatable schema options cannot use `env`.
- Required/optional/default semantics come from the schema itself.
- Validation uses the Standard Schema contract (`schema["~standard"].validate(value)`). Do not call library-specific APIs such as Zod `.parse()`.
- `typeLabel` / `defaultLabel` (schema fields only, display-only): shown in `--help` as `<typeLabel>` and `(default: defaultLabel)`. No effect on validation or type inference. Use when the schema's shape or default is not otherwise discoverable from the help output.

### Argument ordering

Required arguments must come before optional ones. Enforced at both the type level and runtime:

```ts
// Type error — required after optional
defineCommand({
  args: [
    { name: "source", type: "string" },
    { name: "target", type: "string", required: true },
  ],
  run() {},
});
```

## Kebab-case field names

Hyphenated names create camelCase aliases. Both forms are accessible with full type support:

```ts
defineCommand({
  options: [{ name: "dry-run", type: "boolean" }],
  run({ options }) {
    options["dry-run"]; // works
    options.dryRun; // works — same value
  },
});
```

Both `--dry-run` and `--dryRun` work on the command line.

## Negatable boolean options

When a primitive boolean option has `default: true`, Rune auto-generates `--no-<name>`:

```ts
defineCommand({
  options: [{ name: "color", type: "boolean", default: true }],
  run({ options }) {
    // my-cli             -> options.color = true
    // my-cli --color     -> options.color = true
    // my-cli --no-color  -> options.color = false
  },
});
```

- Only primitive boolean options with `default: true` get a negation flag
- Using `--color` and `--no-color` together is an error
- Defining a separate `no-color` option alongside a negatable `color` is rejected at definition time
- Schema-backed fields are not affected (defaults cannot be inspected at definition time)

## JSON mode

Set `json: true` to enable machine-readable output:

```ts
export default defineCommand({
  json: true,
  run({ output }) {
    output.log("visible without --json, suppressed with --json");
    return { items: [1, 2, 3] };
  },
});
```

- **With `--json`**: `output.log()` suppressed, return value printed as a single-line JSON document to stdout (no indentation)
- **Without `--json`**: `output.log()` works normally, return value is not printed
- **Under AI agents**: Rune auto-enables JSON mode when it detects an AI agent environment (via std-env's `isAgent`), even without `--json`. CI and shell pipes are unaffected — only known agent environment variables trigger this.
- **Opting out**: Set `RUNE_DISABLE_AUTO_JSON=1` (or `true`) to suppress auto-activation under agents. `--json` still enables JSON mode explicitly. Mainly intended for agents developing a Rune CLI that need to inspect human-facing output. Has no effect inside `runCommand()` tests.
- `output.error()` always writes to stderr regardless of mode
- `--json` is only recognized before the `--` terminator
- Return value must be serializable by `JSON.stringify()`
- If `run()` returns `undefined`, the JSON output is `null`

Error output in JSON mode:

```json
{
  "error": {
    "kind": "config/not-found",
    "message": "Config file was not found",
    "hint": "Create rune.config.ts"
  }
}
```

## File-based routing

```
src/commands/
├── index.ts       -> root command (my-cli)
├── hello.ts       -> my-cli hello
├── project/
│   ├── index.ts        -> my-cli project (executable, can have subcommands)
│   ├── _schema.ts      -> ignored private helper
│   ├── create.ts       -> my-cli project create
│   ├── create.test.ts  -> ignored colocated test
│   └── list.ts         -> my-cli project list
└── user/
    ├── _group.ts  -> my-cli user (help-only group)
    └── delete.ts  -> my-cli user delete
```

Rules:

- `index.ts` in a directory makes the directory path an executable command
- `_group.ts` in a directory makes it a help-only group (not executable). It is a reserved metadata file, not a private helper.
- `index.ts` and `_group.ts` cannot coexist in the same directory
- Routable `.ts` files become subcommands named after the file
- Files and directories whose command name starts with `_` are ignored by routing, except for reserved metadata names such as `_group.ts`
- `.test.ts` and `.spec.ts` files are ignored by routing, so command tests can be colocated next to command files
- A file and a directory with the same name cannot coexist at the same level
- Only the matched leaf command module is loaded at runtime

### Choosing between `index.ts` and `_group.ts`

| If you want...                                               | Use                                                      |
| ------------------------------------------------------------ | -------------------------------------------------------- |
| `my-cli` to do something when run with no arguments          | `src/commands/index.ts`                                  |
| `my-cli project` to execute logic and still have subcommands | `src/commands/project/index.ts`                          |
| `my-cli project` to exist only as a help/grouping node       | `src/commands/project/_group.ts`                         |
| A simple leaf command with no children                       | `src/commands/hello.ts` or `src/commands/hello/index.ts` |

## defineGroup()

Adds metadata to a non-executable command group. Place in `_group.ts`:

```ts
// src/commands/project/_group.ts
import { defineGroup } from "@rune-cli/rune";

export default defineGroup({
  description: "Manage projects",
  aliases: ["proj"],
  examples: ["my-cli project create my-app"],
});
```

| Property      | Type                | Required | Description                                                    |
| ------------- | ------------------- | -------- | -------------------------------------------------------------- |
| `description` | `string`            | Yes      | Summary shown in `--help`                                      |
| `aliases`     | `readonly string[]` | No       | Alternative names (kebab-case). Root group cannot have aliases |
| `examples`    | `readonly string[]` | No       | Usage examples for `--help`                                    |

## CommandError

Throw for structured error reporting:

```ts
import { defineCommand, CommandError } from "@rune-cli/rune";

export default defineCommand({
  args: [{ name: "id", type: "string", required: true }],
  run({ args }) {
    throw new CommandError({
      kind: "not-found",
      message: `Project "${args.id}" not found`,
      hint: "Run 'my-cli project list' to see available projects",
      details: { id: args.id },
      exitCode: 2,
    });
  },
});
```

| Property   | Type        | Required | Description                                                                   |
| ---------- | ----------- | -------- | ----------------------------------------------------------------------------- |
| `kind`     | `string`    | Yes      | Error category for programmatic handling (e.g. `"not-found"`, `"validation"`) |
| `message`  | `string`    | Yes      | Human-readable error message                                                  |
| `hint`     | `string`    | No       | Suggestion for resolution                                                     |
| `details`  | `JsonValue` | No       | Structured data included in JSON output                                       |
| `exitCode` | `number`    | No       | Process exit code (default: `1`)                                              |
| `cause`    | `unknown`   | No       | Underlying error                                                              |

Unhandled non-CommandError exceptions are wrapped with `kind: "rune/unexpected"`.

## Gotchas

- **`output.log()` not `console.log()`**: `console.log()` bypasses the framework — it cannot be captured in tests and corrupts JSON output in `--json` mode.
- **Option value syntax**: both `--name value` and `--name=value` work. `--` terminates option parsing.
- **Duplicate options are errors unless `multiple: true` is set**: `--name foo --name bar` or mixing long and short forms for the same non-repeatable option fail. Repeatable options collect all values in order.
- **Boolean options without `default: true` have no `--no-*` form**: `--no-force` is an error unless `force` has `default: true`.
- **Schema validation contract**: use `schema["~standard"].validate(value)`, not library-specific `.parse()` or `.safeParse()`.
- **Hyphenated arg names**: must follow the same rules as option names — start with a letter, single internal hyphens only.
- **Field name collisions**: a kebab-case name and its camelCase equivalent cannot coexist (e.g. `dry-run` and `dryRun` in the same command).
- **Reserved names**: the option name `"help"` and short name `"h"` are reserved by the framework. When `json: true`, the option name `"json"` is also reserved.
