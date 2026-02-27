import type {
  CoverageSnapshot,
  ComplexitySnapshot,
  DebtMarkersSnapshot,
  DocStalenessSnapshot,
  GitStatsSnapshot,
  ImportsSnapshot,
  RepoConfig,
  RuntimeSnapshot,
  StalenessSnapshot,
} from "../types/snapshot.js";
import { loadScopeRules } from "../config/scope.js";
import { collectCoverage } from "./collect-coverage.js";
import { collectComplexity } from "./collect-complexity.js";
import { collectDebtMarkers } from "./collect-debt-markers.js";
import { collectDocStaleness } from "./collect-doc-staleness.js";
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
  coverage: CoverageSnapshot;
  docStaleness: DocStalenessSnapshot;
}

export async function runCollectors(
  config: RepoConfig,
): Promise<CollectorResults> {
  const scopeRules = await loadScopeRules(config);
  const gitStats = await collectGitStats(config, scopeRules);
  const [
    staleness,
    debtMarkers,
    complexity,
    imports,
    runtime,
    coverage,
    docStaleness,
  ] = await Promise.all([
    collectStaleness(config, scopeRules),
    collectDebtMarkers(config, scopeRules),
    collectComplexity(config, scopeRules),
    collectImports(config, scopeRules),
    collectRuntime(config, scopeRules),
    collectCoverage(config, scopeRules, gitStats),
    collectDocStaleness(config, scopeRules),
  ]);

  return {
    gitStats,
    staleness,
    debtMarkers,
    complexity,
    imports,
    runtime,
    coverage,
    docStaleness,
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
