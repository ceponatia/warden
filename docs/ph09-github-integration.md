# Phase 9 — GitHub Integration

## Overview

Phase 9 adds a GitHub-aware metric collector (M7) that pulls live data from the GitHub API to surface pull-request health, branch hygiene, and CI pipeline reliability alongside the existing local-analysis metrics.

## Goals

- Detect stale pull requests that are blocking merge velocity.
- Surface PR backlogs that indicate a review bottleneck.
- Track CI failure rates to catch systemic pipeline instability.
- Identify abandoned branches that pollute the repository namespace.

## New metric: M7 (GitHub)

| Code | Short description |
|---|---|
| WD-M7-001 | Pull request open beyond stale threshold |
| WD-M7-002 | Open PR backlog exceeds threshold |
| WD-M7-003 | CI failure rate exceeds threshold |
| WD-M7-004 | Stale branch accumulation |

Full details for each code are in the `wiki/` directory.

## Architecture

### Collector: `src/collectors/collect-github.ts`

- Calls the GitHub REST API using a `GITHUB_TOKEN` environment variable.
- Reads `config.githubRepo` (format `owner/repo`) from the repo config entry.
- Returns a `GitHubSnapshot` written to `data/<slug>/snapshots/<ts>/github.json`.
- If `GITHUB_TOKEN` or `githubRepo` is absent the collector returns an empty snapshot so offline runs are unaffected.

### Snapshot type: `GitHubSnapshot`

Defined in `src/types/snapshot.ts`. Fields:

```ts
interface GitHubSnapshot extends CollectorMetadata {
  summary: {
    openPrs: number;
    stalePrs: number;
    staleBranches: number;
    ciRunsAnalyzed: number;
    ciFailureRatePct: number;
  };
  stalePrs: GitHubPrEntry[];
  staleBranches: GitHubBranchEntry[];
  recentCiRuns: GitHubCiRunEntry[];
}
```

`SnapshotBundle.github` is optional so the existing snapshot schema remains backward-compatible.

### Findings evaluation: `src/findings/evaluate.ts`

`appendGitHub()` maps `GitHubSnapshot` fields to M7 finding instances using the thresholds below. It is called from `evaluateFindings()`.

### Report section

Phase 9 adds a **GitHub** section to the template report rendered by `src/reporter/template-report.ts`.

## Configuration

### `config/repos.json`

Add a `githubRepo` field to any repo entry that should be monitored:

```json
{
  "slug": "my-api",
  "path": "/path/to/my-api",
  "type": "node",
  "githubRepo": "my-org/my-api",
  ...
}
```

### Thresholds

Four new thresholds are added to `RepoThresholds` with these defaults:

| Threshold | Default | Meaning |
|---|---|---|
| `stalePrDays` | `14` | Days without update before a PR is considered stale |
| `maxOpenPrs` | `20` | Maximum open PR count before flagging a backlog |
| `ciFailureRatePct` | `30` | CI failure rate (%) that triggers WD-M7-003 |
| `staleBranchDays` | `30` | Days without a commit before a branch is considered stale |

### Environment

```
GITHUB_TOKEN=ghp_...   # personal access token or fine-grained PAT (read:repo, read:actions)
```

Add to `.env` (already in `.env.example` as part of this phase).

## Implementation checklist

- [x] Add `M7` to `FindingMetric` union (`src/types/findings.ts`)
- [x] Add `GitHubSnapshot`, `GitHubPrEntry`, `GitHubBranchEntry`, `GitHubCiRunEntry` types (`src/types/snapshot.ts`)
- [x] Extend `SnapshotBundle` with optional `github` field
- [x] Add `githubRepo` to `RepoConfig`
- [x] Add `stalePrDays`, `maxOpenPrs`, `ciFailureRatePct`, `staleBranchDays` to `RepoThresholds`
- [x] Update `DEFAULT_THRESHOLDS` and `normalizeThresholds` in `src/config/schema.ts`
- [x] Add WD-M7-001 through WD-M7-004 to `src/findings/registry.ts`
- [x] Create `src/collectors/collect-github.ts`
- [x] Add `appendGitHub()` to `src/findings/evaluate.ts`
- [x] Create wiki pages `wiki/WD-M7-001.md` through `wiki/WD-M7-004.md`
- [ ] Integrate `collectGitHub` into `runCollectors` in `src/collectors/index.ts`
- [ ] Write `github.json` in `src/cli/commands/collect.ts`
- [ ] Add GitHub section to `src/reporter/template-report.ts`
- [ ] Add GitHub metrics to `src/dashboard` repo-detail view
- [ ] Add `GITHUB_TOKEN` entry to `.env.example`
- [ ] Add `githubRepo` example to `config/repos.json` schema docs

## Security notes

- `GITHUB_TOKEN` is read from the environment; it is never written to disk or included in snapshots.
- API requests use `curl` with `execFile` (no shell interpolation) following the existing `runCommand` pattern.
- Only `read:repo` and `read:actions` scopes are required; no write operations are performed.
