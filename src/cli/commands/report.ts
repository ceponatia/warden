import { writeFile } from "node:fs/promises";
import path from "node:path";

import { computeDelta } from "../../agents/delta.js";
import { loadAllowlist } from "../../config/allowlist.js";
import { getRepoConfigBySlug, loadRepoConfigs } from "../../config/loader.js";
import {
  evaluateFindings,
  summarizeFindingsByCode,
} from "../../findings/evaluate.js";
import { runAnalysis } from "../../agents/runner.js";
import { pruneReports } from "../../retention.js";
import { renderTemplateReport } from "../../reporter/template-report.js";
import {
  loadLatestSnapshot,
  loadLatestSnapshotForBranch,
} from "../../snapshots.js";
import type { RepoConfig } from "../../types/snapshot.js";

function timestampFileName(date: Date): string {
  return date.toISOString().replace(/:/g, "-").replace(/\..+$/, "");
}

function formatDeltaLine(label: string, delta: number | null): string {
  if (delta === null) {
    return `- ${label}: n/a`;
  }

  const signed = delta > 0 ? `+${delta}` : `${delta}`;
  return `- ${label}: ${signed}`;
}

function renderCompareSection(
  compareBranch: string,
  summary: ReturnType<typeof computeDelta>,
): string {
  return [
    "",
    `## Cross-branch delta (vs ${compareBranch})`,
    formatDeltaLine("stale files", summary.staleFilesDelta),
    formatDeltaLine("stale directories", summary.staleDirectoriesDelta),
    formatDeltaLine("TODOs", summary.totalTodosDelta),
    formatDeltaLine("FIXMEs", summary.totalFixmesDelta),
    formatDeltaLine("HACKs", summary.totalHacksDelta),
    formatDeltaLine("eslint-disables", summary.totalEslintDisablesDelta),
    formatDeltaLine("any-casts", summary.totalAnyCastsDelta),
    formatDeltaLine("complexity findings", summary.complexityFindingsDelta),
    formatDeltaLine("deep imports", summary.deepImportsDelta),
    formatDeltaLine("circular chains", summary.circularChainsDelta),
  ].join("\n");
}

function renderFindingSummarySection(lines: string[]): string {
  if (lines.length === 0) {
    return "\n## Finding code summary\n- none\n";
  }

  return `\n## Finding code summary\n${lines.map((line) => `- ${line}`).join("\n")}\n`;
}

async function renderReportForRepo(
  config: RepoConfig,
  analyze: boolean,
  compareBranch?: string,
): Promise<void> {
  const snapshot = await loadLatestSnapshot(config.slug);
  const allowlist = await loadAllowlist(config);
  const activeFindings = evaluateFindings(config, snapshot, allowlist.rules);
  const summaryLines = summarizeFindingsByCode(activeFindings);
  const baseReport = renderTemplateReport(
    config,
    snapshot.gitStats,
    snapshot.staleness,
    snapshot.debtMarkers,
    snapshot.complexity ?? null,
    snapshot.imports ?? null,
    snapshot.runtime ?? null,
    snapshot.coverage ?? null,
    snapshot.docStaleness ?? null,
  );

  let report = `${baseReport}${renderFindingSummarySection(summaryLines)}`;
  if (compareBranch) {
    const baseline = await loadLatestSnapshotForBranch(
      config.slug,
      compareBranch,
    );
    const delta = computeDelta(baseline, snapshot);
    report = `${baseReport}${renderFindingSummarySection(summaryLines)}${renderCompareSection(compareBranch, delta)}`;
  }

  const fileName = `${timestampFileName(new Date())}.md`;
  const reportPath = path.resolve(
    process.cwd(),
    "data",
    config.slug,
    "reports",
    fileName,
  );
  await writeFile(reportPath, `${report}\n`, "utf8");
  const prunedReports = await pruneReports(
    config.slug,
    config.retention.reports,
  );

  process.stdout.write(report);
  process.stdout.write("\n");
  process.stdout.write(
    `Report written to data/${config.slug}/reports/${fileName}\n`,
  );
  if (prunedReports.length > 0) {
    process.stdout.write(
      `Pruned ${prunedReports.length} reports for ${config.slug}\n`,
    );
  }

  if (analyze) {
    process.stdout.write(`\nRunning analysis for ${config.slug}...\n`);
    const result = await runAnalysis(config, { compareBranch });
    process.stdout.write(result.analysis);
    process.stdout.write("\n");
  }
}

export async function runReportCommand(
  repoSlug?: string,
  analyze = false,
  compareBranch?: string,
): Promise<void> {
  const configs = await loadRepoConfigs();
  if (configs.length === 0) {
    throw new Error("No repos configured. Run 'warden init <path>' first.");
  }

  if (repoSlug) {
    const config = getRepoConfigBySlug(configs, repoSlug);
    await renderReportForRepo(config, analyze, compareBranch);
    return;
  }

  for (const config of configs) {
    await renderReportForRepo(config, analyze, compareBranch);
  }
}
