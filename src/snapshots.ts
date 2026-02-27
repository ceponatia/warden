import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import type {
  CoverageSnapshot,
  ComplexitySnapshot,
  DebtMarkersSnapshot,
  DocStalenessSnapshot,
  GitStatsSnapshot,
  ImportsSnapshot,
  RuntimeSnapshot,
  SnapshotBundle,
  StalenessSnapshot,
} from "./types/snapshot.js";

export interface LoadedSnapshot extends SnapshotBundle {
  timestamp: string;
}

export async function readJsonIfPresent<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function listSnapshotTimestamps(slug: string): Promise<string[]> {
  const snapshotsRoot = path.resolve(process.cwd(), "data", slug, "snapshots");
  const entries = await readdir(snapshotsRoot, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => right.localeCompare(left));
}

export async function loadSnapshotByTimestamp(
  slug: string,
  timestamp: string,
): Promise<LoadedSnapshot> {
  const snapshotDir = path.resolve(
    process.cwd(),
    "data",
    slug,
    "snapshots",
    timestamp,
  );

  const [
    gitStatsRaw,
    stalenessRaw,
    debtRaw,
    complexity,
    imports,
    runtime,
    coverage,
    docStaleness,
  ] = await Promise.all([
      readFile(path.join(snapshotDir, "git-stats.json"), "utf8"),
      readFile(path.join(snapshotDir, "staleness.json"), "utf8"),
      readFile(path.join(snapshotDir, "debt-markers.json"), "utf8"),
      readJsonIfPresent<ComplexitySnapshot>(
        path.join(snapshotDir, "complexity.json"),
      ),
      readJsonIfPresent<ImportsSnapshot>(
        path.join(snapshotDir, "imports.json"),
      ),
      readJsonIfPresent<RuntimeSnapshot>(
        path.join(snapshotDir, "runtime.json"),
      ),
      readJsonIfPresent<CoverageSnapshot>(
        path.join(snapshotDir, "coverage.json"),
      ),
      readJsonIfPresent<DocStalenessSnapshot>(
        path.join(snapshotDir, "doc-staleness.json"),
      ),
    ]);

  return {
    timestamp,
    gitStats: JSON.parse(gitStatsRaw) as GitStatsSnapshot,
    staleness: JSON.parse(stalenessRaw) as StalenessSnapshot,
    debtMarkers: JSON.parse(debtRaw) as DebtMarkersSnapshot,
    complexity: complexity ?? undefined,
    imports: imports ?? undefined,
    runtime: runtime ?? undefined,
    coverage: coverage ?? undefined,
    docStaleness: docStaleness ?? undefined,
  };
}

export async function loadLatestSnapshot(
  slug: string,
): Promise<LoadedSnapshot> {
  const sorted = await listSnapshotTimestamps(slug);
  const latest = sorted[0];
  if (!latest) {
    throw new Error(
      `No snapshots found for ${slug}. Run 'warden collect' first.`,
    );
  }

  return loadSnapshotByTimestamp(slug, latest);
}

export async function loadPreviousSnapshot(
  slug: string,
): Promise<LoadedSnapshot | null> {
  const sorted = await listSnapshotTimestamps(slug);
  const previous = sorted[1];
  if (!previous) {
    return null;
  }

  return loadSnapshotByTimestamp(slug, previous);
}

export async function loadLatestSnapshotForBranch(
  slug: string,
  branch: string,
): Promise<LoadedSnapshot> {
  const sorted = await listSnapshotTimestamps(slug);

  for (const timestamp of sorted) {
    const snapshotDir = path.resolve(
      process.cwd(),
      "data",
      slug,
      "snapshots",
      timestamp,
      "git-stats.json",
    );
    const gitStats = await readJsonIfPresent<GitStatsSnapshot>(snapshotDir);
    if (gitStats?.branch === branch) {
      return loadSnapshotByTimestamp(slug, timestamp);
    }
  }

  throw new Error(
    `No snapshots found for ${slug} on branch '${branch}'. Run 'warden collect --repo ${slug}' on that branch first.`,
  );
}
