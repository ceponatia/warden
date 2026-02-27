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
- `warden report [--repo <slug>] [--analyze] [--compare <branch>]`
- `warden analyze [--repo <slug>]`
- `warden dashboard [--port <n>]`
- `warden prune [--repo <slug>] [--keep <n>]`
- `warden hook install [--repo <slug>]`
- `warden hook uninstall [--repo <slug>]`
- `warden hook tick --repo <slug>`
- `warden wiki <WD-Mx-yyy>`
- `warden mcp [--transport stdio|sse] [--port <n>]`

## AI Analysis

`warden analyze` reads the latest snapshot for each configured repo, optionally computes a delta against the previous snapshot, and calls an AI provider to produce a prioritized maintenance report written to `data/<slug>/analyses/`.

`warden report --analyze` generates the template report and then appends an AI analysis to stdout.

`warden report --compare main` appends a cross-branch delta section by comparing the latest snapshot against the latest snapshot captured on `main`.

Configure the provider via environment variables (see `.env.example`).

## Web dashboard

Start the local dashboard server:

```bash
pnpm warden dashboard
```

By default, it runs at `http://localhost:3333`.

Use a custom port:

```bash
pnpm warden dashboard --port 4000
```

Main routes:

- `/` — multi-repo overview
- `/repo/:slug` — repo detail view
- `/repo/:slug/trends` — trend charts
- `/repo/:slug/work` — work document manager
- `/repo/:slug/agents` — agent activity + trust scores
- `/wiki` and `/wiki/:code` — wiki browser

The dashboard reads data from `data/<slug>/reports`, `data/<slug>/work`, `data/<slug>/trust`, and `wiki/`. Run `warden analyze` (and `warden collect` as needed) to refresh dashboard data.

## Finding codes and wiki

Phase 4 introduces stable finding codes (`WD-Mx-yyy`) and wiki pages in `wiki/`.

- `warden report` includes code references in metric sections plus a finding-code summary.
- `warden wiki <code>` prints the wiki page for a finding code.

## Allowlists and suppressions

- Global allowlist: `config/<slug>.allowlist`
- Repo-local override: `<repo>/.warden/allowlist`

Allowlist entries suppress specific finding codes for paths (or `path:symbol` entries).

`config/repos.json` also supports `suppressions` for repo-managed pattern suppressions.

## MCP server

`warden mcp` starts an MCP server exposing Warden resources and tools.

- Default transport: `stdio`
- Optional HTTP streamable mode: `warden mcp --transport sse --port 3001`

Resources include `warden://repos`, `warden://findings`, repo snapshot/report URIs, and `warden://wiki/{code}`.

## Scheduling

Use cron/systemd/launchd examples in `docs/scheduling.md` to run Warden automatically on a weekly cadence.

## Threshold tuning

Threshold defaults and semantics are documented in `docs/thresholds.md`.

## GitHub integration (Phase 9)

Set `githubRepo: "owner/repo"` in `config/repos.json` and provide `GITHUB_TOKEN` (read-only scopes) to enable M7 GitHub metrics — stale PRs, PR backlog, CI failure rate, and stale branch detection.

See `docs/ph09-github-integration.md` for the full implementation plan.

## Scope config

`warden init` generates `config/<slug>.scope` as a `.gitignore`-style file-scoping config.

- Ignore-only patterns skip all metrics.
- `[metrics: ...]` blocks scope files to selected metrics.
- Target repo `.warden/scope` takes precedence when present.

## Runtime tracking connector

`packages/warden-connector` provides `@aspect/warden-connector` with `withTracking()` middleware that appends route hit events to `.warden/runtime/api-hits.jsonl`.

## V8 coverage

See `docs/v8-coverage-dev-session.md` for the dev workflow used by `collect-runtime`.

See `PH01-warden-phase-1.md` for the implementation sequence.
