import path from "node:path";

import { resolveFileScope } from "../config/scope.js";
import type {
  ChurnEntry,
  DirGrowthEntry,
  FileGrowthEntry,
  GitStatsSnapshot,
  RepoConfig,
  ScopeRule,
  WindowStats,
} from "../types/snapshot.js";
import { normalizePath, runCommand } from "./utils.js";

interface MutableFileStats {
  path: string;
  linesAdded: number;
  linesRemoved: number;
  editCount: number;
}

interface ParsedGitStats {
  growthFiles: Map<string, MutableFileStats>;
  churnFiles: Map<string, MutableFileStats>;
  directoryAdded: Map<string, number>;
  directoryRemoved: Map<string, number>;
}

const WINDOWS = ["7d", "30d", "90d"] as const;

function safeNumber(raw: string): number {
  if (raw === "-") {
    return 0;
  }

  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function upsertFileStats(
  map: Map<string, MutableFileStats>,
  filePath: string,
  added: number,
  removed: number,
): void {
  const current = map.get(filePath) ?? {
    path: filePath,
    linesAdded: 0,
    linesRemoved: 0,
    editCount: 0,
  };
  current.linesAdded += added;
  current.linesRemoved += removed;
  current.editCount += 1;
  map.set(filePath, current);
}

function parseGitNumstatOutput(
  output: string,
  scopeRules: ScopeRule[],
): ParsedGitStats {
  const growthFiles = new Map<string, MutableFileStats>();
  const churnFiles = new Map<string, MutableFileStats>();
  const directoryAdded = new Map<string, number>();
  const directoryRemoved = new Map<string, number>();

  for (const line of output.split(/\r?\n/)) {
    if (!line || line.startsWith("commit ")) {
      continue;
    }

    const parts = line.split("\t");
    if (parts.length < 3) {
      continue;
    }

    const added = safeNumber(parts[0] ?? "0");
    const removed = safeNumber(parts[1] ?? "0");
    const rawPath = parts.slice(2).join("\t").trim();
    const filePath = normalizePath(rawPath.replace(/^[ab]\//, ""));

    const scope = resolveFileScope(filePath, scopeRules);
    if (scope.ignored) {
      continue;
    }

    if (scope.metrics.includes("growth")) {
      upsertFileStats(growthFiles, filePath, added, removed);

      const directory = normalizePath(path.dirname(filePath));
      directoryAdded.set(
        directory,
        (directoryAdded.get(directory) ?? 0) + added,
      );
      directoryRemoved.set(
        directory,
        (directoryRemoved.get(directory) ?? 0) + removed,
      );
    }

    if (scope.metrics.includes("churn")) {
      upsertFileStats(churnFiles, filePath, added, removed);
    }
  }

  return { growthFiles, churnFiles, directoryAdded, directoryRemoved };
}

function getFlaggedFiles(
  fileStats: MutableFileStats[],
  repoAverageGrowth: number,
  growthMultiplier: number,
): FileGrowthEntry[] {
  return fileStats
    .map((entry) => {
      const denominator = repoAverageGrowth > 0 ? repoAverageGrowth : 1;
      const ratio = entry.linesAdded / denominator;
      return {
        path: entry.path,
        linesAdded: entry.linesAdded,
        linesRemoved: entry.linesRemoved,
        netGrowth: entry.linesAdded - entry.linesRemoved,
        growthRatio: Number(ratio.toFixed(2)),
      };
    })
    .filter((entry) => entry.growthRatio >= growthMultiplier)
    .sort((left, right) => right.growthRatio - left.growthRatio);
}

function getFlaggedDirectories(
  fileStats: MutableFileStats[],
  directoryAdded: Map<string, number>,
  directoryRemoved: Map<string, number>,
  directoryGrowthPctThreshold: number,
): DirGrowthEntry[] {
  return [...directoryAdded.entries()]
    .map(([directory, added]) => {
      const removed = directoryRemoved.get(directory) ?? 0;
      const denominator = Math.max(removed, 1);
      const growthPct = (added / denominator) * 100;
      const newFiles = fileStats.filter(
        (entry) =>
          normalizePath(path.dirname(entry.path)) === directory &&
          entry.linesRemoved === 0,
      ).length;

      return {
        path: directory,
        totalLinesAdded: added,
        growthPct: Number(growthPct.toFixed(2)),
        newFiles,
      };
    })
    .filter((entry) => entry.growthPct >= directoryGrowthPctThreshold)
    .sort((left, right) => right.growthPct - left.growthPct);
}

function getHighChurnFiles(
  fileStats: MutableFileStats[],
  highChurnEditsThreshold: number,
): ChurnEntry[] {
  return fileStats
    .filter((entry) => entry.editCount >= highChurnEditsThreshold)
    .map((entry) => ({
      path: entry.path,
      editCount: entry.editCount,
      addDeleteRatio: Number(
        (entry.linesAdded / Math.max(entry.linesRemoved, 1)).toFixed(2),
      ),
    }))
    .sort((left, right) => right.editCount - left.editCount);
}

function buildWindowStats(
  config: RepoConfig,
  growthFiles: Map<string, MutableFileStats>,
  churnFiles: Map<string, MutableFileStats>,
  directoryAdded: Map<string, number>,
  directoryRemoved: Map<string, number>,
): WindowStats {
  const growthFileStats = [...growthFiles.values()];
  const churnFileStats = [...churnFiles.values()];

  const totalLinesAdded = growthFileStats.reduce(
    (total, entry) => total + entry.linesAdded,
    0,
  );
  const totalLinesRemoved = growthFileStats.reduce(
    (total, entry) => total + entry.linesRemoved,
    0,
  );
  const totalFilesChanged = growthFileStats.length;
  const repoAverageGrowth =
    totalFilesChanged > 0 ? totalLinesAdded / totalFilesChanged : 0;

  const flaggedFiles = getFlaggedFiles(
    growthFileStats,
    repoAverageGrowth,
    config.thresholds.growthMultiplier,
  );
  const flaggedDirectories = getFlaggedDirectories(
    growthFileStats,
    directoryAdded,
    directoryRemoved,
    config.thresholds.directoryGrowthPct,
  );
  const highChurnFiles = getHighChurnFiles(
    churnFileStats,
    config.thresholds.highChurnEdits,
  );

  return {
    totalFilesChanged,
    totalLinesAdded,
    totalLinesRemoved,
    repoAverageGrowth: Number(repoAverageGrowth.toFixed(2)),
    files: flaggedFiles,
    directories: flaggedDirectories,
    highChurnFiles,
  };
}

async function collectWindowStats(
  config: RepoConfig,
  scopeRules: ScopeRule[],
  window: string,
): Promise<WindowStats> {
  const output = await runCommand(
    "git",
    ["log", "--numstat", "--format=commit %H %aI", `--since=${window}`],
    config.path,
  );

  const parsed = parseGitNumstatOutput(output, scopeRules);
  return buildWindowStats(
    config,
    parsed.growthFiles,
    parsed.churnFiles,
    parsed.directoryAdded,
    parsed.directoryRemoved,
  );
}

export async function collectGitStats(
  config: RepoConfig,
  scopeRules: ScopeRule[],
): Promise<GitStatsSnapshot> {
  const branch = (
    await runCommand("git", ["rev-parse", "--abbrev-ref", "HEAD"], config.path)
  ).trim();

  const results = await Promise.all(
    WINDOWS.map((window) => collectWindowStats(config, scopeRules, window)),
  );
  const sevenDay = results[0]!;
  const thirtyDay = results[1]!;
  const ninetyDay = results[2]!;

  return {
    collectedAt: new Date().toISOString(),
    branch,
    windows: {
      "7d": sevenDay,
      "30d": thirtyDay,
      "90d": ninetyDay,
    },
  };
}
