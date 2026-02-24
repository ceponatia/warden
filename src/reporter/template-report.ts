import type {
  ComplexitySnapshot,
  DebtMarkersSnapshot,
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

export function renderTemplateReport(
  config: RepoConfig,
  gitStats: GitStatsSnapshot,
  staleness: StalenessSnapshot,
  debtMarkers: DebtMarkersSnapshot,
  complexity: ComplexitySnapshot | null,
  imports: ImportsSnapshot | null,
  runtime: RuntimeSnapshot | null,
): string {
  const window7d = gitStats.windows["7d"];
  const stalenessLines = buildStalenessLines(staleness);
  const supplementalLines = buildSupplementalLines(
    complexity,
    imports,
    runtime,
  );

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

## Growth (M1)

### Flagged files (growing > ${config.thresholds.growthMultiplier}x repo average)
${renderList(growthFileLines)}

### Flagged directories (> ${config.thresholds.directoryGrowthPct}% growth)
${renderList(growthDirectoryLines)}

## Churn (M3)

### High-churn files (> ${config.thresholds.highChurnEdits} edits in 7d)
${renderList(churnLines)}

## Staleness (M2)

### Stale + imported (possibly underutilized)
${renderList(stalenessLines.imported)}

### Stale + not imported (possibly dead)
${renderList(stalenessLines.notImported)}

### Stale + scoped no-import-check
${renderList(stalenessLines.scopedNoImportCheck)}

## Maintenance debt (M6)

### Totals
- TODOs: ${debtMarkers.summary.totalTodos} | FIXMEs: ${debtMarkers.summary.totalFixmes} | HACKs: ${debtMarkers.summary.totalHacks} | eslint-disable: ${debtMarkers.summary.totalEslintDisables} | any: ${debtMarkers.summary.totalAnyCasts}

### Files with most markers
${renderList(topDebtFiles)}

## Complexity (M4)

### Findings
${renderList(supplementalLines.complexity)}

## Imports (M5)

### Deep imports
${renderList(supplementalLines.deepImports)}

### Undeclared dependencies
${renderList(supplementalLines.undeclaredDeps)}

### Circular chains
${renderList(supplementalLines.circularChains)}

## Runtime (M9)

### API route hits
${renderList(supplementalLines.runtimeRoutes)}

### Coverage summary
${renderList(supplementalLines.runtimeCoverage)}

---
Collected at ${gitStats.collectedAt} | Thresholds: stale=${config.thresholds.staleDays}d, churn=${config.thresholds.highChurnEdits}, growth=${config.thresholds.growthMultiplier}x`;
}
