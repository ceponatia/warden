import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { PrReviewRecord, TrustMetrics } from "../types/work.js";

export interface AgentTrustSummary {
  agentName: string;
  repoScores: Record<string, number>;
  aggregateScore: number;
  globalEligible: boolean;
}

function trustPath(slug: string, agentName: string): string {
  return path.resolve(
    process.cwd(),
    "data",
    slug,
    "trust",
    `${agentName}.json`,
  );
}

function createEmptyMetrics(agentName: string): TrustMetrics {
  return {
    agentName,
    mergesAccepted: 0,
    mergesModified: 0,
    mergesRejected: 0,
    prReviewScore: 1,
    validationPassRate: 0,
    selfRepairRate: 0,
    consecutiveCleanMerges: 0,
    totalRuns: 0,
    lastRunAt: new Date().toISOString(),
  };
}

function reviewLogPath(slug: string, agentName: string): string {
  return path.resolve(
    process.cwd(),
    "data",
    slug,
    "trust",
    `${agentName}.reviews.json`,
  );
}

async function appendReviewRecord(
  slug: string,
  agentName: string,
  record: PrReviewRecord,
): Promise<void> {
  const filePath = reviewLogPath(slug, agentName);
  let current: PrReviewRecord[] = [];
  try {
    const raw = await readFile(filePath, "utf8");
    current = JSON.parse(raw) as PrReviewRecord[];
  } catch {
    current = [];
  }

  current.unshift(record);
  const capped = current.slice(0, 100);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(capped, null, 2)}\n`, "utf8");
}

export async function loadTrustMetrics(
  slug: string,
  agentName: string,
): Promise<TrustMetrics> {
  try {
    const raw = await readFile(trustPath(slug, agentName), "utf8");
    const parsed = JSON.parse(raw) as TrustMetrics;
    parsed.prReviewScore ??= 1;
    return parsed;
  } catch (error: unknown) {
    const err = error as NodeJS.ErrnoException;
    if (err && err.code === "ENOENT") {
      return createEmptyMetrics(agentName);
    }
    throw error;
  }
}

async function saveTrustMetrics(
  slug: string,
  metrics: TrustMetrics,
): Promise<void> {
  const filePath = trustPath(slug, metrics.agentName);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(metrics, null, 2)}\n`, "utf8");
}

export async function recordValidationResult(
  slug: string,
  agentName: string,
  passed: boolean,
): Promise<void> {
  const metrics = await loadTrustMetrics(slug, agentName);
  metrics.totalRuns++;
  metrics.lastRunAt = new Date().toISOString();

  // Rolling pass rate
  const prevPasses = Math.round(
    metrics.validationPassRate * (metrics.totalRuns - 1),
  );
  metrics.validationPassRate =
    (prevPasses + (passed ? 1 : 0)) / metrics.totalRuns;

  if (passed) {
    metrics.consecutiveCleanMerges++;
  } else {
    metrics.consecutiveCleanMerges = 0;
  }

  await saveTrustMetrics(slug, metrics);
}

export async function recordMergeResult(
  slug: string,
  agentName: string,
  result: "accepted" | "modified" | "rejected",
): Promise<void> {
  const metrics = await loadTrustMetrics(slug, agentName);

  if (result === "accepted") {
    metrics.mergesAccepted++;
    metrics.consecutiveCleanMerges++;
  } else if (result === "modified") {
    metrics.mergesModified++;
    metrics.consecutiveCleanMerges = 0;
  } else {
    metrics.mergesRejected++;
    metrics.consecutiveCleanMerges = 0;
  }

  metrics.lastRunAt = new Date().toISOString();
  await saveTrustMetrics(slug, metrics);
}

export async function loadAllTrustMetrics(
  slug: string,
): Promise<TrustMetrics[]> {
  const dir = path.resolve(process.cwd(), "data", slug, "trust");
  let entries: string[];
  try {
    const { readdir } = await import("node:fs/promises");
    const dirEntries = await readdir(dir);
    entries = dirEntries.filter((e) => e.endsWith(".json"));
  } catch {
    return [];
  }

  const results: TrustMetrics[] = [];
  for (const entry of entries) {
    try {
      const raw = await readFile(path.join(dir, entry), "utf8");
      const parsed = JSON.parse(raw) as TrustMetrics;
      parsed.prReviewScore ??= 1;
      results.push(parsed);
    } catch {
      // Skip files that cannot be read or parsed
    }
  }
  return results;
}

export async function recordPrReviewResult(
  slug: string,
  agentName: string,
  passed: boolean,
  comments: string[],
): Promise<void> {
  const metrics = await loadTrustMetrics(slug, agentName);

  if (passed) {
    metrics.prReviewScore = Math.min(1, metrics.prReviewScore + 0.05);
  } else {
    metrics.prReviewScore = Math.max(0, metrics.prReviewScore - 0.15);
  }

  metrics.lastRunAt = new Date().toISOString();
  await saveTrustMetrics(slug, metrics);
  await appendReviewRecord(slug, agentName, {
    reviewedAt: metrics.lastRunAt,
    passed,
    comments,
  });
}

function scoreTrust(metrics: TrustMetrics): number {
  const mergeTotal =
    metrics.mergesAccepted + metrics.mergesModified + metrics.mergesRejected;
  const acceptanceRate =
    mergeTotal > 0 ? metrics.mergesAccepted / mergeTotal : 0.5;
  const cleanMergeScore = Math.min(1, metrics.consecutiveCleanMerges / 10);
  const validationScore = Math.max(0, Math.min(1, metrics.validationPassRate));
  const reviewScore = Math.max(0, Math.min(1, metrics.prReviewScore));

  return Number(
    (
      acceptanceRate * 0.35 +
      validationScore * 0.35 +
      reviewScore * 0.2 +
      cleanMergeScore * 0.1
    ).toFixed(4),
  );
}

function scoreWeight(metrics: TrustMetrics): number {
  const mergeTotal =
    metrics.mergesAccepted + metrics.mergesModified + metrics.mergesRejected;
  const evidencePoints = mergeTotal + metrics.totalRuns;
  return Math.max(1, evidencePoints);
}

export async function computeAggregateTrust(
  agentName: string,
  repoSlugs: string[],
): Promise<AgentTrustSummary> {
  const uniqueSlugs = [...new Set(repoSlugs)];
  if (uniqueSlugs.length === 0) {
    return {
      agentName,
      repoScores: {},
      aggregateScore: 0,
      globalEligible: false,
    };
  }

  const repoScores: Record<string, number> = {};
  let weightedTotal = 0;
  let totalWeight = 0;

  for (const slug of uniqueSlugs) {
    const metrics = await loadTrustMetrics(slug, agentName);
    const score = scoreTrust(metrics);
    const weight = scoreWeight(metrics);
    repoScores[slug] = score;
    weightedTotal += score * weight;
    totalWeight += weight;
  }

  const aggregateScore =
    totalWeight > 0 ? Number((weightedTotal / totalWeight).toFixed(4)) : 0;
  const minRepoScore = Math.min(...Object.values(repoScores));

  return {
    agentName,
    repoScores,
    aggregateScore,
    globalEligible: minRepoScore >= 0.5 && aggregateScore >= 0.7,
  };
}
