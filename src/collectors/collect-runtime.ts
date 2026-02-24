import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import type {
  RepoConfig,
  RuntimeSnapshot,
  ScopeRule,
} from "../types/snapshot.js";
import { runCommand } from "./utils.js";

interface ApiHitEvent {
  route: string;
  method: string;
  timestamp: string;
}

interface V8FunctionRange {
  count: number;
}

interface V8FunctionCoverage {
  ranges: V8FunctionRange[];
}

interface V8ScriptCoverage {
  url: string;
  functions: V8FunctionCoverage[];
}

interface V8CoverageFile {
  result?: V8ScriptCoverage[];
}

async function parseApiHits(repoPath: string): Promise<ApiHitEvent[]> {
  const apiHitsPath = path.resolve(
    repoPath,
    ".warden",
    "runtime",
    "api-hits.jsonl",
  );
  try {
    const content = await readFile(apiHitsPath, "utf8");
    return content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line) as ApiHitEvent;
        } catch {
          return null;
        }
      })
      .filter((item): item is ApiHitEvent => Boolean(item));
  } catch {
    return [];
  }
}

async function parseCoverage(
  repoPath: string,
): Promise<RuntimeSnapshot["coverage"]> {
  const coverageDir = path.resolve(
    repoPath,
    ".warden",
    "runtime",
    "v8-coverage",
  );
  try {
    const entries = await readdir(coverageDir, { withFileTypes: true });
    const files = entries.filter(
      (entry) => entry.isFile() && entry.name.endsWith(".json"),
    );
    const merged = new Map<
      string,
      { coveredFunctions: number; totalFunctions: number }
    >();

    for (const file of files) {
      const raw = await readFile(path.join(coverageDir, file.name), "utf8");
      const parsed = JSON.parse(raw) as V8CoverageFile;
      for (const script of parsed.result ?? []) {
        if (!script.url || !script.url.startsWith("file://")) {
          continue;
        }

        const urlPath = script.url.replace("file://", "");
        const relativePath = path
          .relative(repoPath, urlPath)
          .split(path.sep)
          .join("/");
        if (relativePath.startsWith("..")) {
          continue;
        }

        const totalFunctions = script.functions.length;
        const coveredFunctions = script.functions.filter((fn) =>
          fn.ranges.some((range) => range.count > 0),
        ).length;

        const current = merged.get(relativePath) ?? {
          coveredFunctions: 0,
          totalFunctions: 0,
        };
        current.coveredFunctions += coveredFunctions;
        current.totalFunctions += totalFunctions;
        merged.set(relativePath, current);
      }
    }

    return [...merged.entries()]
      .map(([pathKey, values]) => ({
        path: pathKey,
        coveredFunctions: values.coveredFunctions,
        totalFunctions: values.totalFunctions,
      }))
      .sort((left, right) => left.path.localeCompare(right.path));
  } catch {
    return [];
  }
}

export async function collectRuntime(
  config: RepoConfig,
  scopeRules: ScopeRule[],
): Promise<RuntimeSnapshot> {
  void scopeRules;

  const branch = (
    await runCommand("git", ["rev-parse", "--abbrev-ref", "HEAD"], config.path)
  ).trim();

  const [events, coverage] = await Promise.all([
    parseApiHits(config.path),
    parseCoverage(config.path),
  ]);

  const routeMap = new Map<
    string,
    { route: string; method: string; count: number }
  >();
  for (const event of events) {
    const key = `${event.method} ${event.route}`;
    const current = routeMap.get(key) ?? {
      route: event.route,
      method: event.method,
      count: 0,
    };
    current.count += 1;
    routeMap.set(key, current);
  }

  const routeHits = [...routeMap.values()].sort(
    (left, right) => right.count - left.count,
  );

  return {
    collectedAt: new Date().toISOString(),
    branch,
    summary: {
      apiHitEvents: events.length,
      uniqueRoutes: routeHits.length,
      coverageFiles: coverage.length,
    },
    routeHits,
    coverage,
  };
}
