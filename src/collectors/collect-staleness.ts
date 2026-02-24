import path from "node:path";
import { readFile, stat } from "node:fs/promises";

import { resolveFileScope } from "../config/scope.js";
import type {
  RepoConfig,
  ScopeRule,
  StaleDirEntry,
  StaleFileEntry,
  StalenessSnapshot,
} from "../types/snapshot.js";
import {
  collectFiles,
  daysBetween,
  normalizePath,
  runCommand,
} from "./utils.js";

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];

function parseGitLastTouchedMap(output: string): Map<string, string> {
  const map = new Map<string, string>();
  let currentDate = "";

  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    if (/^\d{4}-\d{2}-\d{2}T/.test(trimmed)) {
      currentDate = trimmed;
      continue;
    }

    if (currentDate) {
      map.set(normalizePath(trimmed), currentDate);
    }
  }

  return map;
}

function resolveImportTarget(importer: string, target: string): string | null {
  if (!target.startsWith(".")) {
    return null;
  }

  const importerDir = path.dirname(importer);
  const absoluteBase = path.resolve(importerDir, target);
  return normalizePath(absoluteBase);
}

function extractImportTargets(content: string): string[] {
  const results: string[] = [];
  const importRegex = /import\s+(?:[^"']+\s+from\s+)?["']([^"']+)["']/g;
  const requireRegex = /require\(\s*["']([^"']+)["']\s*\)/g;
  const dynamicImportRegex = /import\(\s*["']([^"']+)["']\s*\)/g;

  for (const regex of [importRegex, requireRegex, dynamicImportRegex]) {
    for (const match of content.matchAll(regex)) {
      const target = match[1];
      if (target) {
        results.push(target);
      }
    }
  }

  return results;
}

async function buildImportGraph(
  config: RepoConfig,
  files: string[],
  scopeRules: ScopeRule[],
): Promise<Map<string, Set<string>>> {
  const knownFiles = new Set(
    files.map((filePath) => normalizePath(path.resolve(config.path, filePath))),
  );
  const reverseGraph = new Map<string, Set<string>>();

  for (const relativeFile of files) {
    const scope = resolveFileScope(relativeFile, scopeRules);
    if (scope.ignored || !scope.metrics.includes("imports")) {
      continue;
    }

    if (!SOURCE_EXTENSIONS.some((ext) => relativeFile.endsWith(ext))) {
      continue;
    }

    const absoluteFile = path.resolve(config.path, relativeFile);
    const content = await readFile(absoluteFile, "utf8");
    const imports = extractImportTargets(content);

    for (const target of imports) {
      const resolved = resolveImportTarget(relativeFile, target);
      if (!resolved) {
        continue;
      }

      const normalizedResolved = normalizePath(
        path.resolve(config.path, resolved),
      );
      const candidates = [
        normalizedResolved,
        ...SOURCE_EXTENSIONS.map((ext) => `${normalizedResolved}${ext}`),
        ...SOURCE_EXTENSIONS.map((ext) => `${normalizedResolved}/index${ext}`),
      ];
      const existingTarget = candidates.find((candidate) =>
        knownFiles.has(candidate),
      );
      if (!existingTarget) {
        continue;
      }

      const relativeResolved = normalizePath(
        path.relative(config.path, existingTarget),
      );
      const targetScope = resolveFileScope(relativeResolved, scopeRules);
      if (targetScope.ignored || !targetScope.metrics.includes("imports")) {
        continue;
      }

      const importers = reverseGraph.get(relativeResolved) ?? new Set<string>();
      importers.add(relativeFile);
      reverseGraph.set(relativeResolved, importers);
    }
  }

  return reverseGraph;
}

async function buildStaleEntry(
  config: RepoConfig,
  scopeRules: ScopeRule[],
  importGraph: Map<string, Set<string>>,
  nonStaleSet: Set<string>,
  relativeFile: string,
  lastTouched: string,
  now: Date,
): Promise<StaleFileEntry | null> {
  const scope = resolveFileScope(relativeFile, scopeRules);
  if (scope.ignored || !scope.metrics.includes("staleness")) {
    return null;
  }

  const daysSinceLastCommit = daysBetween(lastTouched, now);
  if (daysSinceLastCommit < config.thresholds.staleDays) {
    nonStaleSet.add(relativeFile);
    return null;
  }

  const skipImports = !scope.metrics.includes("imports");
  const staleEntry: StaleFileEntry = {
    path: relativeFile,
    lastCommitDate: lastTouched,
    daysSinceLastCommit,
    isImported: false,
    importedBy: [],
  };

  if (scope.metrics.includes("size")) {
    const fileStats = await stat(path.resolve(config.path, relativeFile));
    staleEntry.fileSizeBytes = fileStats.size;
  }

  if (skipImports) {
    staleEntry.importCheckSkipped = true;
    return staleEntry;
  }

  const importers = [...(importGraph.get(relativeFile) ?? new Set<string>())];
  const nonStaleImporters = importers.filter((importer) =>
    nonStaleSet.has(importer),
  );
  staleEntry.isImported = nonStaleImporters.length > 0;
  staleEntry.importedBy = nonStaleImporters.sort();

  return staleEntry;
}

export async function collectStaleness(
  config: RepoConfig,
  scopeRules: ScopeRule[],
): Promise<StalenessSnapshot> {
  const [branch, logOutput] = await Promise.all([
    runCommand("git", ["rev-parse", "--abbrev-ref", "HEAD"], config.path),
    runCommand("git", ["log", "--name-only", "--format=%aI"], config.path),
  ]);

  const files = await collectFiles(
    config.path,
    config.sourceRoots,
    config.ignorePatterns,
  );
  const lastTouchedMap = parseGitLastTouchedMap(logOutput);
  const importGraph = await buildImportGraph(config, files, scopeRules);

  const now = new Date();
  const staleFiles: StaleFileEntry[] = [];
  const nonStaleSet = new Set<string>();

  for (const relativeFile of files) {
    const lastTouched = lastTouchedMap.get(relativeFile);
    if (!lastTouched) {
      continue;
    }

    const staleEntry = await buildStaleEntry(
      config,
      scopeRules,
      importGraph,
      nonStaleSet,
      relativeFile,
      lastTouched,
      now,
    );
    if (staleEntry) {
      staleFiles.push(staleEntry);
    }
  }

  const staleByDirectory = new Map<string, StaleFileEntry[]>();
  for (const entry of staleFiles) {
    const directory = normalizePath(path.dirname(entry.path));
    const list = staleByDirectory.get(directory) ?? [];
    list.push(entry);
    staleByDirectory.set(directory, list);
  }

  const staleDirectories: StaleDirEntry[] = [...staleByDirectory.entries()].map(
    ([dir, entries]) => {
      const sortedByAge = [...entries].sort(
        (left, right) => right.daysSinceLastCommit - left.daysSinceLastCommit,
      );
      const sortedByDate = [...entries].sort((left, right) =>
        left.lastCommitDate.localeCompare(right.lastCommitDate),
      );

      const oldest = sortedByAge[0];
      const newest = sortedByDate[sortedByDate.length - 1];

      return {
        path: dir,
        oldestFile: oldest?.path ?? "",
        newestCommitDate: newest?.lastCommitDate ?? "",
        daysSinceActivity: newest ? newest.daysSinceLastCommit : 0,
      };
    },
  );

  staleFiles.sort(
    (left, right) => right.daysSinceLastCommit - left.daysSinceLastCommit,
  );
  staleDirectories.sort(
    (left, right) => right.daysSinceActivity - left.daysSinceActivity,
  );

  return {
    collectedAt: new Date().toISOString(),
    branch: branch.trim(),
    staleFiles,
    staleDirectories,
  };
}
