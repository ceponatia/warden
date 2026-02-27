import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { StructuredReport } from "../types/report.js";
import type { RepoConfig } from "../types/snapshot.js";
import type { FindingMetric } from "../types/findings.js";
import type { Severity } from "../types/work.js";
import { loadAllTrustMetrics, computeAggregateTrust } from "../work/trust.js";
import { loadWorkDocuments } from "../work/manager.js";
import {
  classifyDriftLevel,
  driftSeverity,
  readLatestTwoStructuredReports,
  readPackageVersionMap,
  readTransitiveVersionMap,
  severityRank,
  type DriftLevel,
  worstSeverity,
} from "./cross-repo-helpers.js";

const METRICS: FindingMetric[] = ["M1", "M2", "M3", "M4", "M5", "M6", "M7", "M8", "M9"];

type TrendDirection = "worsening" | "stable" | "improving";

export interface DependencyDrift {
  dependency: string;
  versions: Record<string, string>;
  driftLevel: DriftLevel;
  severity: Severity;
  source: "direct" | "transitive";
}

export interface CorrelatedFinding {
  code: string;
  repos: string[];
  count: number;
}

export interface PatternEvidence {
  slug: string;
  findingId?: string;
  metric?: FindingMetric;
  value?: number;
  trend?: TrendDirection;
}

export interface SystemicPattern {
  patternType: "shared-finding" | "shared-hotspot" | "metric-trend";
  description: string;
  affectedRepos: string[];
  severity: Severity;
  evidence: PatternEvidence[];
}

export interface AgentTrustSummary {
  agentName: string;
  repoScores: Record<string, number>;
  aggregateScore: number;
  globalEligible: boolean;
}

export interface MetricTrendSummary {
  metric: FindingMetric;
  repoTrends: Record<string, TrendDirection>;
  repoDeltas: Record<string, number>;
}

export interface CrossRepoReport {
  timestamp: string;
  repos: string[];
  sharedDependencyDrift: DependencyDrift[];
  correlatedFindings: CorrelatedFinding[];
  systemicPatterns: SystemicPattern[];
  trustAggregation: AgentTrustSummary[];
  metricTrends: MetricTrendSummary[];
  recommendations: string[];
}

function computeDependencyDrift(
  repoDeps: Map<string, Map<string, string>>,
  source: "direct" | "transitive",
): DependencyDrift[] {
  const allDependencies = new Set<string>();
  for (const deps of repoDeps.values()) {
    for (const dep of deps.keys()) allDependencies.add(dep);
  }

  const drift: DependencyDrift[] = [];
  for (const dep of allDependencies) {
    const versions: Record<string, string> = {};
    for (const [slug, deps] of repoDeps.entries()) {
      const value = deps.get(dep);
      if (value) versions[slug] = value;
    }
    const uniqueVersions = [...new Set(Object.values(versions))];
    if (uniqueVersions.length <= 1) continue;

    const driftLevel = classifyDriftLevel(uniqueVersions);
    drift.push({
      dependency: dep,
      versions,
      driftLevel,
      severity: driftSeverity(driftLevel),
      source,
    });
  }

  return drift;
}

function computeCorrelatedFindings(
  activeDocsByRepo: Map<string, Awaited<ReturnType<typeof loadWorkDocuments>>>,
): CorrelatedFinding[] {
  const codeToRepos = new Map<string, Set<string>>();
  for (const [slug, docs] of activeDocsByRepo.entries()) {
    for (const code of new Set(docs.map((doc) => doc.code))) {
      const set = codeToRepos.get(code) ?? new Set<string>();
      set.add(slug);
      codeToRepos.set(code, set);
    }
  }

  const correlated: CorrelatedFinding[] = [];
  for (const [code, reposSet] of codeToRepos.entries()) {
    if (reposSet.size < 2) continue;
    const repos = [...reposSet].sort();
    correlated.push({ code, repos, count: repos.length });
  }
  return correlated.sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));
}

function buildSharedFindingPatterns(
  activeDocsByRepo: Map<string, Awaited<ReturnType<typeof loadWorkDocuments>>>,
): SystemicPattern[] {
  const codeToRefs = new Map<string, Array<{ slug: string; findingId: string; severity: Severity }>>();

  for (const [slug, docs] of activeDocsByRepo.entries()) {
    for (const doc of docs) {
      const bucket = codeToRefs.get(doc.code) ?? [];
      bucket.push({ slug, findingId: doc.findingId, severity: doc.severity });
      codeToRefs.set(doc.code, bucket);
    }
  }

  const patterns: SystemicPattern[] = [];
  for (const [code, refs] of codeToRefs.entries()) {
    const repos = [...new Set(refs.map((ref) => ref.slug))].sort();
    if (repos.length < 2) continue;

    patterns.push({
      patternType: "shared-finding",
      description: `${code} is active in ${repos.length} repositories.`,
      affectedRepos: repos,
      severity: worstSeverity(refs.map((ref) => ref.severity)),
      evidence: repos.map((slug) => ({
        slug,
        findingId: refs.find((entry) => entry.slug === slug)?.findingId,
        value: refs.filter((entry) => entry.slug === slug).length,
      })),
    });
  }

  return patterns;
}

function normalizeHotspotPath(filePath: string): string {
  const normalized = filePath.replaceAll("\\", "/").replace(/^\.\//, "");
  const withoutPackage = normalized.replace(/^packages\/[^/]+\//, "");
  const parts = withoutPackage.split("/").filter(Boolean);
  return parts.length <= 3 ? withoutPackage : parts.slice(-3).join("/");
}

function buildSharedHotspotPatterns(
  activeDocsByRepo: Map<string, Awaited<ReturnType<typeof loadWorkDocuments>>>,
): SystemicPattern[] {
  const hotspots = new Map<string, Array<{ slug: string; severity: Severity; findingId: string }>>();

  for (const [slug, docs] of activeDocsByRepo.entries()) {
    for (const doc of docs) {
      if (!doc.path) continue;
      const key = normalizeHotspotPath(doc.path);
      const bucket = hotspots.get(key) ?? [];
      bucket.push({ slug, severity: doc.severity, findingId: doc.findingId });
      hotspots.set(key, bucket);
    }
  }

  const patterns: SystemicPattern[] = [];
  for (const [hotspot, refs] of hotspots.entries()) {
    const repos = [...new Set(refs.map((ref) => ref.slug))].sort();
    if (repos.length < 2) continue;

    patterns.push({
      patternType: "shared-hotspot",
      description: `Path pattern ${hotspot} appears in active findings across ${repos.length} repositories.`,
      affectedRepos: repos,
      severity: worstSeverity(refs.map((ref) => ref.severity)),
      evidence: repos.map((slug) => ({
        slug,
        findingId: refs.find((entry) => entry.slug === slug)?.findingId,
      })),
    });
  }

  return patterns;
}

function findingCountByMetric(report: StructuredReport | null): Record<FindingMetric, number> {
  const counts = Object.fromEntries(METRICS.map((metric) => [metric, 0])) as Record<FindingMetric, number>;
  if (!report) return counts;
  for (const finding of report.findings) {
    counts[finding.metric] = (counts[finding.metric] ?? 0) + 1;
  }
  return counts;
}

function metricSeverity(report: StructuredReport | null, metric: FindingMetric): Severity {
  if (!report) return "S5";
  return worstSeverity(
    report.findings
      .filter((finding) => finding.metric === metric)
      .map((finding) => finding.severity),
  );
}

function detectMetricTrendPatterns(
  reportPairsByRepo: Map<string, [StructuredReport | null, StructuredReport | null]>,
): { patterns: SystemicPattern[]; summaries: MetricTrendSummary[] } {
  const patterns: SystemicPattern[] = [];
  const summaries: MetricTrendSummary[] = [];

  for (const metric of METRICS) {
    const repoTrends: Record<string, TrendDirection> = {};
    const repoDeltas: Record<string, number> = {};

    for (const [slug, [latest, previous]] of reportPairsByRepo.entries()) {
      const latestCount = findingCountByMetric(latest)[metric] ?? 0;
      const previousCount = findingCountByMetric(previous)[metric] ?? 0;
      const delta = latestCount - previousCount;
      repoDeltas[slug] = delta;
      repoTrends[slug] = delta > 0 ? "worsening" : delta < 0 ? "improving" : "stable";
    }

    summaries.push({ metric, repoTrends, repoDeltas });

    for (const trend of ["worsening", "improving"] as const) {
      const affectedRepos = Object.entries(repoTrends)
        .filter(([, value]) => value === trend)
        .map(([slug]) => slug)
        .sort();
      if (affectedRepos.length < 3) continue;

      patterns.push({
        patternType: "metric-trend",
        description: `${metric} is ${trend} in ${affectedRepos.length} repositories.`,
        affectedRepos,
        severity:
          trend === "worsening"
            ? worstSeverity(
                affectedRepos.map((slug) =>
                  metricSeverity(reportPairsByRepo.get(slug)?.[0] ?? null, metric),
                ),
              )
            : "S4",
        evidence: affectedRepos.map((slug) => ({
          slug,
          metric,
          value: repoDeltas[slug],
          trend,
        })),
      });
    }
  }

  return { patterns, summaries };
}

async function computeTrustAggregation(repoSlugs: string[]): Promise<AgentTrustSummary[]> {
  const agentNames = new Set<string>();
  for (const slug of repoSlugs) {
    const entries = await loadAllTrustMetrics(slug);
    for (const entry of entries) agentNames.add(entry.agentName);
  }

  const summaries: AgentTrustSummary[] = [];
  for (const agentName of [...agentNames].sort()) {
    summaries.push(await computeAggregateTrust(agentName, repoSlugs));
  }
  return summaries.sort((a, b) => b.aggregateScore - a.aggregateScore);
}

function buildRecommendations(report: CrossRepoReport): string[] {
  const recommendations: string[] = [];
  if (report.sharedDependencyDrift.some((entry) => entry.driftLevel === "major")) {
    recommendations.push("Resolve major dependency version drift first to reduce cross-repo integration risk.");
  }
  if (report.systemicPatterns.some((pattern) => pattern.patternType === "shared-finding")) {
    recommendations.push("Create shared remediation playbooks for finding codes recurring across repositories.");
  }
  if (report.systemicPatterns.some((pattern) => pattern.patternType === "metric-trend" && pattern.description.includes("worsening"))) {
    recommendations.push("Address worsening trends through templates and tooling changes rather than isolated repo fixes.");
  }
  if (report.trustAggregation.some((entry) => !entry.globalEligible)) {
    recommendations.push("Gate global auto-merge to agents with healthy trust in every monitored repository.");
  }
  if (recommendations.length === 0) {
    recommendations.push("No significant cross-repo risks detected in this run.");
  }
  return recommendations;
}

export async function runCrossRepoAnalysis(
  configs: RepoConfig[],
  options: { persist?: boolean } = {},
): Promise<CrossRepoReport | null> {
  if (configs.length < 2) return null;

  const repoSlugs = configs.map((config) => config.slug);
  const directDeps = new Map<string, Map<string, string>>();
  const transitiveDeps = new Map<string, Map<string, string>>();
  const activeDocsByRepo = new Map<string, Awaited<ReturnType<typeof loadWorkDocuments>>>();
  const reportPairsByRepo = new Map<string, [StructuredReport | null, StructuredReport | null]>();

  await Promise.all(
    configs.map(async (config) => {
      const [direct, transitive, docs, reportPair] = await Promise.all([
        readPackageVersionMap(config.path),
        readTransitiveVersionMap(config.path),
        loadWorkDocuments(config.slug).then((entries) =>
          entries.filter((doc) => doc.status !== "resolved" && doc.status !== "wont-fix"),
        ),
        readLatestTwoStructuredReports(config.slug),
      ]);
      directDeps.set(config.slug, direct);
      transitiveDeps.set(config.slug, transitive);
      activeDocsByRepo.set(config.slug, docs);
      reportPairsByRepo.set(config.slug, reportPair);
    }),
  );

  const trendData = detectMetricTrendPatterns(reportPairsByRepo);
  const systemicPatterns = [
    ...buildSharedFindingPatterns(activeDocsByRepo),
    ...buildSharedHotspotPatterns(activeDocsByRepo),
    ...trendData.patterns,
  ].sort((a, b) => {
    const severityDelta = severityRank(a.severity) - severityRank(b.severity);
    if (severityDelta !== 0) return severityDelta;
    return b.affectedRepos.length - a.affectedRepos.length;
  });

  const report: CrossRepoReport = {
    timestamp: new Date().toISOString(),
    repos: repoSlugs,
    sharedDependencyDrift: [...computeDependencyDrift(directDeps, "direct"), ...computeDependencyDrift(transitiveDeps, "transitive")].sort((a, b) => {
      const severityDelta = severityRank(a.severity) - severityRank(b.severity);
      if (severityDelta !== 0) return severityDelta;
      return a.dependency.localeCompare(b.dependency);
    }),
    correlatedFindings: computeCorrelatedFindings(activeDocsByRepo),
    systemicPatterns,
    trustAggregation: await computeTrustAggregation(repoSlugs),
    metricTrends: trendData.summaries,
    recommendations: [],
  };
  report.recommendations = buildRecommendations(report);

  if (options.persist ?? true) {
    const reportDir = path.resolve(process.cwd(), "data", "cross-repo");
    await mkdir(reportDir, { recursive: true });
    const fileName = `${report.timestamp.replace(/:/g, "-").replace(/\..+$/, "")}.json`;
    await writeFile(path.join(reportDir, fileName), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }

  return report;
}
