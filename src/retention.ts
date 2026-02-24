import { readdir, rm, unlink } from "node:fs/promises";
import path from "node:path";

import type { RepoConfig } from "./types/snapshot.js";

export interface PruneResult {
  snapshots: string[];
  reports: string[];
}

function sortDescendingByName(entries: string[]): string[] {
  return [...entries].sort((left, right) => right.localeCompare(left));
}

async function listDirectories(root: string): Promise<string[]> {
  try {
    const entries = await readdir(root, { withFileTypes: true });
    return sortDescendingByName(
      entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name),
    );
  } catch (error) {
    const errorWithCode = error as NodeJS.ErrnoException;
    if (errorWithCode.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function listFiles(root: string): Promise<string[]> {
  try {
    const entries = await readdir(root, { withFileTypes: true });
    return sortDescendingByName(
      entries.filter((entry) => entry.isFile()).map((entry) => entry.name),
    );
  } catch (error) {
    const errorWithCode = error as NodeJS.ErrnoException;
    if (errorWithCode.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

function toKeepCount(keep: number): number {
  return Number.isFinite(keep) && keep > 0 ? Math.floor(keep) : 1;
}

export async function pruneSnapshots(
  slug: string,
  keep: number,
): Promise<string[]> {
  const keepCount = toKeepCount(keep);
  const snapshotsDir = path.resolve(process.cwd(), "data", slug, "snapshots");
  const snapshotDirs = await listDirectories(snapshotsDir);
  const toDelete = snapshotDirs.slice(keepCount);

  await Promise.all(
    toDelete.map((entry) =>
      rm(path.join(snapshotsDir, entry), { recursive: true, force: true }),
    ),
  );

  return toDelete;
}

export async function pruneReports(
  slug: string,
  keep: number,
): Promise<string[]> {
  const keepCount = toKeepCount(keep);
  const reportsDir = path.resolve(process.cwd(), "data", slug, "reports");
  const reportFiles = await listFiles(reportsDir);
  const toDelete = reportFiles.slice(keepCount);

  await Promise.all(
    toDelete.map((entry) =>
      unlink(path.join(reportsDir, entry)).catch(() => {}),
    ),
  );

  return toDelete;
}

export async function pruneRepoArtifacts(
  config: RepoConfig,
  keepOverride?: number,
): Promise<PruneResult> {
  const snapshotsKeep = keepOverride ?? config.retention.snapshots;
  const reportsKeep = keepOverride ?? config.retention.reports;
  const [snapshots, reports] = await Promise.all([
    pruneSnapshots(config.slug, snapshotsKeep),
    pruneReports(config.slug, reportsKeep),
  ]);

  return { snapshots, reports };
}
