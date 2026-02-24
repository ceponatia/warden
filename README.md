# Warden

Repo monitoring CLI that collects git stats, staleness, debt, complexity, import health, and runtime coverage into structured snapshots. Phase 2 adds AI-powered analysis via `warden analyze`.

## Setup

```bash
pnpm install
cp .env.example .env   # add your AI provider key
pnpm warden --help
```

## Commands

- `warden init <path>`
- `warden collect [--repo <slug>]`
- `warden report [--repo <slug>] [--analyze]`
- `warden analyze [--repo <slug>]`

## AI Analysis

`warden analyze` reads the latest snapshot for each configured repo, optionally computes a delta against the previous snapshot, and calls an AI provider to produce a prioritized maintenance report written to `data/<slug>/analyses/`.

`warden report --analyze` generates the template report and then appends an AI analysis to stdout.

Configure the provider via environment variables (see `.env.example`).

## Scope config

`warden init` generates `config/<slug>.scope` as a `.gitignore`-style file-scoping config.

- Ignore-only patterns skip all metrics.
- `[metrics: ...]` blocks scope files to selected metrics.
- Target repo `.warden/scope` takes precedence when present.

## Runtime tracking connector

`packages/warden-connector` provides `@aspect/warden-connector` with `withTracking()` middleware that appends route hit events to `.warden/runtime/api-hits.jsonl`.

## V8 coverage

See `docs/v8-coverage-dev-session.md` for the dev workflow used by `collect-runtime`.

See `IM06-warden-phase-1.md` for the implementation sequence.
