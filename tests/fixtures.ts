import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface Fixture {
  root: string;
  appCommit: string;
  cleanup: () => void;
}

const CHECKPOINT_ID = "04aaaaaaaaaa";

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] }).toString();
}

export function buildFixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), "eq-fixture-"));
  git(root, "init", "--initial-branch=main", "-q");
  git(root, "config", "user.email", "test@example.com");
  git(root, "config", "user.name", "Test");
  git(root, "config", "commit.gpgsign", "false");

  // Initial commit on main so we can create commits with trailers later
  writeFileSync(join(root, "README.md"), "test\n");
  git(root, "add", "README.md");
  git(root, "commit", "-m", "init", "-q");

  // Build the checkpoints branch as an orphan
  git(root, "switch", "--orphan", "entire/checkpoints/v1", "-q");

  const cpDir = join(root, "04", "aaaaaaaaaa");
  mkdirSync(join(cpDir, "0"), { recursive: true });
  mkdirSync(join(cpDir, "1"), { recursive: true });

  writeFileSync(
    join(cpDir, "metadata.json"),
    JSON.stringify({
      cli_version: "test",
      checkpoint_id: CHECKPOINT_ID,
      strategy: "manual-commit",
      branch: "feature/x",
      checkpoints_count: 1,
      files_touched: ["src/foo.ts", "src/bar.ts"],
      sessions: [
        {
          metadata: "/04/aaaaaaaaaa/0/metadata.json",
          transcript: "/04/aaaaaaaaaa/0/full.jsonl",
          context: "/04/aaaaaaaaaa/0/context.md",
          content_hash: "/04/aaaaaaaaaa/0/content_hash.txt",
          prompt: "/04/aaaaaaaaaa/0/prompt.txt",
        },
        {
          metadata: "/04/aaaaaaaaaa/1/metadata.json",
          transcript: "/04/aaaaaaaaaa/1/full.jsonl",
        },
      ],
      token_usage: {
        input_tokens: 100,
        cache_creation_tokens: 200,
        cache_read_tokens: 300,
        output_tokens: 400,
        api_call_count: 5,
      },
    }),
  );

  // Session 0: full session with prompt + transcript covering noise/user/assistant/tool_use rows
  writeFileSync(
    join(cpDir, "0", "metadata.json"),
    JSON.stringify({
      cli_version: "test",
      checkpoint_id: CHECKPOINT_ID,
      session_id: "11111111-1111-1111-1111-111111111111",
      strategy: "manual-commit",
      created_at: "2026-01-01T00:00:00Z",
      branch: "feature/x",
      checkpoints_count: 1,
      files_touched: ["src/foo.ts"],
      agent: "Claude Code",
      turn_id: "turn0",
      token_usage: {
        input_tokens: 10,
        cache_creation_tokens: 20,
        cache_read_tokens: 30,
        output_tokens: 40,
        api_call_count: 4,
        subagent_tokens: {
          input_tokens: 5,
          cache_creation_tokens: 1000,
          cache_read_tokens: 2000,
          output_tokens: 80,
          api_call_count: 1,
        },
      },
      session_metrics: {
        turn_count: 7,
        duration_ms: 142340,
        context_tokens: 87521,
        context_window_size: 200000,
      },
      initial_attribution: {
        calculated_at: "2026-01-01T00:00:00Z",
        agent_lines: 50,
        human_added: 10,
        human_modified: 5,
        human_removed: 2,
        total_committed: 60,
        agent_percentage: 80,
      },
    }),
  );
  writeFileSync(
    join(cpDir, "0", "prompt.txt"),
    "Please review src/foo.ts thoroughly.\n\n---\n\nAlso add a unit test for it.",
  );
  writeFileSync(join(cpDir, "0", "context.md"), "ctx\n");
  writeFileSync(join(cpDir, "0", "content_hash.txt"), "hash0\n");
  const transcript0 = [
    { type: "file-history-snapshot", messageId: "x" },
    {
      role: "user",
      message: {
        content: [{ type: "text", text: "<user_query>\nHello there\n</user_query>" }],
      },
    },
    {
      role: "assistant",
      message: { content: [{ type: "text", text: "Sure, reading the file." }] },
    },
    {
      role: "assistant",
      message: {
        content: [{ type: "tool_use", name: "Read", input: { file_path: "src/foo.ts" } }],
      },
    },
    "{not valid json",
  ];
  writeFileSync(
    join(cpDir, "0", "full.jsonl"),
    transcript0.map((e) => (typeof e === "string" ? e : JSON.stringify(e))).join("\n") + "\n",
  );

  // Session 1: minimal, no prompt.txt → prompt_preview should be null
  writeFileSync(
    join(cpDir, "1", "metadata.json"),
    JSON.stringify({
      checkpoint_id: CHECKPOINT_ID,
      session_id: "22222222-2222-2222-2222-222222222222",
      created_at: "2026-01-02T00:00:00Z",
      files_touched: ["src/bar.ts"],
      agent: "Cursor",
      token_usage: {
        input_tokens: 1,
        cache_creation_tokens: 0,
        cache_read_tokens: 0,
        output_tokens: 1,
        api_call_count: 2,
      },
    }),
  );
  writeFileSync(
    join(cpDir, "1", "full.jsonl"),
    JSON.stringify({ type: "[Tool] Read", text: "[Tool] Read: src/bar.ts" }) + "\n",
  );

  git(root, "add", ".");
  git(root, "commit", "-m", `Checkpoint: ${CHECKPOINT_ID}`, "-q");

  // Switch back to main and add a commit with the Entire-Checkpoint trailer
  git(root, "switch", "main", "-q");
  writeFileSync(join(root, "src.txt"), "implementation\n");
  git(root, "add", "src.txt");
  git(root, "commit", "-m", `feat: do the thing\n\nEntire-Checkpoint: ${CHECKPOINT_ID}\n`, "-q");
  const appCommit = git(root, "rev-parse", "HEAD").trim();

  return {
    root,
    appCommit,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

export const FIXTURE_CHECKPOINT_ID = CHECKPOINT_ID;
