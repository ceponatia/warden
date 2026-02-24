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

export function assemblePrompt(
  config: RepoConfig,
  bundle: SnapshotBundle,
  delta?: SnapshotDelta,
  deltaContextLabel?: string,
): string {
  const { gitStats, staleness, debtMarkers, complexity, imports, runtime } =
    bundle;

  const w7 = gitStats.windows["7d"];
  const w30 = gitStats.windows["30d"];
  const w90 = gitStats.windows["90d"];

  const lines: string[] = [
    `Repository: ${config.slug} (${config.type})`,
    `Snapshot taken: ${gitStats.collectedAt}`,
    "",
    "## Git Activity",
    `7d: ${w7.totalFilesChanged} files changed, +${w7.totalLinesAdded}/-${w7.totalLinesRemoved} lines`,
    `30d: ${w30.totalFilesChanged} files changed, +${w30.totalLinesAdded}/-${w30.totalLinesRemoved} lines`,
    `90d: ${w90.totalFilesChanged} files changed, +${w90.totalLinesAdded}/-${w90.totalLinesRemoved} lines`,
    `High-churn files (7d): ${w7.highChurnFiles.map((f) => `${f.path} (${f.editCount} edits)`).join(", ") || "none"}`,
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

  if (complexity) {
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

  if (imports) {
    lines.push(
      "",
      "## Import Health",
      `Files scanned: ${imports.summary.filesScanned}`,
      `Deep imports: ${imports.summary.deepImports}`,
      `Undeclared dependencies: ${imports.summary.undeclaredDependencies}`,
      `Circular chains: ${imports.summary.circularChains}`,
    );
  }

  if (runtime) {
    lines.push(
      "",
      "## Runtime Coverage",
      `API hit events: ${runtime.summary.apiHitEvents}`,
      `Unique routes: ${runtime.summary.uniqueRoutes}`,
      `Coverage files: ${runtime.summary.coverageFiles}`,
    );
  }

  if (delta) {
    const heading = deltaContextLabel
      ? `## Trend ${deltaContextLabel}`
      : "## Trend vs Previous Snapshot";
    lines.push("", heading, describeDelta(delta));
  }

  lines.push(
    "",
    "Provide a prioritized maintenance analysis with concrete next steps.",
  );

  return lines.join("\n");
}
