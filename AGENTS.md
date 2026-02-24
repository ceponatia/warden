# AGENTS.md - `warden`

## Purpose

Warden is a TypeScript CLI for repository monitoring. Phase 1 scaffolds collectors and reporting for git stats, staleness, and maintenance debt snapshots. Phase 2 adds an AI analysis layer that interprets snapshots and produces prioritized maintenance recommendations.

## Scope boundaries

- Keep implementation aligned to `~/projects/cb-dev-docs/PL07-warden.md`.
- Phase 1 is data collection and template reporting only.
- Phase 2 adds AI-powered analysis via `src/agents` (provider, runner, delta, prompt).
- Do not add scheduling/automation in this phase.

## Conventions

- TypeScript strict mode with `noUncheckedIndexedAccess`.
- Use pnpm for package management.
- Use flat ESLint config.
- Keep collectors independent and return structured JSON snapshots.
- Keep reports mechanical and template-based (no interpretation layer yet).
- Agent pipeline reads from existing snapshots; it does not re-collect data.
- AI provider is configurable via `WARDEN_AI_PROVIDER` (openai | anthropic).

## Repo layout

- `src/cli` for command dispatch and subcommands.
- `src/collectors` for metric collectors.
- `src/reporter` for report rendering.
- `src/agents` for AI analysis pipeline (provider, runner, delta, prompt).
- `src/config` for repo config loading and validation.
- `src/types` for snapshot and config types.
- `config/repos.json` for registered target repos.
- `data/<slug>/snapshots` and `data/<slug>/reports` for output artifacts.
- `data/<slug>/analyses` for AI analysis outputs.
