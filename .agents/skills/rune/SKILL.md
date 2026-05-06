---
description: Build CLI applications with Rune, a TypeScript-first, agent-friendly CLI framework that uses file-based command routing. Use this skill when the user is creating, modifying, or testing CLI commands with Rune, or scaffolding a new Rune project with create-rune-app.
metadata:
  github-path: skills/rune
  github-ref: refs/tags/@rune-cli/rune@0.3.1
  github-repo: https://github.com/morinokami/rune
  github-tree-sha: 24e09bef343cb14a5ed346845ee2ca49dddf2a26
name: rune
---

# Rune

Use this skill whenever you are working with Rune, an agent-friendly CLI framework for TypeScript where the directory structure under `src/commands/` maps directly to the CLI's command tree.

## Scaffolding a project

When creating a new Rune project with create-rune-app, or running and building an existing project, load [./rules/scaffolding.md](./rules/scaffolding.md).

## Defining commands

When defining or modifying CLI commands — including file-based routing, args, options, groups, JSON mode, and error handling — load [./rules/commands.md](./rules/commands.md).

## Testing commands

When writing or debugging tests for Rune commands, load [./rules/testing.md](./rules/testing.md).
