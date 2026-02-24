import path from "node:path";
import { readFile } from "node:fs/promises";

import { resolveFileScope } from "../config/scope.js";
import type {
  ImportsSnapshot,
  RepoConfig,
  ScopeRule,
} from "../types/snapshot.js";
import { collectFiles, normalizePath, runCommand } from "./utils.js";

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
const NODE_BUILTINS = new Set([
  "fs",
  "path",
  "os",
  "http",
  "https",
  "url",
  "util",
  "stream",
  "crypto",
  "zlib",
  "events",
  "timers",
  "tty",
  "child_process",
  "node:fs",
  "node:path",
  "node:os",
  "node:http",
  "node:https",
  "node:url",
  "node:util",
  "node:stream",
  "node:crypto",
  "node:zlib",
  "node:events",
  "node:timers",
  "node:tty",
  "node:child_process",
]);

function extractImports(content: string): string[] {
  const values: string[] = [];
  const patterns = [
    /import\s+(?:[^"']+\s+from\s+)?["']([^"']+)["']/g,
    /require\(\s*["']([^"']+)["']\s*\)/g,
    /import\(\s*["']([^"']+)["']\s*\)/g,
  ];

  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) {
      const target = match[1];
      if (target) {
        values.push(target);
      }
    }
  }

  return values;
}

function getPackageName(importPath: string): string {
  if (importPath.startsWith("@")) {
    const [scope, pkg] = importPath.split("/");
    return scope && pkg ? `${scope}/${pkg}` : importPath;
  }

  return importPath.split("/")[0] ?? importPath;
}

async function readDeclaredDependencies(
  packageJsonPath: string,
): Promise<Set<string>> {
  try {
    const raw = await readFile(packageJsonPath, "utf8");
    const parsed = JSON.parse(raw) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };

    return new Set([
      ...Object.keys(parsed.dependencies ?? {}),
      ...Object.keys(parsed.devDependencies ?? {}),
      ...Object.keys(parsed.peerDependencies ?? {}),
    ]);
  } catch {
    return new Set<string>();
  }
}

async function findNearestPackageJson(
  repoPath: string,
  relativeFile: string,
): Promise<string | null> {
  let current = path.dirname(path.resolve(repoPath, relativeFile));
  const root = path.resolve(repoPath);

  while (current.startsWith(root)) {
    const candidate = path.resolve(current, "package.json");
    try {
      await readFile(candidate, "utf8");
      return candidate;
    } catch {
      const parent = path.dirname(current);
      if (parent === current) {
        break;
      }
      current = parent;
    }
  }

  return null;
}

function detectCircularChains(graph: Map<string, Set<string>>): string[][] {
  const visited = new Set<string>();
  const stack = new Set<string>();
  const chains: string[][] = [];

  function visit(node: string, trail: string[]): void {
    if (stack.has(node)) {
      const index = trail.indexOf(node);
      if (index >= 0) {
        chains.push([...trail.slice(index), node]);
      }
      return;
    }

    if (visited.has(node)) {
      return;
    }

    visited.add(node);
    stack.add(node);
    const neighbors = graph.get(node) ?? new Set<string>();
    for (const neighbor of neighbors) {
      visit(neighbor, [...trail, neighbor]);
    }
    stack.delete(node);
  }

  for (const node of graph.keys()) {
    visit(node, [node]);
  }

  const unique = new Map<string, string[]>();
  for (const chain of chains) {
    const key = chain.join("->");
    unique.set(key, chain);
  }

  return [...unique.values()];
}

function isSupportedSourceFile(relativeFile: string): boolean {
  return SOURCE_EXTENSIONS.some((ext) => relativeFile.endsWith(ext));
}

function isAliasImport(target: string): boolean {
  return (
    target.startsWith("@/") ||
    target.startsWith("~/") ||
    target.startsWith("#/")
  );
}

function buildInternalImportCandidates(
  absoluteFile: string,
  target: string,
): string[] {
  const resolvedBase = normalizePath(
    path.resolve(path.dirname(absoluteFile), target),
  );
  return [
    resolvedBase,
    ...SOURCE_EXTENSIONS.map((ext) => `${resolvedBase}${ext}`),
    ...SOURCE_EXTENSIONS.map((ext) => `${resolvedBase}/index${ext}`),
  ];
}

function addInternalDependency(
  internalGraph: Map<string, Set<string>>,
  importer: string,
  targetRelative: string,
): void {
  const neighbors = internalGraph.get(importer) ?? new Set<string>();
  neighbors.add(targetRelative);
  internalGraph.set(importer, neighbors);
}

interface ImportCollectorState {
  internalGraph: Map<string, Set<string>>;
  deepImportFindings: { importer: string; target: string }[];
  undeclaredDependencyFindings: { importer: string; dependency: string }[];
  packageDepsCache: Map<string, Set<string>>;
  knownFiles: Set<string>;
}

async function handleExternalImport(
  config: RepoConfig,
  state: ImportCollectorState,
  relativeFile: string,
  target: string,
): Promise<void> {
  if (isAliasImport(target)) {
    return;
  }

  if (target.includes("/src/")) {
    state.deepImportFindings.push({ importer: relativeFile, target });
  }

  const packageName = getPackageName(target);
  if (NODE_BUILTINS.has(packageName)) {
    return;
  }

  const nearestPackageJson = await findNearestPackageJson(
    config.path,
    relativeFile,
  );
  if (!nearestPackageJson) {
    return;
  }

  const declaredDeps =
    state.packageDepsCache.get(nearestPackageJson) ??
    (await readDeclaredDependencies(nearestPackageJson));
  state.packageDepsCache.set(nearestPackageJson, declaredDeps);

  if (!declaredDeps.has(packageName)) {
    state.undeclaredDependencyFindings.push({
      importer: relativeFile,
      dependency: packageName,
    });
  }
}

async function processFileImports(
  config: RepoConfig,
  state: ImportCollectorState,
  relativeFile: string,
): Promise<void> {
  const absoluteFile = path.resolve(config.path, relativeFile);
  const content = await readFile(absoluteFile, "utf8");
  const imports = extractImports(content);

  for (const target of imports) {
    if (target.startsWith(".")) {
      const candidates = buildInternalImportCandidates(absoluteFile, target);
      const existing = candidates.find((candidate) =>
        state.knownFiles.has(candidate),
      );
      if (!existing) {
        continue;
      }

      const targetRelative = normalizePath(
        path.relative(config.path, existing),
      );
      addInternalDependency(state.internalGraph, relativeFile, targetRelative);
      continue;
    }

    await handleExternalImport(config, state, relativeFile, target);
  }
}

export async function collectImports(
  config: RepoConfig,
  scopeRules: ScopeRule[],
): Promise<ImportsSnapshot> {
  const branch = (
    await runCommand("git", ["rev-parse", "--abbrev-ref", "HEAD"], config.path)
  ).trim();

  const files = await collectFiles(
    config.path,
    config.sourceRoots,
    config.ignorePatterns,
  );
  const filesToScan = files.filter((filePath) => {
    const scope = resolveFileScope(filePath, scopeRules);
    return !scope.ignored && scope.metrics.includes("imports");
  });

  const state: ImportCollectorState = {
    internalGraph: new Map<string, Set<string>>(),
    deepImportFindings: [],
    undeclaredDependencyFindings: [],
    packageDepsCache: new Map<string, Set<string>>(),
    knownFiles: new Set(
      filesToScan.map((entry) =>
        normalizePath(path.resolve(config.path, entry)),
      ),
    ),
  };

  for (const relativeFile of filesToScan) {
    if (!isSupportedSourceFile(relativeFile)) {
      continue;
    }

    await processFileImports(config, state, relativeFile);
  }

  const circularChains = detectCircularChains(state.internalGraph);

  return {
    collectedAt: new Date().toISOString(),
    branch,
    summary: {
      filesScanned: filesToScan.length,
      deepImports: state.deepImportFindings.length,
      undeclaredDependencies: state.undeclaredDependencyFindings.length,
      circularChains: circularChains.length,
    },
    deepImportFindings: state.deepImportFindings,
    undeclaredDependencyFindings: state.undeclaredDependencyFindings,
    circularChains,
  };
}
