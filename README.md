# Warden

Repo monitoring CLI that collects git stats, staleness, debt, complexity, import health, and runtime coverage into structured snapshots.

## Setup

```bash
pnpm install
pnpm warden --help
```

## Commands

- `warden init <path>`
- `warden collect [--repo <slug>]`
- `warden report [--repo <slug>]`

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
