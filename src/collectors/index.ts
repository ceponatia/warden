import type {
  ComplexitySnapshot,
  DebtMarkersSnapshot,
  GitStatsSnapshot,
  ImportsSnapshot,
  RepoConfig,
  RuntimeSnapshot,
  StalenessSnapshot,
} from "../types/snapshot.js";
import { loadScopeRules } from "../config/scope.js";
import { collectComplexity } from "./collect-complexity.js";
import { collectDebtMarkers } from "./collect-debt-markers.js";
import { collectGitStats } from "./collect-git-stats.js";
import { collectImports } from "./collect-imports.js";
import { collectRuntime } from "./collect-runtime.js";
import { collectStaleness } from "./collect-staleness.js";

export interface CollectorResults {
  gitStats: GitStatsSnapshot;
  staleness: StalenessSnapshot;
  debtMarkers: DebtMarkersSnapshot;
  complexity: ComplexitySnapshot;
  imports: ImportsSnapshot;
  runtime: RuntimeSnapshot;
}

export async function runCollectors(
  config: RepoConfig,
): Promise<CollectorResults> {
  const scopeRules = await loadScopeRules(config);
  const [gitStats, staleness, debtMarkers, complexity, imports, runtime] =
    await Promise.all([
      collectGitStats(config, scopeRules),
      collectStaleness(config, scopeRules),
      collectDebtMarkers(config, scopeRules),
      collectComplexity(config, scopeRules),
      collectImports(config, scopeRules),
      collectRuntime(config, scopeRules),
    ]);

  return {
    gitStats,
    staleness,
    debtMarkers,
    complexity,
    imports,
    runtime,
  };
}

export async function runBatch1Collectors(
  config: RepoConfig,
): Promise<Pick<CollectorResults, "gitStats" | "staleness" | "debtMarkers">> {
  const all = await runCollectors(config);

  return {
    gitStats: all.gitStats,
    staleness: all.staleness,
    debtMarkers: all.debtMarkers,
  };
}
