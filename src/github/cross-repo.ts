import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

import type { RepoConfig } from "../types/snapshot.js";

export interface DependencyDrift {
  dependency: string;
  versions: Record<string, string>;
}

export interface CorrelatedFinding {
  code: string;
  repos: string[];
  count: number;
}

export interface CrossRepoReport {
  timestamp: string;
  repos: string[];
  sharedDependencyDrift: DependencyDrift[];
  correlatedFindings: CorrelatedFinding[];
  recommendations: string[];
}

async function readPackageVersionMap(
  repoPath: string,
): Promise<Map<string, string>> {
  const packageJsonPath = path.join(repoPath, "package.json");
  try {
    const raw = await readFile(packageJsonPath, "utf8");
    const parsed = JSON.parse(raw) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const merged = {
      ...(parsed.dependencies ?? {}),
      ...(parsed.devDependencies ?? {}),
    };
    return new Map(Object.entries(merged));
  } catch {
    return new Map();
  }
}

async function readLatestStructuredReportCodes(
  slug: string,
): Promise<string[]> {
  const reportsDir = path.resolve(process.cwd(), "data", slug, "reports");
  let entries: string[] = [];
  try {
    entries = (await readdir(reportsDir)).filter((name) =>
      name.endsWith(".json"),
    );
  } catch {
    return [];
  }

  const latest = entries.sort((a, b) => b.localeCompare(a))[0];
  if (!latest) {
    return [];
  }

  try {
    const raw = await readFile(path.join(reportsDir, latest), "utf8");
    const parsed = JSON.parse(raw) as {
      findings?: Array<{ code?: string }>;
    };
    return (parsed.findings ?? [])
      .map((finding) => finding.code)
      .filter((code): code is string => typeof code === "string");
  } catch {
    return [];
  }
}

function computeDependencyDrift(
  repoDeps: Map<string, Map<string, string>>,
): DependencyDrift[] {
  const allDependencies = new Set<string>();
  for (const deps of repoDeps.values()) {
    for (const dep of deps.keys()) {
      allDependencies.add(dep);
    }
  }

  const drift: DependencyDrift[] = [];
  for (const dep of allDependencies) {
    const versions: Record<string, string> = {};
    for (const [slug, deps] of repoDeps.entries()) {
      const value = deps.get(dep);
      if (value) {
        versions[slug] = value;
      }
    }

    const uniqueVersions = new Set(Object.values(versions));
    if (uniqueVersions.size > 1) {
      drift.push({ dependency: dep, versions });
    }
  }

  return drift.sort((a, b) => a.dependency.localeCompare(b.dependency));
}

function computeCorrelatedFindings(
  findingCodesByRepo: Map<string, string[]>,
): CorrelatedFinding[] {
  const codeToRepos = new Map<string, Set<string>>();
  for (const [slug, codes] of findingCodesByRepo.entries()) {
    for (const code of new Set(codes)) {
      const set = codeToRepos.get(code) ?? new Set<string>();
      set.add(slug);
      codeToRepos.set(code, set);
    }
  }

  const correlated: CorrelatedFinding[] = [];
  for (const [code, reposSet] of codeToRepos.entries()) {
    if (reposSet.size < 2) {
      continue;
    }
    const repos = [...reposSet].sort();
    correlated.push({ code, repos, count: repos.length });
  }

  return correlated.sort(
    (a, b) => b.count - a.count || a.code.localeCompare(b.code),
  );
}

function buildRecommendations(report: {
  sharedDependencyDrift: DependencyDrift[];
  correlatedFindings: CorrelatedFinding[];
}): string[] {
  const recommendations: string[] = [];

  if (report.sharedDependencyDrift.length > 0) {
    recommendations.push(
      "Create a shared dependency policy to align versions across monitored repositories.",
    );
  }

  if (report.correlatedFindings.length > 0) {
    recommendations.push(
      "Prioritize a systemic fix for recurring finding codes that appear in multiple repositories.",
    );
  }

  if (recommendations.length === 0) {
    recommendations.push("No cross-repo drift detected in this run.");
  }

  return recommendations;
}

export async function runCrossRepoAnalysis(
  configs: RepoConfig[],
): Promise<CrossRepoReport | null> {
  const githubConfigs = configs.filter((config) => config.source === "github");
  if (githubConfigs.length < 2) {
    return null;
  }

  const repoDeps = new Map<string, Map<string, string>>();
  const findingsByRepo = new Map<string, string[]>();

  for (const config of githubConfigs) {
    repoDeps.set(config.slug, await readPackageVersionMap(config.path));
    findingsByRepo.set(
      config.slug,
      await readLatestStructuredReportCodes(config.slug),
    );
  }

  const report: CrossRepoReport = {
    timestamp: new Date().toISOString(),
    repos: githubConfigs.map((config) => config.slug),
    sharedDependencyDrift: computeDependencyDrift(repoDeps),
    correlatedFindings: computeCorrelatedFindings(findingsByRepo),
    recommendations: [],
  };
  report.recommendations = buildRecommendations(report);

  const reportDir = path.resolve(process.cwd(), "data", "cross-repo");
  await mkdir(reportDir, { recursive: true });
  const fileName = `${report.timestamp.replace(/:/g, "-").replace(/\..+$/, "")}.json`;
  await writeFile(
    path.join(reportDir, fileName),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );

  return report;
}
