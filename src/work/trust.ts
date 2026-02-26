import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { TrustMetrics } from "../types/work.js";

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
    validationPassRate: 0,
    selfRepairRate: 0,
    consecutiveCleanMerges: 0,
    totalRuns: 0,
    lastRunAt: new Date().toISOString(),
  };
}

export async function loadTrustMetrics(
  slug: string,
  agentName: string,
): Promise<TrustMetrics> {
  try {
    const raw = await readFile(trustPath(slug, agentName), "utf8");
    return JSON.parse(raw) as TrustMetrics;
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
      results.push(JSON.parse(raw) as TrustMetrics);
    } catch {
      // Skip files that cannot be read or parsed
    }
  }
  return results;
}
