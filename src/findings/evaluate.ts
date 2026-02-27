import {
  isFindingSuppressed,
  type AllowlistRule,
} from "../config/allowlist.js";
import type { FindingInstance } from "../types/findings.js";
import type { RepoConfig, SnapshotBundle } from "../types/snapshot.js";

function addFinding(
  findings: FindingInstance[],
  config: RepoConfig,
  allowlistRules: AllowlistRule[],
  finding: FindingInstance,
): void {
  if (
    isFindingSuppressed(
      config,
      allowlistRules,
      finding.code,
      finding.path,
      finding.symbol,
    )
  ) {
    return;
  }

  findings.push(finding);
}

function appendGrowthAndChurn(
  findings: FindingInstance[],
  config: RepoConfig,
  bundle: SnapshotBundle,
  allowlistRules: AllowlistRule[],
): void {
  const w7 = bundle.gitStats.windows["7d"];

  for (const file of w7.files) {
    addFinding(findings, config, allowlistRules, {
      code: "WD-M1-001",
      metric: "M1",
      summary: `File growth exceeds threshold (${file.growthRatio}x avg): ${file.path}`,
      path: file.path,
    });

    if (file.linesAdded >= config.thresholds.largeFileGrowthLines) {
      addFinding(findings, config, allowlistRules, {
        code: "WD-M6-004",
        metric: "M6",
        summary: `Large file still growing (+${file.linesAdded} lines): ${file.path}`,
        path: file.path,
      });
    }
  }

  for (const directory of w7.directories) {
    addFinding(findings, config, allowlistRules, {
      code: "WD-M1-002",
      metric: "M1",
      summary: `Directory growth exceeds threshold (${directory.growthPct}%): ${directory.path}`,
      path: directory.path,
    });

    if (directory.newFiles >= config.thresholds.newFileClusterCount) {
      addFinding(findings, config, allowlistRules, {
        code: "WD-M1-003",
        metric: "M1",
        summary: `New file cluster (${directory.newFiles} files): ${directory.path}`,
        path: directory.path,
      });
    }
  }

  for (const churn of w7.highChurnFiles) {
    addFinding(findings, config, allowlistRules, {
      code: "WD-M3-001",
      metric: "M3",
      summary: `High churn (${churn.editCount} edits): ${churn.path}`,
      path: churn.path,
    });

    if (churn.addDeleteRatio >= config.thresholds.highRewriteRatio) {
      addFinding(findings, config, allowlistRules, {
        code: "WD-M3-002",
        metric: "M3",
        summary: `High rewrite ratio (${churn.addDeleteRatio}): ${churn.path}`,
        path: churn.path,
      });
    }
  }
}

function appendStaleness(
  findings: FindingInstance[],
  config: RepoConfig,
  bundle: SnapshotBundle,
  allowlistRules: AllowlistRule[],
): void {
  for (const stale of bundle.staleness.staleFiles) {
    if (stale.importCheckSkipped) {
      continue;
    }

    addFinding(findings, config, allowlistRules, {
      code: stale.isImported ? "WD-M2-001" : "WD-M2-002",
      metric: "M2",
      summary: stale.isImported
        ? `Stale imported file (${stale.daysSinceLastCommit}d): ${stale.path}`
        : `Stale unimported file (${stale.daysSinceLastCommit}d): ${stale.path}`,
      path: stale.path,
    });
  }

  for (const staleDir of bundle.staleness.staleDirectories) {
    addFinding(findings, config, allowlistRules, {
      code: "WD-M2-003",
      metric: "M2",
      summary: `Stale directory (${staleDir.daysSinceActivity}d): ${staleDir.path}`,
      path: staleDir.path,
    });
  }
}

function appendDebt(
  findings: FindingInstance[],
  config: RepoConfig,
  bundle: SnapshotBundle,
  allowlistRules: AllowlistRule[],
): void {
  for (const debt of bundle.debtMarkers.files) {
    const todoFixmeCount = debt.todos.length + debt.fixmes.length;

    if (todoFixmeCount > 0) {
      addFinding(findings, config, allowlistRules, {
        code: "WD-M6-001",
        metric: "M6",
        summary: `TODO/FIXME markers (${todoFixmeCount}): ${debt.path}`,
        path: debt.path,
      });
    }

    if (debt.anyCasts > 0) {
      addFinding(findings, config, allowlistRules, {
        code: "WD-M6-002",
        metric: "M6",
        summary: `any usage (${debt.anyCasts}): ${debt.path}`,
        path: debt.path,
      });
    }

    if (debt.eslintDisables.length > 0) {
      addFinding(findings, config, allowlistRules, {
        code: "WD-M6-003",
        metric: "M6",
        summary: `eslint-disable markers (${debt.eslintDisables.length}): ${debt.path}`,
        path: debt.path,
      });
    }
  }
}

function appendComplexity(
  findings: FindingInstance[],
  config: RepoConfig,
  bundle: SnapshotBundle,
  allowlistRules: AllowlistRule[],
): void {
  if (!bundle.complexity) {
    return;
  }

  const perFileCounts = new Map<string, number>();

  for (const complexityFinding of bundle.complexity.findings) {
    const code =
      complexityFinding.ruleId === "complexity" ? "WD-M4-001" : "WD-M4-002";

    addFinding(findings, config, allowlistRules, {
      code,
      metric: "M4",
      summary: `${complexityFinding.ruleId} at ${complexityFinding.path}:${complexityFinding.line}`,
      path: complexityFinding.path,
    });

    perFileCounts.set(
      complexityFinding.path,
      (perFileCounts.get(complexityFinding.path) ?? 0) + 1,
    );
  }

  for (const [filePath, count] of perFileCounts.entries()) {
    if (count >= config.thresholds.complexityHotspotCount) {
      addFinding(findings, config, allowlistRules, {
        code: "WD-M4-003",
        metric: "M4",
        summary: `Systemic complexity (${count} findings): ${filePath}`,
        path: filePath,
      });
    }
  }
}

function appendImports(
  findings: FindingInstance[],
  config: RepoConfig,
  bundle: SnapshotBundle,
  allowlistRules: AllowlistRule[],
): void {
  if (!bundle.imports) {
    return;
  }

  for (const deepImport of bundle.imports.deepImportFindings) {
    addFinding(findings, config, allowlistRules, {
      code: "WD-M5-001",
      metric: "M5",
      summary: `Deep import ${deepImport.target} in ${deepImport.importer}`,
      path: deepImport.importer,
    });
  }

  for (const dep of bundle.imports.undeclaredDependencyFindings) {
    addFinding(findings, config, allowlistRules, {
      code: "WD-M5-002",
      metric: "M5",
      summary: `Undeclared dependency ${dep.dependency} in ${dep.importer}`,
      path: dep.importer,
    });
  }

  for (const chain of bundle.imports.circularChains) {
    const first = chain[0] ?? "unknown";
    addFinding(findings, config, allowlistRules, {
      code: "WD-M5-003",
      metric: "M5",
      summary: `Circular chain: ${chain.join(" -> ")}`,
      path: first,
    });
  }
}

function appendRuntime(
  findings: FindingInstance[],
  config: RepoConfig,
  bundle: SnapshotBundle,
  allowlistRules: AllowlistRule[],
): void {
  if (!bundle.runtime) {
    return;
  }

  if (bundle.runtime.summary.uniqueRoutes === 0) {
    addFinding(findings, config, allowlistRules, {
      code: "WD-M9-001",
      metric: "M9",
      summary: "No API route hits captured for this snapshot",
      path: "runtime:routes",
    });
  }

  for (const route of bundle.runtime.routeHits) {
    if (route.count <= config.thresholds.lowRouteHitCount) {
      addFinding(findings, config, allowlistRules, {
        code: "WD-M9-002",
        metric: "M9",
        summary: `Low route hit count (${route.count}) for ${route.method} ${route.route}`,
        path: `route:${route.method} ${route.route}`,
      });
    }
  }

  for (const coverage of bundle.runtime.coverage) {
    if (coverage.coveredFunctions === 0) {
      addFinding(findings, config, allowlistRules, {
        code: "WD-M9-003",
        metric: "M9",
        summary: `Module never loaded at runtime: ${coverage.path}`,
        path: coverage.path,
      });
    }
  }
}

function appendCoverage(
  findings: FindingInstance[],
  config: RepoConfig,
  bundle: SnapshotBundle,
  allowlistRules: AllowlistRule[],
): void {
  if (!bundle.coverage) {
    return;
  }

  for (const coverage of bundle.coverage.files) {
    if (coverage.lineCoverage < config.thresholds.lowCoveragePct) {
      addFinding(findings, config, allowlistRules, {
        code: "WD-M7-001",
        metric: "M7",
        summary: `Low file coverage (${coverage.lineCoverage}%): ${coverage.path}`,
        path: coverage.path,
      });
    }

    if (coverage.isHighChurn && coverage.lineCoverage < config.thresholds.lowCoveragePct) {
      addFinding(findings, config, allowlistRules, {
        code: "WD-M7-002",
        metric: "M7",
        summary: `High-churn file undercovered (${coverage.churnEdits ?? 0} edits, ${coverage.lineCoverage}%): ${coverage.path}`,
        path: coverage.path,
      });
    }

    if ((coverage.lineCoverageDelta ?? 0) <= -config.thresholds.coverageRegressionPct) {
      addFinding(findings, config, allowlistRules, {
        code: "WD-M7-003",
        metric: "M7",
        summary: `Coverage regression (${coverage.lineCoverageDelta}%): ${coverage.path}`,
        path: coverage.path,
      });
    }
  }
}

function appendDocStaleness(
  findings: FindingInstance[],
  config: RepoConfig,
  bundle: SnapshotBundle,
  allowlistRules: AllowlistRule[],
): void {
  if (!bundle.docStaleness) {
    return;
  }

  for (const entry of bundle.docStaleness.staleDocFiles) {
    addFinding(findings, config, allowlistRules, {
      code: "WD-M8-001",
      metric: "M8",
      summary: `Stale documentation (${entry.daysSinceDocUpdate}d, ${entry.codeChangesSince} code changes): ${entry.docPath}`,
      path: entry.docPath,
    });
  }

  for (const entry of bundle.docStaleness.orphanedRefs) {
    addFinding(findings, config, allowlistRules, {
      code: "WD-M8-002",
      metric: "M8",
      summary: `Orphaned ${entry.referenceType} reference at ${entry.docPath}:${entry.line}: ${entry.reference}`,
      path: entry.docPath,
    });
  }

  for (const entry of bundle.docStaleness.undocumentedApis) {
    addFinding(findings, config, allowlistRules, {
      code: "WD-M8-003",
      metric: "M8",
      summary: `Undocumented public ${entry.exportType}: ${entry.exportName} (${entry.path})`,
      path: entry.path,
      symbol: entry.exportName,
    });
  }
}

export function evaluateFindings(
  config: RepoConfig,
  bundle: SnapshotBundle,
  allowlistRules: AllowlistRule[],
): FindingInstance[] {
  const findings: FindingInstance[] = [];

  appendGrowthAndChurn(findings, config, bundle, allowlistRules);
  appendStaleness(findings, config, bundle, allowlistRules);
  appendDebt(findings, config, bundle, allowlistRules);
  appendComplexity(findings, config, bundle, allowlistRules);
  appendImports(findings, config, bundle, allowlistRules);
  appendRuntime(findings, config, bundle, allowlistRules);
  appendCoverage(findings, config, bundle, allowlistRules);
  appendDocStaleness(findings, config, bundle, allowlistRules);

  return findings;
}

export function summarizeFindingsByCode(findings: FindingInstance[]): string[] {
  const counts = new Map<string, number>();

  for (const finding of findings) {
    counts.set(finding.code, (counts.get(finding.code) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([code, count]) => `${code}: ${count}`);
}
