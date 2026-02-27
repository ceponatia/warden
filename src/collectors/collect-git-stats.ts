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
  churnCommits: Map<string, Set<string>>;
}

function parseCommitLine(line: string): string | null {
  if (!line.startsWith("commit ")) {
    return null;
  }

  return line.split(" ")[1] ?? null;
}

function parseNumstatLine(
  line: string,
): { added: number; removed: number; filePath: string } | null {
  const parts = line.split("\t");
  if (parts.length < 3) {
    return null;
  }

  const added = safeNumber(parts[0] ?? "0");
  const removed = safeNumber(parts[1] ?? "0");
  const rawPath = parts.slice(2).join("\t").trim();
  const filePath = normalizePath(rawPath.replace(/^[ab]\//, ""));
  return { added, removed, filePath };
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
  const churnCommits = new Map<string, Set<string>>();
  let currentCommit = "";

  for (const line of output.split(/\r?\n/)) {
    if (!line) {
      continue;
    }

    const commit = parseCommitLine(line);
    if (commit) {
      currentCommit = commit;
      continue;
    }

    const parsedLine = parseNumstatLine(line);
    if (!parsedLine) {
      continue;
    }

    const { added, removed, filePath } = parsedLine;

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

      if (currentCommit) {
        const files = churnCommits.get(currentCommit) ?? new Set<string>();
        files.add(filePath);
        churnCommits.set(currentCommit, files);
      }
    }
  }

  return {
    growthFiles,
    churnFiles,
    directoryAdded,
    directoryRemoved,
    churnCommits,
  };
}

function buildFileCommitMap(
  churnCommits: Map<string, Set<string>>,
): Map<string, Set<string>> {
  const fileCommits = new Map<string, Set<string>>();
  for (const [commit, files] of churnCommits.entries()) {
    for (const file of files) {
      const set = fileCommits.get(file) ?? new Set<string>();
      set.add(commit);
      fileCommits.set(file, set);
    }
  }

  return fileCommits;
}

function connectAdjacency(
  adjacency: Map<string, Set<string>>,
  left: string,
  right: string,
): void {
  const leftSet = adjacency.get(left) ?? new Set<string>();
  leftSet.add(right);
  adjacency.set(left, leftSet);

  const rightSet = adjacency.get(right) ?? new Set<string>();
  rightSet.add(left);
  adjacency.set(right, rightSet);
}

function buildCorrelatedEdges(
  fileCommits: Map<string, Set<string>>,
  minCommits: number,
  minRate: number,
): {
  adjacency: Map<string, Set<string>>;
  pairRates: Map<string, number>;
} {
  const eligible = [...fileCommits.entries()]
    .filter(([, commits]) => commits.size >= minCommits)
    .map(([file]) => file)
    .sort((a, b) => a.localeCompare(b));

  const adjacency = new Map<string, Set<string>>();
  const pairRates = new Map<string, number>();

  for (let i = 0; i < eligible.length; i += 1) {
    const left = eligible[i];
    if (!left) {
      continue;
    }
    const leftCommits = fileCommits.get(left);
    if (!leftCommits) {
      continue;
    }

    for (let j = i + 1; j < eligible.length; j += 1) {
      const right = eligible[j];
      if (!right) {
        continue;
      }
      const rightCommits = fileCommits.get(right);
      if (!rightCommits) {
        continue;
      }

      let shared = 0;
      for (const commit of leftCommits) {
        if (rightCommits.has(commit)) {
          shared += 1;
        }
      }

      if (shared < minCommits) {
        continue;
      }

      const denominator = Math.max(leftCommits.size, rightCommits.size);
      const rate = denominator > 0 ? shared / denominator : 0;
      if (rate < minRate) {
        continue;
      }

      pairRates.set(`${left}::${right}`, rate);
      connectAdjacency(adjacency, left, right);
    }
  }

  return { adjacency, pairRates };
}

function collectConnectedComponents(
  adjacency: Map<string, Set<string>>,
): string[][] {
  const visited = new Set<string>();
  const components: string[][] = [];

  for (const file of adjacency.keys()) {
    if (visited.has(file)) {
      continue;
    }

    const stack = [file];
    const component: string[] = [];
    visited.add(file);

    while (stack.length > 0) {
      const current = stack.pop();
      if (!current) {
        continue;
      }

      component.push(current);
      const neighbors = adjacency.get(current) ?? new Set<string>();
      for (const neighbor of neighbors) {
        if (visited.has(neighbor)) {
          continue;
        }
        visited.add(neighbor);
        stack.push(neighbor);
      }
    }

    if (component.length >= 2) {
      component.sort((a, b) => a.localeCompare(b));
      components.push(component);
    }
  }

  return components;
}

function summarizeComponent(
  component: string[],
  pairRates: Map<string, number>,
  fileCommits: Map<string, Set<string>>,
): WindowStats["correlatedChurnGroups"][number] {
  let rateSum = 0;
  let rateCount = 0;
  for (let i = 0; i < component.length; i += 1) {
    const left = component[i];
    if (!left) {
      continue;
    }
    for (let j = i + 1; j < component.length; j += 1) {
      const right = component[j];
      if (!right) {
        continue;
      }
      const direct =
        pairRates.get(`${left}::${right}`) ??
        pairRates.get(`${right}::${left}`);
      if (typeof direct === "number") {
        rateSum += direct;
        rateCount += 1;
      }
    }
  }

  const commitUnion = new Set<string>();
  for (const file of component) {
    const commits = fileCommits.get(file) ?? new Set<string>();
    for (const commit of commits) {
      commitUnion.add(commit);
    }
  }

  return {
    files: component,
    coCommitRate: rateCount > 0 ? Number((rateSum / rateCount).toFixed(2)) : 0,
    totalCommits: commitUnion.size,
  };
}

function computeCorrelatedChurnGroups(
  churnCommits: Map<string, Set<string>>,
  minCommits: number,
  minRate: number,
): WindowStats["correlatedChurnGroups"] {
  const fileCommits = buildFileCommitMap(churnCommits);
  const { adjacency, pairRates } = buildCorrelatedEdges(
    fileCommits,
    minCommits,
    minRate,
  );
  const components = collectConnectedComponents(adjacency);

  if (components.length === 0) {
    return [];
  }

  return components
    .map((component) => summarizeComponent(component, pairRates, fileCommits))
    .sort((left, right) => right.coCommitRate - left.coCommitRate);
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
  churnCommits: Map<string, Set<string>>,
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
  const correlatedChurnGroups = computeCorrelatedChurnGroups(
    churnCommits,
    config.thresholds.correlatedChurnMinCommits,
    config.thresholds.correlatedChurnRate,
  );

  return {
    totalFilesChanged,
    totalLinesAdded,
    totalLinesRemoved,
    repoAverageGrowth: Number(repoAverageGrowth.toFixed(2)),
    files: flaggedFiles,
    directories: flaggedDirectories,
    highChurnFiles,
    correlatedChurnGroups,
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
    parsed.churnCommits,
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
