import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { getRepoConfigBySlug, loadRepoConfigs } from "../../config/loader.js";
import { runAnalysis } from "../../agents/runner.js";
import type { RepoConfig } from "../../types/snapshot.js";
import type {
  AgentActivityEntry,
  StructuredFinding,
  StructuredReport,
} from "../../types/report.js";
import type { Severity } from "../../types/work.js";
import { assignInitialSeverity } from "../../work/severity.js";
import { generateFindingId, loadWorkDocuments } from "../../work/manager.js";
import { loadAllTrustMetrics } from "../../work/trust.js";

function timestampFileName(date: Date): string {
  return date.toISOString().replace(/:/g, "-").replace(/\..+$/, "");
}

async function analyzeRepo(config: RepoConfig): Promise<void> {
  process.stdout.write(`Analyzing ${config.slug}...\n`);
  const result = await runAnalysis(config);

  const timestamp = timestampFileName(new Date());
  const fileName = `${timestamp}.md`;
  const analysisDir = path.resolve(
    process.cwd(),
    "data",
    config.slug,
    "analyses",
  );
  await mkdir(analysisDir, { recursive: true });

  const analysisPath = path.join(analysisDir, fileName);
  await writeFile(analysisPath, `${result.analysis}\n`, "utf8");

  const reportsDir = path.resolve(
    process.cwd(),
    "data",
    config.slug,
    "reports",
  );
  await mkdir(reportsDir, { recursive: true });
  const markdownReportPath = path.join(reportsDir, `${timestamp}.md`);
  const jsonReportPath = path.join(reportsDir, `${timestamp}.json`);

  const structuredReport = await buildStructuredReport(
    config,
    timestamp,
    result,
  );
  await writeFile(markdownReportPath, `${result.analysis}\n`, "utf8");
  await writeFile(
    jsonReportPath,
    `${JSON.stringify(structuredReport, null, 2)}\n`,
    "utf8",
  );

  process.stdout.write(result.analysis);
  process.stdout.write("\n");
  process.stdout.write(
    `Analysis written to data/${config.slug}/analyses/${fileName}\n`,
  );
  process.stdout.write(
    `Structured report written to data/${config.slug}/reports/${timestamp}.{md,json}\n`,
  );
}

function buildAgentActivity(
  entries: Awaited<ReturnType<typeof loadWorkDocuments>>,
): AgentActivityEntry[] {
  const results: AgentActivityEntry[] = [];
  for (const doc of entries) {
    if (!doc.assignedTo) {
      continue;
    }
    results.push({
      agentName: doc.assignedTo,
      action: doc.status,
      findingCode: doc.code,
      branch: doc.relatedBranch,
      validationPassed: doc.validationResult?.passed,
      validationAttempts: doc.validationResult?.attempts,
    });
  }
  return results;
}

function toStructuredFindings(
  findings: Awaited<ReturnType<typeof runAnalysis>>["findings"],
  workDocs: Awaited<ReturnType<typeof loadWorkDocuments>>,
): StructuredFinding[] {
  const workDocMap = new Map(workDocs.map((doc) => [doc.findingId, doc]));
  return findings.map((finding) => {
    const findingId = generateFindingId(finding);
    const doc = workDocMap.get(findingId);
    const severity: Severity = doc?.severity ?? assignInitialSeverity(finding);
    return {
      code: finding.code,
      metric: finding.metric,
      severity,
      summary: finding.summary,
      path: finding.path,
      symbol: finding.symbol,
      consecutiveReports: doc?.consecutiveReports ?? 1,
      trend: doc?.trend ?? "new",
      workDocumentId: doc?.findingId,
    };
  });
}

function buildWorkSummary(
  workDocs: Awaited<ReturnType<typeof loadWorkDocuments>>,
  summary: Awaited<ReturnType<typeof runAnalysis>>["workDocumentSummary"],
): StructuredReport["workDocumentSummary"] {
  return {
    unassigned: summary?.unassigned ?? 0,
    autoAssigned: summary?.autoAssigned ?? 0,
    agentInProgress: workDocs.filter((d) => d.status === "agent-in-progress")
      .length,
    agentComplete: summary?.agentComplete ?? 0,
    blocked: summary?.blocked ?? 0,
    resolvedThisReport: summary?.resolvedThisRun ?? 0,
  };
}

function buildMetricSnapshots(
  result: Awaited<ReturnType<typeof runAnalysis>>,
): StructuredReport["metricSnapshots"] {
  const git7d = result.snapshot.gitStats.windows["7d"];
  const totalLoc = git7d.totalLinesAdded + git7d.totalLinesRemoved;
  const boundaryViolations = result.snapshot.imports?.summary.deepImports ?? 0;

  return {
    totalFiles: git7d.totalFilesChanged,
    totalLoc,
    staleFileCount: result.snapshot.staleness.staleFiles.length,
    todoCount: result.snapshot.debtMarkers.summary.totalTodos,
    complexityFindings: result.snapshot.complexity?.summary.totalFindings ?? 0,
    boundaryViolations,
  };
}

async function buildStructuredReport(
  config: RepoConfig,
  timestamp: string,
  result: Awaited<ReturnType<typeof runAnalysis>>,
): Promise<StructuredReport> {
  const workDocs = await loadWorkDocuments(config.slug);
  const trustScores = await loadAllTrustMetrics(config.slug);

  return {
    timestamp,
    repoSlug: config.slug,
    branch: result.snapshot.gitStats.branch,
    findings: toStructuredFindings(result.findings, workDocs),
    workDocumentSummary: buildWorkSummary(workDocs, result.workDocumentSummary),
    agentActivity: buildAgentActivity(workDocs),
    trustScores,
    improvements: result.improvements,
    metricSnapshots: buildMetricSnapshots(result),
  };
}

export async function runAnalyzeCommand(repoSlug?: string): Promise<void> {
  const configs = await loadRepoConfigs();
  if (configs.length === 0) {
    throw new Error("No repos configured. Run 'warden init <path>' first.");
  }

  if (repoSlug) {
    const config = getRepoConfigBySlug(configs, repoSlug);
    await analyzeRepo(config);
    return;
  }

  for (const config of configs) {
    await analyzeRepo(config);
  }
}
