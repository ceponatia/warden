# Future-State Architecture: Trajectory Layer in Warden

## Status

- Draft v0.1
- Date: 2026-03-02
- Scope: Conceptual and technical architecture for merging Viz Vibe style trajectory management into Warden.

## Goal

Unify two complementary capabilities:

- Warden's objective repository intelligence (collectors, findings, reports, wiki, work status, MCP).
- Viz Vibe's trajectory memory (what was done, what is next, and why, represented as a graph).

Result: one system where code-health signals and human/AI work trajectory are connected and queryable.

## Non-Goals (Initial)

- Replace all Viz Vibe UX immediately.
- Force users to abandon `vizvibe.mmd` on day one.
- Introduce speculative autonomous agents without policy controls.

## Design Principles

1. One canonical source of truth per concern.
2. Compatibility first, migration second.
3. Event-driven updates over manual sync scripts.
4. Deterministic transforms and strict validation around AI edits.
5. Every state change should be auditable.
6. Strict legal compliance and attribution for any reused MIT-licensed code.

## Current-State Summary

- Warden already has structured domains: `collectors`, `findings`, `reporter`, `work`, `dashboard`, `mcp`.
- Viz Vibe uses a Mermaid (`.mmd`) trajectory file and tooling/hooks around AI sessions.
- These systems overlap in intent (work tracking) but not in storage model or update model.

## Problem-by-Problem Architecture

## Problem 1: Two Sources of Truth

### Issue

- Warden state is structured JSON under `data/<slug>/...`.
- Viz Vibe state is a free-form Mermaid document (`vizvibe.mmd`).
- Divergence risk is high when both are edited independently.

### Future-State Decision

Introduce a canonical Warden trajectory store:

- `data/<slug>/trajectory/graph.json` (authoritative graph state)
- `data/<slug>/trajectory/events.jsonl` (append-only event log)
- `data/<slug>/trajectory/snapshots/*.json` (optional periodic snapshots)

`vizvibe.mmd` becomes a compatibility projection:

- Import path: `mmd -> canonical graph`
- Export path: `canonical graph -> mmd`

### Why

Structured state enables reliable linking, validation, querying, and policy enforcement.

## Problem 2: Unstructured Graph Edits Cause Drift

### Issue

- Mermaid comments and node metadata are easy to break.
- AI-generated edits can introduce invalid references, duplicate IDs, or accidental rewrites.

### Future-State Decision

Create a `trajectory` domain in Warden with strict schema and parser boundaries:

- `src/trajectory/schema.ts` (zod schemas)
- `src/trajectory/importers/mermaid.ts`
- `src/trajectory/exporters/mermaid.ts`
- `src/trajectory/validator.ts`

All edit paths (CLI, MCP, dashboard actions, AI agent output) write through validated commands:

- `applyTrajectoryPatch()`
- `appendTrajectoryEvent()`
- `rebuildProjectionFiles()`

### Why

This preserves compatibility while removing brittle direct text mutation as the primary write path.

## Problem 3: Weak Linkage Between Findings and Work Trajectory

### Issue

- Warden findings (`WD-*`) and work notes/status exist, but trajectory nodes are not first-class linked entities.
- Users cannot easily answer: "Which trajectory items are driven by S1 findings?"

### Future-State Decision

Trajectory node schema includes explicit linkage:

- `findingRefs: string[]` (e.g., `WD-M2-014`)
- `workRefs: string[]` (work item IDs)
- `snapshotRef` (snapshot timestamp/version)
- `status` (`opened|closed|blocked|deferred`)

Bidirectional references:

- Findings may include `trajectoryNodeIds`.
- Work entries may include `trajectoryNodeId`.

### Why

This enables impact tracking and lifecycle synchronization across domains.

## Problem 4: Updates Are Triggered by Separate Tooling Paths

### Issue

- Viz Vibe relies on editor/hook behaviors.
- Warden updates come from CLI runs and reporting workflows.
- No unified ingestion model means delayed or inconsistent trajectory updates.

### Future-State Decision

Add a Warden event ingestion layer:

- `src/trajectory/ingest.ts` with event contracts:
  - `FindingCreated`
  - `FindingResolved`
  - `WorkStatusChanged`
  - `AnalysisCompleted`
  - `UserTrajectoryPatchRequested`
  - `McpTrajectoryMutation`

Core Warden workflows emit trajectory-relevant events; ingest handlers update graph state.

### Why

Event-driven flow keeps trajectory current without forcing users into one editor integration.

## Problem 5: AI Edit Safety and Loop Prevention

### Issue

- Hook-driven AI systems can loop or over-edit context files.
- Free-form instructions are difficult to govern.

### Future-State Decision

Warden trajectory writes from AI must be patch-based and policy-gated:

- AI proposes patch (`add_node`, `close_node`, `add_edge`, `annotate_node`, etc.).
- Policy engine validates:
  - ID uniqueness
  - max edits per request
  - allowed field mutations
  - protected nodes
- System stores `proposal`, `accepted/rejected` decision, and reason.

Add idempotency keys on hook-driven writes to prevent duplicate mutation cycles.

### Why

Preserves AI assistance while making behavior deterministic and auditable.

## Problem 6: Single-Repo Bias

### Issue

- Viz Vibe conventionally operates per project file.
- Warden is built for multi-repo visibility.

### Future-State Decision

Trajectory model supports:

- repo-local graphs (`data/<slug>/trajectory/...`)
- optional aggregate cross-repo graph (`data/_global/trajectory/graph.json`)

Aggregate links use scoped IDs:

- `nodeId = "<slug>::<localNodeId>"`

Dashboard adds:

- `/repo/:slug/trajectory`
- `/trajectory` (cross-repo lens)

### Why

Maintains local clarity while enabling portfolio-level planning and risk analysis.

## Problem 7: API Surface Fragmentation

### Issue

- Existing interfaces are split across CLI commands, dashboard routes, and MCP tools without trajectory primitives.

### Future-State Decision

Add explicit trajectory API surfaces.

CLI (new):

- `warden trajectory init --repo <slug>`
- `warden trajectory import --repo <slug> --from vizvibe.mmd`
- `warden trajectory export --repo <slug> --to vizvibe.mmd`
- `warden trajectory add-node ...`
- `warden trajectory close-node ...`
- `warden trajectory link-finding ...`
- `warden trajectory validate --repo <slug>`

MCP tools (new):

- `trajectory_get_graph`
- `trajectory_mutate_graph`
- `trajectory_link_finding`
- `trajectory_export_mermaid`

Dashboard (new routes):

- `GET /api/repo/:slug/trajectory`
- `POST /api/repo/:slug/trajectory/patch`
- `GET /repo/:slug/trajectory`

### Why

A first-class domain needs explicit read/write/query contracts, not implicit file edits.

## Problem 8: Migration and Backward Compatibility

### Issue

- Existing users may already maintain `vizvibe.mmd`.
- Hard cutovers would create immediate churn.

### Future-State Decision

Phased migration:

1. Read-only import and visualization.
2. Dual-write mode (canonical + regenerated `.mmd` projection).
3. Optional canonical-only mode with export on demand.

Migration utility:

- Detect `vizvibe.mmd`
- Parse into canonical graph
- Emit migration report (unmapped nodes, parse warnings, inferred metadata)

### Why

Preserves user trust and avoids workflow breakage.

## Problem 9: Security and Trust Boundaries

### Issue

- Trajectory notes can include sensitive context.
- AI integrations may over-share information through prompts.

### Future-State Decision

Add redaction and access policy in trajectory serialization:

- redact fields by policy before external transport
- route-level auth for mutation endpoints
- per-provider prompt templates with explicit allowed data sections

Add trust scoring hooks with existing Warden `work/trust` domain.

### Why

Trajectory data is operational context and should be treated as governed metadata.

## Problem 10: Observability and Testability Gaps

### Issue

- Without dedicated metrics, trajectory quality degrades silently.

### Future-State Decision

Add telemetry counters:

- parse success/failure rates
- invalid patch rejection rates
- graph-node churn
- orphaned node/link count
- sync lag between findings and trajectory

Testing strategy:

- parser roundtrip tests (`mmd -> json -> mmd`)
- property tests for ID/link invariants
- contract tests for CLI/MCP mutation APIs
- regression fixtures from real `vizvibe.mmd` files

### Why

This keeps the new domain reliable as it scales.

## Proposed Component Architecture

```text
                 +------------------------+
                 |   Warden Collectors    |
                 +-----------+------------+
                             |
                 +-----------v------------+
                 | Findings / Work Events |
                 +-----------+------------+
                             |
                    (Trajectory Ingestion)
                             |
                 +-----------v------------+
                 | Canonical Graph Store  |
                 | graph.json + events    |
                 +-----+------------+-----+
                       |            |
             +---------v--+      +--v----------------+
             | Validator  |      | Mermaid Projection |
             | + Policy   |      | import/export      |
             +----+-------+      +---------+----------+
                  |                          |
         +--------v----------+      +--------v---------+
         | CLI / MCP Mutator |      | Dashboard Viewer |
         +-------------------+      +------------------+
```

## Canonical Trajectory Schema (Draft)

```json
{
  "version": 1,
  "repoSlug": "my-repo",
  "nodes": [
    {
      "id": "auth-hardening",
      "title": "Harden authentication flow",
      "status": "opened",
      "type": "task",
      "createdAt": "2026-03-02T00:00:00.000Z",
      "updatedAt": "2026-03-02T00:00:00.000Z",
      "findingRefs": ["WD-M2-014"],
      "workRefs": [],
      "tags": ["security", "auth"]
    }
  ],
  "edges": [
    {
      "from": "auth-hardening",
      "to": "ship-release-12",
      "kind": "blocks"
    }
  ],
  "meta": {
    "lastActiveNodeId": "auth-hardening"
  }
}
```

## Implementation Sequence

## Phase A: Foundation

- Add `src/trajectory` module with schema, storage, event log, validator.
- Add `warden trajectory init|validate`.
- Add dashboard read-only trajectory view from canonical JSON.

Exit criteria:

- Canonical graph persists and validates.
- Dashboard can render canonical graph.

## Phase B: Compatibility

- Add Mermaid importer/exporter.
- Add `trajectory import/export` commands.
- Add dual-write projection to `vizvibe.mmd`.

Exit criteria:

- Existing `vizvibe.mmd` migrates without data loss in common cases.
- Roundtrip tests pass.

## Phase C: Integration

- Emit trajectory events from `work`, `analyze`, and findings lifecycle.
- Add MCP tools for trajectory get/mutate/link.
- Add policy-gated AI patch pipeline.

Exit criteria:

- Trajectory updates happen automatically from core Warden workflows.
- AI-originated writes are patch-validated and auditable.

## Phase D: Cross-Repo and Governance

- Add global trajectory view and scoped IDs.
- Add redaction policies and trust-aware prompt serialization.
- Add observability metrics and quality dashboards.

Exit criteria:

- Multi-repo trajectory works.
- Security and quality controls are in place.

## Key Risks and Mitigations

- Risk: Mermaid import ambiguity.
  - Mitigation: Preserve unknown metadata in `meta.raw` and report warnings.
- Risk: AI update noise.
  - Mitigation: Strict patch contract and max mutation thresholds.
- Risk: User confusion during migration.
  - Mitigation: Dual-write period and explicit migration diagnostics.

## Immediate Next Build Tasks

1. Setup CI workflow and baseline Vitest harness (Layer 0).
2. Create `src/trajectory/schema.ts` and `src/trajectory/storage.ts`.
3. Add `warden trajectory init` and `warden trajectory validate`.
4. Add minimal dashboard route `/api/repo/:slug/trajectory`.
5. Add initial Mermaid import command behind `--experimental`.

