import { readFile } from "node:fs/promises";
import path from "node:path";

import { loadRepoConfigs, getRepoConfigBySlug } from "../config/loader.js";
import { computeDelta } from "../agents/delta.js";
import { runAnalyzeCommand } from "../cli/commands/analyze.js";
import { runCollectCommand } from "../cli/commands/collect.js";
import { runReportCommand } from "../cli/commands/report.js";
import { lookupCode } from "../findings/registry.js";
import { loadSnapshotByTimestamp, loadLatestSnapshot } from "../snapshots.js";
import {
  loadWorkDocuments,
  loadWorkDocument,
  saveWorkDocument,
  addNote,
} from "../work/manager.js";
import { loadAllTrustMetrics } from "../work/trust.js";
import type { WorkDocumentStatus } from "../types/work.js";
import { TrajectoryStore } from "../work/trajectory-store.js";
import { parseMermaidTrajectory, exportMermaidTrajectory } from "../work/trajectory-vizvibe.js";
import type { PatchOperation } from "../types/trajectory.js";
import { postTrajectoryCommentOnPr } from "../work/trajectory-comment.js";

const VALID_SLUG = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;

export async function ensureSlug(slug: string | undefined): Promise<string> {
  if (!slug || slug.trim().length === 0) {
    throw new Error("Missing repo slug");
  }

  if (!VALID_SLUG.test(slug)) {
    throw new Error(`Invalid repo slug: ${JSON.stringify(slug)}`);
  }

  const repos = await loadRepoConfigs();
  if (!repos.some((repo) => repo.slug === slug)) {
    throw new Error(`Unknown repo slug: ${JSON.stringify(slug)}`);
  }

  return slug;
}

function validateFindingId(findingId: string): void {
  if (
    findingId.includes("..") ||
    findingId.includes("/") ||
    findingId.includes("\\")
  ) {
    throw new Error("Invalid findingId");
  }
}

const VALID_STATUSES: WorkDocumentStatus[] = [
  "unassigned",
  "auto-assigned",
  "agent-in-progress",
  "agent-complete",
  "pm-review",
  "blocked",
  "resolved",
  "wont-fix",
];

export async function toolListRepos(): Promise<string> {
  const repos = await loadRepoConfigs();
  return JSON.stringify(
    repos.map((repo) => ({
      slug: repo.slug,
      type: repo.type,
      path: repo.path,
    })),
    null,
    2,
  );
}

export async function toolCollect(slug: string | undefined): Promise<string> {
  const repoSlug = await ensureSlug(slug);
  await runCollectCommand(repoSlug);
  return `Collection complete for ${repoSlug}`;
}

export async function toolAnalyze(slug: string | undefined): Promise<string> {
  const repoSlug = await ensureSlug(slug);
  await runAnalyzeCommand(repoSlug);
  return `Analysis complete for ${repoSlug}`;
}

export async function toolReport(slug: string | undefined): Promise<string> {
  const repoSlug = await ensureSlug(slug);
  await runReportCommand({ repoSlug, analyze: false });
  return `Report generated for ${repoSlug}`;
}

export async function toolWikiLookup(
  code: string | undefined,
): Promise<string> {
  if (!code || code.trim().length === 0) {
    throw new Error("Missing finding code");
  }

  const normalizedCode = code.toUpperCase();
  const definition = lookupCode(normalizedCode);
  if (!definition) {
    throw new Error(`Unknown finding code: ${normalizedCode}`);
  }

  const wikiPath = path.resolve(process.cwd(), definition.wikiPath);
  return readFile(wikiPath, "utf8");
}

export async function toolSnapshotDiff(
  slug: string | undefined,
  leftTimestamp: string | undefined,
  rightTimestamp: string | undefined,
): Promise<string> {
  const repoSlug = await ensureSlug(slug);

  const right = rightTimestamp
    ? await loadSnapshotByTimestamp(repoSlug, rightTimestamp)
    : await loadLatestSnapshot(repoSlug);

  const left = leftTimestamp
    ? await loadSnapshotByTimestamp(repoSlug, leftTimestamp)
    : null;

  if (!left) {
    return JSON.stringify({
      message: "Left snapshot not provided; pass leftTimestamp to diff.",
      rightTimestamp: right.timestamp,
    });
  }

  const delta = computeDelta(left, right);
  return JSON.stringify(
    {
      leftTimestamp: left.timestamp,
      rightTimestamp: right.timestamp,
      delta,
    },
    null,
    2,
  );
}

export async function toolListWorkDocs(
  slug: string | undefined,
): Promise<string> {
  const repoSlug = await ensureSlug(slug);
  const docs = await loadWorkDocuments(repoSlug);
  const active = docs.filter(
    (d) => d.status !== "resolved" && d.status !== "wont-fix",
  );
  return JSON.stringify(
    active.map((d) => ({
      findingId: d.findingId,
      code: d.code,
      severity: d.severity,
      status: d.status,
      consecutiveReports: d.consecutiveReports,
      trend: d.trend,
      path: d.path,
    })),
    null,
    2,
  );
}

export async function toolGetWorkDoc(
  slug: string | undefined,
  findingId: string | undefined,
): Promise<string> {
  const repoSlug = await ensureSlug(slug);
  if (!findingId || findingId.trim().length === 0) {
    throw new Error("Missing findingId");
  }
  validateFindingId(findingId);
  const doc = await loadWorkDocument(repoSlug, findingId);
  if (!doc) {
    throw new Error(`Work document not found: ${findingId}`);
  }
  return JSON.stringify(doc, null, 2);
}

export async function toolUpdateWorkStatus(
  slug: string | undefined,
  findingId: string | undefined,
  status: string | undefined,
  note: string | undefined,
): Promise<string> {
  const repoSlug = await ensureSlug(slug);
  if (!findingId || findingId.trim().length === 0) {
    throw new Error("Missing findingId");
  }
  validateFindingId(findingId);
  const doc = await loadWorkDocument(repoSlug, findingId);
  if (!doc) {
    throw new Error(`Work document not found: ${findingId}`);
  }
  if (status) {
    if (!VALID_STATUSES.includes(status as WorkDocumentStatus)) {
      throw new Error(
        `Invalid status: ${status}. Valid: ${VALID_STATUSES.join(", ")}`,
      );
    }
    doc.status = status as WorkDocumentStatus;
    if (status === "resolved") {
      doc.resolvedAt = new Date().toISOString();
    }
  }
  if (note) {
    addNote(doc, "mcp-user", note);
  }
  await saveWorkDocument(repoSlug, doc);
  return JSON.stringify({ updated: true, findingId, status: doc.status });
}

export async function toolListPlans(slug: string | undefined): Promise<string> {
  const repoSlug = await ensureSlug(slug);
  const plansDir = path.resolve(process.cwd(), "data", repoSlug, "plans");
  try {
    const { readdir } = await import("node:fs/promises");
    const entries = await readdir(plansDir);
    return JSON.stringify(entries.filter((e) => e.endsWith(".md")));
  } catch {
    return JSON.stringify([]);
  }
}

export async function toolGetPlan(
  slug: string | undefined,
  findingId: string | undefined,
): Promise<string> {
  const repoSlug = await ensureSlug(slug);
  if (!findingId || findingId.trim().length === 0) {
    throw new Error("Missing findingId");
  }
  validateFindingId(findingId);
  const planPath = path.resolve(
    process.cwd(),
    "data",
    repoSlug,
    "plans",
    `${findingId}.md`,
  );
  return readFile(planPath, "utf8");
}

export async function toolTrustScores(
  slug: string | undefined,
): Promise<string> {
  const repoSlug = await ensureSlug(slug);
  const metrics = await loadAllTrustMetrics(repoSlug);
  return JSON.stringify(metrics, null, 2);
}

export async function toolTrajectoryInit(
  slug: string | undefined,
): Promise<string> {
  const repoSlug = await ensureSlug(slug);
  const store = new TrajectoryStore(repoSlug);
  await store.init();
  return `Trajectory initialized for ${repoSlug}`;
}

export async function toolTrajectoryGet(
  slug: string | undefined,
): Promise<string> {
  const repoSlug = await ensureSlug(slug);
  const store = new TrajectoryStore(repoSlug);
  const graph = await store.load();
  return JSON.stringify(graph, null, 2);
}

export async function toolTrajectoryImport(
  slug: string | undefined,
  mermaid: string | undefined,
): Promise<string> {
  const repoSlug = await ensureSlug(slug);
  if (!mermaid) {
    throw new Error("Missing mermaid content");
  }
  const store = new TrajectoryStore(repoSlug);
  const graph = parseMermaidTrajectory(mermaid, repoSlug);
  await store.save(graph);
  return `Trajectory imported for ${repoSlug}`;
}

export async function toolTrajectoryPatch(
  slug: string | undefined,
  actor: string | undefined,
  operations: PatchOperation[] | undefined,
  expectedRevision?: number,
): Promise<string> {
  const repoSlug = await ensureSlug(slug);
  if (!operations || !Array.isArray(operations)) {
    throw new Error("Missing or invalid operations array");
  }
  const store = new TrajectoryStore(repoSlug);
  await store.patch(actor || "mcp-tool", operations, expectedRevision);
  return `Trajectory patched for ${repoSlug}`;
}

export async function toolTrajectoryExport(
  slug: string | undefined,
): Promise<string> {
  const repoSlug = await ensureSlug(slug);
  const store = new TrajectoryStore(repoSlug);
  const graph = await store.load();
  return exportMermaidTrajectory(graph);
}

export async function toolTrajectoryComment(
  slug: string | undefined,
  prNumber: string | undefined,
): Promise<string> {
  const repoSlug = await ensureSlug(slug);
  if (!prNumber || Number.isNaN(parseInt(prNumber, 10))) {
    throw new Error("Missing or invalid PR number");
  }
  const configs = await loadRepoConfigs();
  const config = getRepoConfigBySlug(configs, repoSlug);
  if (!config.github) {
    throw new Error(`Repo "${repoSlug}" has no GitHub config`);
  }
  await postTrajectoryCommentOnPr(
    config.github.owner, config.github.repo, parseInt(prNumber, 10), repoSlug,
    { includeLocalImpact: true },
  );
  return JSON.stringify({ status: "ok", repo: repoSlug, pr: parseInt(prNumber, 10) });
}
