import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { resolveFileScope } from "../config/scope.js";
import type {
  CoverageFileEntry,
  CoverageSnapshot,
  GitStatsSnapshot,
  RepoConfig,
  ScopeRule,
} from "../types/snapshot.js";
import { normalizePath, runCommand } from "./utils.js";

interface CoverageSummaryEntry {
  lines?: { pct?: number };
  functions?: { pct?: number };
  branches?: { pct?: number };
}

interface IstanbulFileMap {
  fnMap?: Record<string, { name?: string }>;
  f?: Record<string, number>;
  s?: Record<string, number>;
  b?: Record<string, number[]>;
}

interface V8CoverageFile {
  result?: Array<{
    url?: string;
    functions?: Array<{
      functionName?: string;
      ranges?: Array<{ count?: number }>;
    }>;
  }>;
}

interface V8ScriptStats {
  totalFunctions: number;
  coveredFunctions: number;
  totalRanges: number;
  coveredRanges: number;
  uncoveredFunctions: string[];
}

function toPercent(covered: number, total: number): number {
  if (total <= 0) {
    return 0;
  }

  return Number(((covered / total) * 100).toFixed(2));
}

function asPct(raw: number | undefined): number {
  if (typeof raw !== "number" || Number.isNaN(raw)) {
    return 0;
  }

  return Math.max(0, Math.min(100, Number(raw.toFixed(2))));
}

function normalizeCoveragePath(repoPath: string, rawPath: string): string {
  const withoutScheme = rawPath.startsWith("file://")
    ? rawPath.replace("file://", "")
    : rawPath;

  const normalized = normalizePath(withoutScheme);
  const repoNormalized = normalizePath(path.resolve(repoPath));

  if (normalized.startsWith(repoNormalized)) {
    return normalizePath(path.relative(repoNormalized, normalized));
  }

  return normalizePath(normalized.replace(/^\.\//, ""));
}

function toCoverageEntriesFromSummary(
  repoPath: string,
  parsed: Record<string, CoverageSummaryEntry>,
): CoverageFileEntry[] {
  return Object.entries(parsed)
    .filter(([key]) => key !== "total")
    .map(([key, value]) => ({
      path: normalizeCoveragePath(repoPath, key),
      lineCoverage: asPct(value.lines?.pct),
      functionCoverage: asPct(value.functions?.pct),
      branchCoverage: asPct(value.branches?.pct),
      uncoveredFunctions: [],
      isHighChurn: false,
    }));
}

function toCoverageEntriesFromIstanbul(
  repoPath: string,
  parsed: Record<string, IstanbulFileMap>,
): CoverageFileEntry[] {
  const entries: CoverageFileEntry[] = [];

  for (const [filePath, stats] of Object.entries(parsed)) {
    const functions = stats.f ?? {};
    const functionMap = stats.fnMap ?? {};
    const statements = stats.s ?? {};
    const branches = stats.b ?? {};

    const functionHits = Object.values(functions);
    const statementHits = Object.values(statements);
    const branchHits = Object.values(branches).flat();

    const uncoveredFunctions = Object.entries(functions)
      .filter(([, count]) => count <= 0)
      .map(([fnId]) => functionMap[fnId]?.name ?? `fn#${fnId}`)
      .slice(0, 20);

    entries.push({
      path: normalizeCoveragePath(repoPath, filePath),
      lineCoverage: toPercent(
        statementHits.filter((count) => count > 0).length,
        statementHits.length,
      ),
      functionCoverage: toPercent(
        functionHits.filter((count) => count > 0).length,
        functionHits.length,
      ),
      branchCoverage: toPercent(
        branchHits.filter((count) => count > 0).length,
        branchHits.length,
      ),
      uncoveredFunctions,
      isHighChurn: false,
    });
  }

  return entries;
}

function emptyEntry(pathValue: string): CoverageFileEntry {
  return {
    path: pathValue,
    lineCoverage: 0,
    functionCoverage: 0,
    branchCoverage: 0,
    uncoveredFunctions: [],
    isHighChurn: false,
  };
}

function buildV8ScriptStats(script: NonNullable<V8CoverageFile["result"]>[number]): V8ScriptStats {
  const stats: V8ScriptStats = {
    totalFunctions: 0,
    coveredFunctions: 0,
    totalRanges: 0,
    coveredRanges: 0,
    uncoveredFunctions: [],
  };

  for (const fn of script.functions ?? []) {
    stats.totalFunctions += 1;
    const covered = (fn.ranges ?? []).some((range) => (range.count ?? 0) > 0);
    if (covered) {
      stats.coveredFunctions += 1;
    } else if (fn.functionName) {
      stats.uncoveredFunctions.push(fn.functionName);
    }

    for (const range of fn.ranges ?? []) {
      stats.totalRanges += 1;
      if ((range.count ?? 0) > 0) {
        stats.coveredRanges += 1;
      }
    }
  }

  return stats;
}

function toCoverageEntriesFromV8(repoPath: string, parsed: V8CoverageFile): CoverageFileEntry[] {
  const byPath = new Map<string, CoverageFileEntry>();

  for (const script of parsed.result ?? []) {
    if (!script.url || !script.url.includes(path.sep) || script.url.includes("node_modules")) {
      continue;
    }

    const normalized = normalizeCoveragePath(repoPath, script.url);
    const current = byPath.get(normalized) ?? emptyEntry(normalized);
    const scriptStats = buildV8ScriptStats(script);

    current.functionCoverage = toPercent(scriptStats.coveredFunctions, scriptStats.totalFunctions);
    current.lineCoverage = toPercent(scriptStats.coveredRanges, scriptStats.totalRanges);
    current.branchCoverage = current.lineCoverage;
    current.uncoveredFunctions = scriptStats.uncoveredFunctions.slice(0, 20);

    byPath.set(normalized, current);
  }

  return [...byPath.values()];
}

async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function loadVitestOrJestSummary(
  config: RepoConfig,
): Promise<CoverageFileEntry[]> {
  const summaryPath = path.resolve(config.path, "coverage", "coverage-summary.json");
  const parsed = await readJson<Record<string, CoverageSummaryEntry>>(summaryPath);
  if (!parsed) {
    return [];
  }

  return toCoverageEntriesFromSummary(config.path, parsed);
}

async function loadV8Coverage(config: RepoConfig): Promise<CoverageFileEntry[]> {
  const envDir = process.env.NODE_V8_COVERAGE;
  const candidates = [
    path.resolve(config.path, ".warden", "runtime", "v8-coverage"),
    envDir ? path.resolve(envDir) : null,
  ].filter((item): item is string => Boolean(item));

  for (const dir of candidates) {
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      const files = entries
        .filter((entry) => entry.isFile() && entry.name.startsWith("coverage-") && entry.name.endsWith(".json"))
        .map((entry) => path.join(dir, entry.name));
      if (files.length === 0) {
        continue;
      }

      const merged = new Map<string, CoverageFileEntry>();
      for (const filePath of files) {
        const parsed = await readJson<V8CoverageFile>(filePath);
        if (!parsed) {
          continue;
        }

        for (const entry of toCoverageEntriesFromV8(config.path, parsed)) {
          merged.set(entry.path, entry);
        }
      }

      return [...merged.values()];
    } catch {
      continue;
    }
  }

  return [];
}

async function loadIstanbulCoverage(
  config: RepoConfig,
): Promise<CoverageFileEntry[]> {
  const candidates = [
    path.resolve(config.path, ".nyc_output", "out.json"),
    path.resolve(config.path, "coverage", "coverage-final.json"),
  ];

  for (const candidate of candidates) {
    const parsed = await readJson<Record<string, IstanbulFileMap>>(candidate);
    if (!parsed) {
      continue;
    }

    return toCoverageEntriesFromIstanbul(config.path, parsed);
  }

  return [];
}

async function readPreviousCoverage(
  config: RepoConfig,
): Promise<Map<string, number>> {
  const snapshotsRoot = path.resolve(process.cwd(), "data", config.slug, "snapshots");
  try {
    const entries = await readdir(snapshotsRoot, { withFileTypes: true });
    const sorted = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((a, b) => b.localeCompare(a));

    for (const timestamp of sorted) {
      const candidate = path.join(snapshotsRoot, timestamp, "coverage.json");
      const parsed = await readJson<CoverageSnapshot>(candidate);
      if (!parsed) {
        continue;
      }

      return new Map(parsed.files.map((entry) => [entry.path, entry.lineCoverage]));
    }
  } catch {
    return new Map<string, number>();
  }

  return new Map<string, number>();
}

function annotateWithChurn(
  entries: CoverageFileEntry[],
  gitStats: GitStatsSnapshot,
): CoverageFileEntry[] {
  const churnMap = new Map(
    gitStats.windows["7d"].highChurnFiles.map((entry) => [entry.path, entry.editCount]),
  );

  return entries.map((entry) => {
    const edits = churnMap.get(entry.path);
    return {
      ...entry,
      isHighChurn: typeof edits === "number",
      churnEdits: edits,
    };
  });
}

export async function collectCoverage(
  config: RepoConfig,
  scopeRules: ScopeRule[],
  gitStats: GitStatsSnapshot,
): Promise<CoverageSnapshot> {
  const branch = (
    await runCommand("git", ["rev-parse", "--abbrev-ref", "HEAD"], config.path)
  ).trim();

  const previousCoverage = await readPreviousCoverage(config);

  const sources = [
    await loadVitestOrJestSummary(config),
    await loadV8Coverage(config),
    await loadIstanbulCoverage(config),
  ];
  const first = sources.find((entries) => entries.length > 0) ?? [];

  const scoped = first.filter((entry) => {
    const scope = resolveFileScope(entry.path, scopeRules);
    return !scope.ignored && scope.metrics.includes("coverage");
  });

  const withChurn = annotateWithChurn(scoped, gitStats)
    .map((entry) => {
      const previous = previousCoverage.get(entry.path);
      return {
        ...entry,
        lineCoverageDelta:
          typeof previous === "number"
            ? Number((entry.lineCoverage - previous).toFixed(2))
            : undefined,
      };
    })
    .sort((left, right) => left.lineCoverage - right.lineCoverage);

  const totalFiles = withChurn.length;
  const coveredFiles = withChurn.filter((entry) => entry.lineCoverage > 0).length;
  const averageCoverage =
    totalFiles > 0
      ? Number(
          (
            withChurn.reduce((sum, entry) => sum + entry.lineCoverage, 0) / totalFiles
          ).toFixed(2),
        )
      : 0;

  return {
    collectedAt: new Date().toISOString(),
    branch,
    summary: {
      totalFiles,
      coveredFiles,
      averageCoverage,
      filesBelow50: withChurn.filter((entry) => entry.lineCoverage < 50).length,
      filesBelow80: withChurn.filter((entry) => entry.lineCoverage < 80).length,
    },
    files: withChurn,
  };
}
