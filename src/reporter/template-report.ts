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

function renderList(items: string[]): string {
  if (items.length === 0) {
    return "- none";
  }
  return items.map((item) => `- ${item}`).join("\n");
}

function buildStalenessLines(staleness: StalenessSnapshot): {
  imported: string[];
  notImported: string[];
  scopedNoImportCheck: string[];
} {
  const staleImported = staleness.staleFiles.filter(
    (entry) => !entry.importCheckSkipped && entry.isImported,
  );
  const staleNotImported = staleness.staleFiles.filter(
    (entry) => !entry.importCheckSkipped && !entry.isImported,
  );
  const staleNoImportCheck = staleness.staleFiles.filter(
    (entry) => entry.importCheckSkipped,
  );

  return {
    imported: staleImported
      .slice(0, 20)
      .map(
        (entry) =>
          `${entry.path}: last touched ${entry.daysSinceLastCommit} days ago, imported by ${entry.importedBy.length} files`,
      ),
    notImported: staleNotImported
      .slice(0, 20)
      .map(
        (entry) =>
          `${entry.path}: last touched ${entry.daysSinceLastCommit} days ago, no importers found`,
      ),
    scopedNoImportCheck: staleNoImportCheck.slice(0, 20).map((entry) => {
      const sizeSuffix =
        typeof entry.fileSizeBytes === "number"
          ? `, size ${(entry.fileSizeBytes / 1024).toFixed(1)} KiB`
          : "";
      return `${entry.path}: last touched ${entry.daysSinceLastCommit} days ago${sizeSuffix}, import check skipped by scope`;
    }),
  };
}

function buildSupplementalLines(
  complexity: ComplexitySnapshot | null,
  imports: ImportsSnapshot | null,
  runtime: RuntimeSnapshot | null,
): {
  complexity: string[];
  deepImports: string[];
  undeclaredDeps: string[];
  circularChains: string[];
  runtimeRoutes: string[];
  runtimeCoverage: string[];
} {
  return {
    complexity: toComplexityLines(complexity),
    deepImports: toDeepImportLines(imports),
    undeclaredDeps: toUndeclaredDependencyLines(imports),
    circularChains: toCircularChainLines(imports),
    runtimeRoutes: toRuntimeRouteLines(runtime),
    runtimeCoverage: toRuntimeCoverageLines(runtime),
  };
}

function toComplexityLines(complexity: ComplexitySnapshot | null): string[] {
  return (complexity?.findings ?? [])
    .slice(0, 15)
    .map(
      (entry) =>
        `${entry.path}:${entry.line} [${entry.ruleId}] ${entry.message}`,
    );
}

function toDeepImportLines(imports: ImportsSnapshot | null): string[] {
  return (imports?.deepImportFindings ?? [])
    .slice(0, 15)
    .map((entry) => `${entry.importer}: ${entry.target}`);
}

function toUndeclaredDependencyLines(
  imports: ImportsSnapshot | null,
): string[] {
  return (imports?.undeclaredDependencyFindings ?? [])
    .slice(0, 15)
    .map((entry) => `${entry.importer}: missing ${entry.dependency}`);
}

function toCircularChainLines(imports: ImportsSnapshot | null): string[] {
  return (imports?.circularChains ?? [])
    .slice(0, 10)
    .map((entry) => entry.join(" -> "));
}

function toRuntimeRouteLines(runtime: RuntimeSnapshot | null): string[] {
  return (runtime?.routeHits ?? [])
    .slice(0, 15)
    .map((entry) => `${entry.method} ${entry.route}: ${entry.count}`);
}

function toRuntimeCoverageLines(runtime: RuntimeSnapshot | null): string[] {
  return (runtime?.coverage ?? [])
    .slice(0, 15)
    .map(
      (entry) =>
        `${entry.path}: ${entry.coveredFunctions}/${entry.totalFunctions} functions covered`,
    );
}

function toCorrelatedChurnLines(gitStats: GitStatsSnapshot): string[] {
  return gitStats.windows["7d"].correlatedChurnGroups
    .slice(0, 10)
    .map(
      (group) =>
        `${group.files.join(", ")}: ${(group.coCommitRate * 100).toFixed(0)}% co-commit rate across ${group.totalCommits} commits`,
    );
}

function toCoverageLines(
  coverage: CoverageSnapshot | null,
  config: RepoConfig,
): {
  lowCoverage: string[];
  highChurnUncovered: string[];
  regressions: string[];
} {
  const files = coverage?.files ?? [];
  const lowPct = config.thresholds.lowCoveragePct;
  const regressionPct = config.thresholds.coverageRegressionPct;
  return {
    lowCoverage: files
      .filter((entry) => !entry.isHighChurn && entry.lineCoverage < lowPct)
      .slice(0, 15)
      .map((entry) => `${entry.path}: ${entry.lineCoverage}% line coverage`),
    highChurnUncovered: files
      .filter((entry) => entry.isHighChurn && entry.lineCoverage < lowPct)
      .slice(0, 15)
      .map(
        (entry) =>
          `${entry.path}: ${entry.lineCoverage}% coverage, ${entry.churnEdits ?? 0} edits in 7d`,
      ),
    regressions: files
      .filter((entry) => (entry.lineCoverageDelta ?? 0) <= -regressionPct)
      .slice(0, 15)
      .map(
        (entry) =>
          `${entry.path}: ${(entry.lineCoverageDelta ?? 0).toFixed(2)} point drop`,
      ),
  };
}

function toDocStalenessLines(docStaleness: DocStalenessSnapshot | null): {
  staleDocs: string[];
  orphanedRefs: string[];
  undocumentedApis: string[];
} {
  return {
    staleDocs: (docStaleness?.staleDocFiles ?? [])
      .slice(0, 15)
      .map(
        (entry) =>
          `${entry.docPath}: ${entry.daysSinceDocUpdate}d old, ${entry.codeChangesSince} code changes since update`,
      ),
    orphanedRefs: (docStaleness?.orphanedRefs ?? [])
      .slice(0, 15)
      .map((entry) => `${entry.docPath}:${entry.line} -> ${entry.reference}`),
    undocumentedApis: (docStaleness?.undocumentedApis ?? [])
      .slice(0, 15)
      .map((entry) => `${entry.path}: ${entry.exportType} ${entry.exportName}`),
  };
}

function renderGrowthAndChurnSection(
  config: RepoConfig,
  growthFileLines: string[],
  growthDirectoryLines: string[],
  churnLines: string[],
  correlatedChurnLines: string[],
): string {
  return `## Growth (M1)

### [WD-M1-001] Flagged files (growing > ${config.thresholds.growthMultiplier}x repo average)
${renderList(growthFileLines)}

### [WD-M1-002] Flagged directories (> ${config.thresholds.directoryGrowthPct}% growth)
${renderList(growthDirectoryLines)}

## Churn (M3)

### [WD-M3-001] High-churn files (> ${config.thresholds.highChurnEdits} edits in 7d)
${renderList(churnLines)}

### Correlated churn groups (informational)
${renderList(correlatedChurnLines)}
`;
}

function renderCoverageAndDocsSection(
  config: RepoConfig,
  coverageLines: ReturnType<typeof toCoverageLines>,
  docStalenessLines: ReturnType<typeof toDocStalenessLines>,
): string {
  return `## Coverage gaps (M7)

### [WD-M7-001] Low file coverage (< ${config.thresholds.lowCoveragePct}%)
${renderList(coverageLines.lowCoverage)}

### [WD-M7-002] Uncovered high-churn files
${renderList(coverageLines.highChurnUncovered)}

### [WD-M7-003] Coverage regressions
${renderList(coverageLines.regressions)}

## Documentation staleness (M8)

### [WD-M8-001] Stale docs with code churn
${renderList(docStalenessLines.staleDocs)}

### [WD-M8-002] Orphaned references
${renderList(docStalenessLines.orphanedRefs)}

### [WD-M8-003] Undocumented public APIs
${renderList(docStalenessLines.undocumentedApis)}
`;
}

function renderStalenessDebtImportRuntimeSection(
  debtMarkers: DebtMarkersSnapshot,
  stalenessLines: ReturnType<typeof buildStalenessLines>,
  topDebtFiles: string[],
  supplementalLines: ReturnType<typeof buildSupplementalLines>,
): string {
  return `## Staleness (M2)

### [WD-M2-001] Stale + imported (possibly underutilized)
${renderList(stalenessLines.imported)}

### [WD-M2-002] Stale + not imported (possibly dead)
${renderList(stalenessLines.notImported)}

### [WD-M2-003] Stale + scoped no-import-check
${renderList(stalenessLines.scopedNoImportCheck)}

## Maintenance debt (M6)

### [WD-M6-001|WD-M6-002|WD-M6-003] Totals
- TODOs: ${debtMarkers.summary.totalTodos} | FIXMEs: ${debtMarkers.summary.totalFixmes} | HACKs: ${debtMarkers.summary.totalHacks} | eslint-disable: ${debtMarkers.summary.totalEslintDisables} | any: ${debtMarkers.summary.totalAnyCasts}

### Files with most markers
${renderList(topDebtFiles)}

## Complexity (M4)

### [WD-M4-001|WD-M4-002|WD-M4-003] Findings
${renderList(supplementalLines.complexity)}

## Imports (M5)

### [WD-M5-001] Deep imports
${renderList(supplementalLines.deepImports)}

### [WD-M5-002] Undeclared dependencies
${renderList(supplementalLines.undeclaredDeps)}

### [WD-M5-003] Circular chains
${renderList(supplementalLines.circularChains)}

## Runtime (M9)

### [WD-M9-001|WD-M9-002] API route hits
${renderList(supplementalLines.runtimeRoutes)}

### [WD-M9-003] Coverage summary
${renderList(supplementalLines.runtimeCoverage)}
`;
}

export function renderTemplateReport(
  config: RepoConfig,
  gitStats: GitStatsSnapshot,
  staleness: StalenessSnapshot,
  debtMarkers: DebtMarkersSnapshot,
  complexity: ComplexitySnapshot | null,
  imports: ImportsSnapshot | null,
  runtime: RuntimeSnapshot | null,
  coverage: CoverageSnapshot | null,
  docStaleness: DocStalenessSnapshot | null,
): string {
  const window7d = gitStats.windows["7d"];
  const stalenessLines = buildStalenessLines(staleness);
  const supplementalLines = buildSupplementalLines(
    complexity,
    imports,
    runtime,
  );
  const correlatedChurnLines = toCorrelatedChurnLines(gitStats);
  const coverageLines = toCoverageLines(coverage, config);
  const docStalenessLines = toDocStalenessLines(docStaleness);

  const growthFileLines = window7d.files
    .slice(0, 15)
    .map(
      (entry) =>
        `${entry.path}: +${entry.linesAdded} lines (${entry.growthRatio}x average) [7d window]`,
    );
  const growthDirectoryLines = window7d.directories
    .slice(0, 15)
    .map(
      (entry) =>
        `${entry.path}: +${entry.totalLinesAdded} lines (${entry.growthPct}% growth, ${entry.newFiles} new files) [7d window]`,
    );
  const churnLines = window7d.highChurnFiles
    .slice(0, 15)
    .map(
      (entry) =>
        `${entry.path}: ${entry.editCount} edits, ${entry.addDeleteRatio} add/delete ratio`,
    );

  const topDebtFiles = debtMarkers.files.slice(0, 15).map((entry) => {
    const markerCount =
      entry.todos.length +
      entry.fixmes.length +
      entry.hacks.length +
      entry.eslintDisables.length +
      entry.anyCasts;
    return `${entry.path}: ${markerCount} markers (${entry.todos.length} TODO, ${entry.eslintDisables.length} eslint-disable)`;
  });

  return `# Warden Report -- ${new Date().toISOString()}
# Repo: ${config.slug} | Branch: ${gitStats.branch}

${renderGrowthAndChurnSection(
  config,
  growthFileLines,
  growthDirectoryLines,
  churnLines,
  correlatedChurnLines,
)}

${renderStalenessDebtImportRuntimeSection(
  debtMarkers,
  stalenessLines,
  topDebtFiles,
  supplementalLines,
)}

${renderCoverageAndDocsSection(config, coverageLines, docStalenessLines)}

---
Collected at ${gitStats.collectedAt} | Thresholds: stale=${config.thresholds.staleDays}d, doc-stale=${config.thresholds.docStaleDays}d, churn=${config.thresholds.highChurnEdits}, growth=${config.thresholds.growthMultiplier}x, coverage=${config.thresholds.lowCoveragePct}%`;
}
