// Cursor uses the same Anthropic Messages API JSONL format as Claude Code.
// Reuse the Claude Code parser verbatim.
export { parseClaudeCodeBody as parseCursorBody } from "./claudecode.ts";
