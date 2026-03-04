# AGENTS.md - `warden`

## Project overview

Warden is a TypeScript CLI and toolset for repository health monitoring and reporting across growth, staleness, complexity, and architectural drift. It collects metrics from target repositories, produces structured snapshots, generates template-based reports, and layers AI-powered analysis on top. It also exposes an MCP server, a web dashboard, a VS Code extension, GitHub integration, and a notification system.

## Quick start

```bash
pnpm install                # install all dependencies
pnpm warden collect         # collect snapshots for all registered repos
pnpm warden report          # generate reports from latest snapshots
pnpm warden analyze         # run AI analysis on latest snapshots
pnpm warden dashboard       # start the web dashboard
```

Register a repo with `pnpm warden init <path>` (local) or `pnpm warden add github:owner/repo` (remote).

## Build & validate

| Command | Purpose |
|---------|---------|
| `pnpm warden <subcommand>` | Run CLI via tsx |
| `pnpm typecheck` | `tsc --noEmit` across workspace |
| `pnpm lint` | ESLint across workspace |
| `pnpm test` | Vitest run (all tests) |
| `pnpm test:watch` | Vitest in watch mode |
| `pnpm test:coverage` | Vitest with v8 coverage |
| `pnpm ci` | `lint && typecheck && test` |

## Environment variables

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `WARDEN_AI_PROVIDER` | No | `github` | AI provider: `openai`, `anthropic`, or `github` |
| `WARDEN_AI_MODEL` | No | Provider-dependent | Override the default model per provider |
| `OPENAI_API_KEY` | When provider=openai | -- | OpenAI API key |
| `ANTHROPIC_API_KEY` | When provider=anthropic | -- | Anthropic API key |
| `GITHUB_TOKEN` / `WARDEN_GITHUB_TOKEN` | When provider=github or using GitHub integration | -- | GitHub token |
| `WARDEN_SLACK_WEBHOOK_URL` | For Slack notifications | -- | Slack incoming webhook URL |

## Workspace structure

```text
warden/
  src/
    cli/              # command dispatch and subcommands
      commands/       # one file per CLI subcommand
    collectors/       # metric collectors (git stats, staleness, coverage, etc.)
    reporter/         # template-based report rendering
    agents/           # AI analysis pipeline (provider, runner, delta, prompt, agent types)
    config/           # repo config loading, validation, allowlists, scopes
    types/            # snapshot, report, findings, work, trajectory types
    dashboard/        # Express web dashboard with WebSocket live updates
    findings/         # finding evaluation and registry
    github/           # GitHub API client, PR comments, cross-repo intelligence
    mcp/              # Model Context Protocol server (stdio + SSE transports)
    notifications/    # dispatcher, channels (email, Slack), history
    work/             # work document management, escalation, trajectory, autonomy
  config/
    repos.json        # registered target repositories
    autonomy-global.json   # global autonomy policies
    warden.scope      # file patterns excluded from metrics
    warden.allowlist  # suppressed finding codes per path
    notifications.json.example  # notification config template
  data/
    <slug>/
      snapshots/      # collected metric snapshots (JSON)
      reports/        # generated reports
      analyses/       # AI analysis outputs
  packages/
    warden-connector/ # shared connector library (@aspect/warden-connector)
    warden-vscode/    # VS Code extension (diagnostics, tree view, wiki hovers)
  wiki/               # finding code documentation (WD-M*-*.md)
  docs/               # design docs (trajectory, thresholds, scheduling, etc.)
```

## CLI subcommands

| Command | Purpose |
|---------|---------|
| `warden init <path>` | Register a local repo |
| `warden add <path\|github:owner/repo>` | Add a repo (local or GitHub) |
| `warden collect [--repo <slug>]` | Collect metric snapshots |
| `warden report [--repo <slug>] [--analyze] [--compare <branch>] [--portfolio]` | Generate reports |
| `warden analyze [--repo <slug>]` | Run AI analysis pipeline |
| `warden autonomy <grant\|revoke\|list\|impact>` | Manage autonomy policies |
| `warden dashboard [--port <n>]` | Start web dashboard |
| `warden prune [--repo <slug>] [--keep <n>]` | Prune old snapshots |
| `warden hook <install\|uninstall\|tick>` | Git hook management |
| `warden trajectory <init\|validate\|import\|export\|patch>` | Trajectory data operations |
| `warden github auth [--token <token>]` | Configure GitHub auth |
| `warden webhook <start\|stop>` | Start/stop webhook listener |
| `warden notify <test\|digest> [--repo <slug>]` | Send notifications |
| `warden wiki <WD-code>` | Look up a finding code |
| `warden work [--repo <slug>] [<findingId>]` | Manage work documents |
| `warden mcp [--transport stdio\|sse] [--port <n>]` | Start MCP server |

## Non-negotiable boundaries

### TypeScript

- Strict mode with `noUncheckedIndexedAccess: true` -- all bracket-access returns `T | undefined`.
- Target ES2022 with NodeNext module resolution.
- No build step for the main `src/` tree -- runs via `tsx`.

### ESLint limits (warn-level)

- Cyclomatic complexity: max 12.
- File length: max 500 lines (skip blank/comments).
- Function length: max 100 lines (skip blank/comments).
- Flat config format (`eslint.config.mjs`).

### Collector independence

- Each collector in `src/collectors/` is self-contained and returns structured JSON.
- Collectors must not depend on each other or on the reporter/agent layers.

### Agent pipeline isolation

- The agent pipeline in `src/agents/` reads from existing snapshots only.
- Agents must never re-collect data or trigger collection.
- AI provider is configurable via `WARDEN_AI_PROVIDER` (openai | anthropic | github).

### Config files

- `config/repos.json` is the source of truth for registered target repos.
- `config/warden.scope` defines file patterns excluded from metrics collection.
- `config/warden.allowlist` suppresses specific finding codes per file path.
- `config/autonomy-global.json` stores global autonomy grant/revoke policies.

## Conventions

### Code style

- TypeScript strict mode, pnpm for package management.
- Flat ESLint config with typescript-eslint.
- Keep reports mechanical and template-based in `src/reporter/`.
- Types live in `src/types/` as standalone type definition files.

### Packages

- `packages/warden-connector` -- shared connector (exposed as `@aspect/warden-connector`, no build step, raw TS entry).
- `packages/warden-vscode` -- VS Code extension with a build step (`dist/extension.js`). Provides diagnostics, tree view, and wiki hovers.
- Workspace packages declared in `pnpm-workspace.yaml`.

### Data directory

- All output artifacts go under `data/<slug>/` organized by repo slug.
- Snapshots, reports, and analyses are separate subdirectories.
- The `data/` directory is excluded from TypeScript compilation and ESLint.

### Testing

- Vitest with globals enabled, node environment.
- Tests live alongside source in `src/**/*.test.ts` or under `src/__tests__/`.
- Coverage via v8 provider, excluding test files and `src/types/`.

## Scope boundaries

- Implementation should align to dev-docs plans.
- Do not add scheduling/cron automation directly in warden -- use external triggers or git hooks.
- Finding codes are documented in `wiki/` with the pattern `WD-M<module>-<number>.md`.
