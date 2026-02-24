import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import type {
  ComplexitySnapshot,
  ImportsSnapshot,
  RepoConfig,
  RuntimeSnapshot,
  SnapshotBundle,
} from "../types/snapshot.js";
import type { GitStatsSnapshot, StalenessSnapshot, DebtMarkersSnapshot } from "../types/snapshot.js";
import { computeDelta } from "./delta.js";
import { assemblePrompt } from "./prompt.js";
import { callProvider } from "./provider.js";

async function readJsonIfPresent<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function loadSnapshotFromDir(
  snapshotDir: string,
): Promise<SnapshotBundle> {
  const [gitStatsRaw, stalenessRaw, debtRaw, complexity, imports, runtime] =
    await Promise.all([
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
    ]);

  return {
    gitStats: JSON.parse(gitStatsRaw) as GitStatsSnapshot,
    staleness: JSON.parse(stalenessRaw) as StalenessSnapshot,
    debtMarkers: JSON.parse(debtRaw) as DebtMarkersSnapshot,
    complexity: complexity ?? undefined,
    imports: imports ?? undefined,
    runtime: runtime ?? undefined,
  };
}

async function resolveSnapshotDirs(
  config: RepoConfig,
): Promise<{ latest: string; previous: string | null }> {
  const snapshotsRoot = path.resolve(
    process.cwd(),
    "data",
    config.slug,
    "snapshots",
  );
  const entries = await readdir(snapshotsRoot, { withFileTypes: true });
  const sorted = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => right.localeCompare(left));

  const latestName = sorted[0];
  if (!latestName) {
    throw new Error(
      `No snapshots found for ${config.slug}. Run 'warden collect' first.`,
    );
  }

  const latest = path.join(snapshotsRoot, latestName);
  const previous =
    sorted[1] != null ? path.join(snapshotsRoot, sorted[1]) : null;

  return { latest, previous };
}

export interface AnalysisResult {
  analysis: string;
  snapshotTimestamp: string;
}

export async function runAnalysis(
  config: RepoConfig,
): Promise<AnalysisResult> {
  const { latest, previous } = await resolveSnapshotDirs(config);
  const snapshotTimestamp = path.basename(latest);

  const currentBundle = await loadSnapshotFromDir(latest);

  let delta = undefined;
  if (previous) {
    const previousBundle = await loadSnapshotFromDir(previous);
    delta = computeDelta(previousBundle, currentBundle);
  }

  const userPrompt = assemblePrompt(config, currentBundle, delta);
  const analysis = await callProvider({
    systemPrompt:
      "You are Warden, a repository health analyst. Analyze the provided snapshot data and produce a concise, actionable maintenance report with prioritized next steps. Use markdown. Stay under 600 words.",
    userPrompt,
  });

  return { analysis, snapshotTimestamp };
}
