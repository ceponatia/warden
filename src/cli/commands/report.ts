import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { computeDelta } from "../../agents/delta.js";
import { loadAllowlist } from "../../config/allowlist.js";
import { getRepoConfigBySlug, loadRepoConfigs } from "../../config/loader.js";
import {
  evaluateFindings,
  summarizeFindingsByCode,
} from "../../findings/evaluate.js";
import { runAnalysis } from "../../agents/runner.js";
import { callProvider } from "../../agents/provider.js";
import { runCrossRepoAnalysis } from "../../github/cross-repo.js";
import { pruneReports } from "../../retention.js";
import {
  renderPortfolioReport,
  renderTemplateReport,
} from "../../reporter/template-report.js";
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

function toSuggestionLines(content: string): string[] {
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => line.replace(/^[-*\d.\s]+/, ""))
    .filter((line) => line.length > 0)
    .slice(0, 8);
}

async function buildPortfolioAiRecommendations(report: string): Promise<string[]> {
  const prompt = [
    "You are Warden's portfolio analyst.",
    "Return 3-6 concise, actionable recommendations as plain bullet lines.",
    "Base recommendations on the portfolio report below:",
    "",
    report,
  ].join("\n");

  const response = await callProvider({
    systemPrompt:
      "You are a portfolio maintenance analyst. Provide concise and concrete recommendations.",
    userPrompt: prompt,
    maxTokens: 500,
  });

  return toSuggestionLines(response);
}

async function renderPortfolioReportForRepos(
  configs: RepoConfig[],
  analyze: boolean,
): Promise<void> {
  const crossRepo = await runCrossRepoAnalysis(configs);
  if (!crossRepo) {
    throw new Error("Portfolio report requires at least two configured repositories.");
  }

  let aiRecommendations: string[] | undefined;
  const initialReport = await renderPortfolioReport(configs, crossRepo);
  if (analyze) {
    try {
      aiRecommendations = await buildPortfolioAiRecommendations(initialReport);
    } catch {
      aiRecommendations = [
        "AI recommendations unavailable (missing provider credentials or provider error).",
      ];
    }
  }

  const finalReport = await renderPortfolioReport(
    configs,
    crossRepo,
    aiRecommendations,
  );

  const fileName = `${timestampFileName(new Date())}.md`;
  const reportPath = path.resolve(
    process.cwd(),
    "data",
    "portfolio-reports",
    fileName,
  );
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${finalReport}\n`, "utf8");

  process.stdout.write(finalReport);
  process.stdout.write("\n");
  process.stdout.write(`Portfolio report written to data/portfolio-reports/${fileName}\n`);
}

export async function runReportCommand(
  options: {
    repoSlug?: string;
    analyze?: boolean;
    compareBranch?: string;
    portfolio?: boolean;
  } = {},
): Promise<void> {
  const { repoSlug, analyze = false, compareBranch, portfolio = false } =
    options;
  const configs = await loadRepoConfigs();
  if (configs.length === 0) {
    throw new Error("No repos configured. Run 'warden init <path>' first.");
  }

  if (portfolio) {
    await renderPortfolioReportForRepos(configs, analyze);
    return;
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
