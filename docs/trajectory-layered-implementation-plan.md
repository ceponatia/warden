# Trajectory Integration: Layered Implementation Plan

## Status

- Draft v0.1 (multi-agent synthesis)
- Date: 2026-03-02
- Current docs: `docs/future-state-architecture.md` (implementation details)

## Objective

Implement Viz Vibe style trajectory capability inside Warden using layered delivery, where each layer has clear dependencies, risks, and acceptance criteria.

## Lift-and-Shift Guardrails

### Legal/License Handling

- Do not copy Viz Vibe repo-level artifacts into Warden/Haven (`LICENSE`, marketplace metadata, installer scripts, branding assets) as part of feature migration.
- Prefer behavior reimplementation from architecture and UX intent, not file-level code copying.
- If any direct code is intentionally reused from MIT-licensed Viz Vibe sources, preserve required attribution and include MIT notice text in project legal notices.
- Keep an explicit import ledger for any reused upstream files/functions (source path, commit, reason, owner).
- Do not merge direct-copy code without an accompanying legal notice update.

### MIT Compliance Requirements (Mandatory)

- Maintain a `THIRD_PARTY_NOTICES.md` (or equivalent) entry for Viz Vibe reused code paths.
- Record source repo URL, commit SHA, copied file/function path, and modification summary.
- Preserve MIT notice text for copied substantial portions in distributed source.
- Add a PR checklist item: `MIT notice/attribution requirements reviewed and satisfied`.
- Treat missing attribution as a release blocker.

### Architecture Preservation (Warden First)

- All trajectory capability must conform to Warden module boundaries (`src/cli`, `src/mcp`, `src/dashboard`, `src/work`, `src/types`, `packages/warden-vscode`).
- Avoid introducing a parallel standalone stack that bypasses Warden data model/event flow.
- Canonical source remains Warden trajectory state; Mermaid file remains compatibility projection.
- New functionality must use existing command, API, and policy patterns already used in Warden.

## Layer Model

- Layer 0: Quality and delivery gates
- Layer 1: Canonical trajectory domain
- Layer 2: Compatibility and migration (`vizvibe.mmd`)
- Layer 3: Product surfaces (CLI, MCP, dashboard, VS Code)
- Layer 4: Safety and policy for AI-originated edits
- Layer 5: Observability, governance, and cross-repo operation
- Layer 6: Trajectory Analytics and Drift Detection (Predictive velocity, agent drift)

## Layer 0: Quality and Delivery Gates

### Problem

Current repo has lint/typecheck scripts but no established automated test and CI gate for trajectory-grade changes.

### Deliverables

- Add root test scripts (`test`, optional `ci`) and runbook.
- Add Vitest config and initial unit test harness.
- Add CI workflow for install, typecheck, lint, tests, coverage.
- Define merge gate policy for trajectory feature branches.

### Dependencies

- None.

### Acceptance Criteria

- CI required check passes on 3 consecutive trajectory PRs.
- Fresh clone can run validation commands without manual fixes.
- Trajectory code cannot merge without automated checks.

## Layer 1: Canonical Trajectory Domain

### Problem

Trajectory state is currently unstructured when represented as Mermaid only.

### Deliverables

- Canonical types in `src/types/trajectory.ts` ✅
- Storage module in `src/work/trajectory-store.ts` ✅
- Invariant validation in `src/work/trajectory-invariants.ts` ✅
- Canonical per-repo storage:
  - `data/<slug>/trajectory/state.json` ✅

### Data Model (v1)

- Node fields: `id`, `title`, `type`, `status`, `findingRefs`, `workRefs`, timestamps, metadata.
- Edge fields: `from`, `to`, `kind`, metadata.
- Graph fields: `schemaVersion`, `repoSlug`, `revision`, `updatedAt`, `lastActiveNodeId`.
- Event envelope: `eventId`, `seq`, `type`, `at`, `actor`, `expectedRevision`, `payload`.

### Dependencies

- Layer 0.

### Acceptance Criteria

- Deterministic rebuild from event replay.
- Validation catches duplicate node IDs, invalid transitions, dangling edges.
- Revision conflict handling works (`expectedRevision` mismatch rejects writes).

## Layer 2: Compatibility and Migration (`vizvibe.mmd`)

### Problem

Existing users may already use `vizvibe.mmd`; hard cutover would break workflows.

### Deliverables

- Mermaid adapter in `src/work/trajectory-vizvibe.ts` ✅:
  - parse `%% @node` metadata
  - parse nodes and edge styles
  - import/export roundtrip
- Dual-write projection mode:
  - canonical JSON authoritative
  - `.mmd` updated as compatibility output
- CLI:
  - `warden trajectory import`
  - `warden trajectory export`

### Dependencies

- Layer 1.

### Acceptance Criteria

- Roundtrip semantic tests (`mmd -> canonical -> mmd`) pass.
- Migration report lists all warnings/unmapped lines.
- No silent data loss for supported syntax.

## Layer 3: Product Surfaces

### Problem

Trajectory operations need first-class interfaces across Warden surfaces.

### Deliverables

- CLI subcommands:
  - `trajectory init|get|patch|validate|link-finding|import|export`
- MCP resources/tools:
  - resources: graph/events/summary
  - tools: get/patch/link/validate/export
- Dashboard:
  - API routes for read/mutate/link
  - view route: `/repo/:slug/trajectory`
  - optional cross-repo view: `/trajectory`
- VS Code extension:
  - read-only first, then mutate actions
  - file/API data source toggle

### API Contract Requirements

- Versioned payload (`schemaVersion`) and revision-based writes.
- Standardized patch request/response envelope.
- Error classes:
  - `400` invalid schema
  - `404` missing repo/node
  - `409` revision conflict
  - `422` policy violation

### Dependencies

- Layer 1 (required)
- Layer 2 (required before import/export and compatibility outputs)

### Acceptance Criteria

- CLI/MCP/dashboard all mutate via same canonical patch path.
- Read-only mode available before mutation mode.
- Backward compatibility maintained for existing Warden commands.

## Layer 4: Safety and Policy for AI Edits

### Problem

AI-originated free-form edits can create loops, invalid state, or over-broad changes.

### Deliverables

- Policy gate pipeline:
  1. Structural validation
  2. Semantic invariant validation
  3. Authorization/trust check
  4. Risk checks (protected nodes, mutation limits)
  5. Optional runtime validation hooks
  6. Audit logging
- Idempotency keys for all external mutation requests.
- Append-only decision log with accepted/rejected outcomes.

### Reuse Existing Warden Concepts

- Trust and autonomy signals from `src/work/trust.ts` and `src/work/autonomy.ts`.
- Existing agent lint-fix discipline from `src/agents/lint-fix-agent.ts`.

### Dependencies

- Layer 1, Layer 3.

### Acceptance Criteria

- All AI writes are patch-based, policy-evaluated, and auditable.
- Duplicate/replayed requests do not double-apply.
- Direct unmanaged file mutation path is removed from default workflow.

## Layer 5: Observability, Governance, and Cross-Repo

### Problem

Without telemetry and governance, trajectory quality degrades silently at scale.

### Deliverables

- Telemetry:
  - parse success/failure
  - patch reject rate
  - orphan edges
  - sync lag (findings/work vs trajectory)
  - projection drift
- Governance:
  - redaction policy before MCP/dashboard export
  - repo-level feature flags and rollout rings
  - runbooks and revocation drills
- Cross-repo:
  - aggregate trajectory lens and scoped IDs (`<slug>::<nodeId>`)

### Dependencies

- Layers 1-4.

### Acceptance Criteria

- SLOs defined for data quality and mutation safety.
- Alerting exists for drift and policy anomalies.
- Controlled rollout path from shadow mode to GA.

## Completed Work

- ✅ Layer 0: CI workflow, tests, quality gates
- ✅ Layer 1: Canonical graph, storage, validation
- ✅ Layer 2: Mermaid import/export
- ✅ Layer 3: CLI, MCP, dashboard integration
- ✅ Layer 4: Patch validation, safety gates
- ✅ Layer 5: Wiki findings, basic observability

## Risk Register (Top 10)

1. No CI/test gate for trajectory changes.
2. Mermaid import ambiguity and unsupported constructs.
3. Drift between canonical graph and `.mmd` projection.
4. Policy bypass via direct file writes.
5. AI patch loop or replay duplication.
6. Over-permissive mutation scope for low-trust actors.
7. Sensitive data leakage in trajectory text exports.
8. High blast radius rollout without feature flags.
9. Missing alerts for graph health degradation.
10. Environment portability gaps in repo onboarding/config.

## Immediate Next Actions

1. Add first CI workflow and baseline Vitest tests (Layer 0 Delivery Gates).
2. Implement `src/types/trajectory.ts` and `src/work/trajectory-invariants.ts`.
3. Add `trajectory init|validate` commands and storage bootstrap.
4. Add `trajectory import --experimental` with migration report output.
5. Stand up minimal read-only dashboard/API route for trajectory graph.
