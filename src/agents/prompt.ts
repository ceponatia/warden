import { listCodes } from "../findings/registry.js";
import type { FindingInstance } from "../types/findings.js";
import type { RepoConfig, SnapshotBundle } from "../types/snapshot.js";
import type { SnapshotDelta } from "./delta.js";

function describeDelta(delta: SnapshotDelta): string {
  function sign(n: number): string {
    return n > 0 ? `+${n}` : `${n}`;
  }

  const parts: string[] = [
    `stale files: ${sign(delta.staleFilesDelta)}`,
    `stale dirs: ${sign(delta.staleDirectoriesDelta)}`,
    `TODOs: ${sign(delta.totalTodosDelta)}`,
    `FIXMEs: ${sign(delta.totalFixmesDelta)}`,
    `eslint-disables: ${sign(delta.totalEslintDisablesDelta)}`,
    `any-casts: ${sign(delta.totalAnyCastsDelta)}`,
  ];
  if (delta.complexityFindingsDelta !== null) {
    parts.push(`complexity findings: ${sign(delta.complexityFindingsDelta)}`);
  }
  if (delta.deepImportsDelta !== null) {
    parts.push(`deep imports: ${sign(delta.deepImportsDelta)}`);
  }
  return parts.join(", ");
}

function buildCodeLegend(): string {
  return listCodes()
    .map((definition) => `${definition.code}: ${definition.shortDescription}`)
    .join("\n");
}

function appendActiveFindingLines(
  lines: string[],
  activeFindings?: FindingInstance[],
): void {
  if (!activeFindings || activeFindings.length === 0) {
    return;
  }

  lines.push(
    "",
    "## Active Finding Instances (code-prefixed)",
    ...activeFindings
      .slice(0, 200)
      .map((finding) => `- [${finding.code}] ${finding.summary}`),
  );
}

function appendComplexityLines(lines: string[], bundle: SnapshotBundle): void {
  const complexity = bundle.complexity;
  if (!complexity) {
    return;
  }

  lines.push(
    "",
    "## Complexity",
    `Total findings: ${complexity.summary.totalFindings}`,
    `Complexity warnings: ${complexity.summary.complexityWarnings}`,
    `Max-lines warnings: ${complexity.summary.maxLinesWarnings}`,
    `Top findings: ${
      complexity.findings
        .slice(0, 5)
        .map((f) => `${f.path}:${f.line} (${f.ruleId})`)
        .join(", ") || "none"
    }`,
  );
}

function appendImportAndRuntimeLines(
  lines: string[],
  bundle: SnapshotBundle,
): void {
  if (bundle.imports) {
    lines.push(
      "",
      "## Import Health",
      `Files scanned: ${bundle.imports.summary.filesScanned}`,
      `Deep imports: ${bundle.imports.summary.deepImports}`,
      `Undeclared dependencies: ${bundle.imports.summary.undeclaredDependencies}`,
      `Circular chains: ${bundle.imports.summary.circularChains}`,
    );
  }

  if (bundle.runtime) {
    lines.push(
      "",
      "## Runtime Coverage",
      `API hit events: ${bundle.runtime.summary.apiHitEvents}`,
      `Unique routes: ${bundle.runtime.summary.uniqueRoutes}`,
      `Coverage files: ${bundle.runtime.summary.coverageFiles}`,
    );
  }
}

function appendCoverageAndDocs(lines: string[], bundle: SnapshotBundle): void {
  if (bundle.coverage) {
    const topLowCoverage = bundle.coverage.files
      .filter((entry) => entry.lineCoverage < 50)
      .slice(0, 5)
      .map((entry) => `${entry.path} (${entry.lineCoverage}%)`)
      .join(", ");
    const highChurnUncovered = bundle.coverage.files
      .filter((entry) => entry.isHighChurn && entry.lineCoverage < 50)
      .slice(0, 5)
      .map(
        (entry) =>
          `${entry.path} (${entry.churnEdits ?? 0} edits, ${entry.lineCoverage}%)`,
      )
      .join(", ");

    lines.push(
      "",
      "## Coverage Gaps",
      `Coverage files: ${bundle.coverage.summary.totalFiles}`,
      `Average line coverage: ${bundle.coverage.summary.averageCoverage}%`,
      `Files below 50%: ${bundle.coverage.summary.filesBelow50}`,
      `Top low coverage: ${topLowCoverage || "none"}`,
      `High-churn uncovered intersections: ${highChurnUncovered || "none"}`,
    );
  }

  if (bundle.docStaleness) {
    const staleDocs = bundle.docStaleness.staleDocFiles
      .slice(0, 5)
      .map(
        (entry) =>
          `${entry.docPath} (${entry.codeChangesSince} code changes since doc update)`,
      )
      .join(", ");

    lines.push(
      "",
      "## Documentation Staleness",
      `Doc files scanned: ${bundle.docStaleness.summary.totalDocFiles}`,
      `Stale docs: ${bundle.docStaleness.summary.staleDocFiles}`,
      `Orphaned refs: ${bundle.docStaleness.summary.orphanedRefs}`,
      `Undocumented APIs: ${bundle.docStaleness.summary.undocumentedApis}`,
      `Top stale docs: ${staleDocs || "none"}`,
    );
  }
}

function appendDeltaLines(
  lines: string[],
  delta?: SnapshotDelta,
  deltaContextLabel?: string,
): void {
  if (!delta) {
    return;
  }

  const heading = deltaContextLabel
    ? `## Trend ${deltaContextLabel}`
    : "## Trend vs Previous Snapshot";
  lines.push("", heading, describeDelta(delta));
}

export function assemblePrompt(
  config: RepoConfig,
  bundle: SnapshotBundle,
  delta?: SnapshotDelta,
  deltaContextLabel?: string,
  activeFindings?: FindingInstance[],
): string {
  const { gitStats, staleness, debtMarkers } = bundle;

  const w7 = gitStats.windows["7d"];
  const w30 = gitStats.windows["30d"];
  const w90 = gitStats.windows["90d"];

  const codeLegend = buildCodeLegend();

  const lines: string[] = [
    `Repository: ${config.slug} (${config.type})`,
    `Snapshot taken: ${gitStats.collectedAt}`,
    "",
    "## Git Activity",
    `7d: ${w7.totalFilesChanged} files changed, +${w7.totalLinesAdded}/-${w7.totalLinesRemoved} lines`,
    `30d: ${w30.totalFilesChanged} files changed, +${w30.totalLinesAdded}/-${w30.totalLinesRemoved} lines`,
    `90d: ${w90.totalFilesChanged} files changed, +${w90.totalLinesAdded}/-${w90.totalLinesRemoved} lines`,
    `High-churn files (7d): ${w7.highChurnFiles.map((f) => `${f.path} (${f.editCount} edits)`).join(", ") || "none"}`,
    `Correlated churn groups (7d): ${w7.correlatedChurnGroups.map((g) => `${g.files.join("+")} (${(g.coCommitRate * 100).toFixed(0)}%)`).join(", ") || "none"}`,
    "",
    "## Staleness",
    `Stale files: ${staleness.staleFiles.length}`,
    `Stale directories: ${staleness.staleDirectories.length}`,
    `Top stale files: ${
      staleness.staleFiles
        .slice(0, 5)
        .map((f) => `${f.path} (${f.daysSinceLastCommit}d)`)
        .join(", ") || "none"
    }`,
    "",
    "## Maintenance Debt",
    `TODOs: ${debtMarkers.summary.totalTodos}`,
    `FIXMEs: ${debtMarkers.summary.totalFixmes}`,
    `HACKs: ${debtMarkers.summary.totalHacks}`,
    `eslint-disables: ${debtMarkers.summary.totalEslintDisables}`,
    `any-casts: ${debtMarkers.summary.totalAnyCasts}`,
  ];

  appendActiveFindingLines(lines, activeFindings);
  appendComplexityLines(lines, bundle);
  appendImportAndRuntimeLines(lines, bundle);
  appendCoverageAndDocs(lines, bundle);
  appendDeltaLines(lines, delta, deltaContextLabel);

  lines.push(
    "",
    "## Finding Code Registry",
    codeLegend,
    "",
    "For every reported issue, prefix with [WD-Mx-yyy]. Use only codes from the registry.",
    "",
    "Provide a prioritized maintenance analysis with concrete next steps.",
  );

  return lines.join("\n");
}
