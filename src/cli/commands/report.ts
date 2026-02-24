import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { getRepoConfigBySlug, loadRepoConfigs } from "../../config/loader.js";
import { renderTemplateReport } from "../../reporter/template-report.js";
import type {
  ComplexitySnapshot,
  DebtMarkersSnapshot,
  GitStatsSnapshot,
  ImportsSnapshot,
  RepoConfig,
  RuntimeSnapshot,
  StalenessSnapshot,
} from "../../types/snapshot.js";

interface LoadedSnapshot {
  timestamp: string;
  gitStats: GitStatsSnapshot;
  staleness: StalenessSnapshot;
  debtMarkers: DebtMarkersSnapshot;
  complexity: ComplexitySnapshot | null;
  imports: ImportsSnapshot | null;
  runtime: RuntimeSnapshot | null;
}

async function readJsonIfPresent<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function timestampFileName(date: Date): string {
  return date.toISOString().replace(/:/g, "-").replace(/\..+$/, "");
}

async function loadLatestSnapshot(config: RepoConfig): Promise<LoadedSnapshot> {
  const snapshotsRoot = path.resolve(
    process.cwd(),
    "data",
    config.slug,
    "snapshots",
  );
  const entries = await readdir(snapshotsRoot, { withFileTypes: true });
  const latest = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => right.localeCompare(left))[0];

  if (!latest) {
    throw new Error(
      `No snapshots found for ${config.slug}. Run 'warden collect' first.`,
    );
  }

  const snapshotDir = path.join(snapshotsRoot, latest);
  const [gitStatsRaw, stalenessRaw, debtRaw, complexity, imports, runtime] =
    await Promise.all([
      readFile(path.join(snapshotDir, "git-stats.json"), "utf8"),
      readFile(path.join(snapshotDir, "staleness.json"), "utf8"),
      readFile(path.join(snapshotDir, "debt-markers.json"), "utf8"),
      readJsonIfPresent<ComplexitySnapshot>(
        path.join(snapshotDir, "complexity.json"),
      ),
      readJsonIfPresent<ImportsSnapshot>(
        path.join(snapshotDir, "imports.json"),
      ),
      readJsonIfPresent<RuntimeSnapshot>(
        path.join(snapshotDir, "runtime.json"),
      ),
    ]);

  return {
    timestamp: latest,
    gitStats: JSON.parse(gitStatsRaw) as GitStatsSnapshot,
    staleness: JSON.parse(stalenessRaw) as StalenessSnapshot,
    debtMarkers: JSON.parse(debtRaw) as DebtMarkersSnapshot,
    complexity,
    imports,
    runtime,
  };
}

async function renderReportForRepo(config: RepoConfig): Promise<void> {
  const snapshot = await loadLatestSnapshot(config);
  const report = renderTemplateReport(
    config,
    snapshot.gitStats,
    snapshot.staleness,
    snapshot.debtMarkers,
    snapshot.complexity,
    snapshot.imports,
    snapshot.runtime,
  );

  const fileName = `${timestampFileName(new Date())}.md`;
  const reportPath = path.resolve(
    process.cwd(),
    "data",
    config.slug,
    "reports",
    fileName,
  );
  await writeFile(reportPath, `${report}\n`, "utf8");

  process.stdout.write(report);
  process.stdout.write("\n");
  process.stdout.write(
    `Report written to data/${config.slug}/reports/${fileName}\n`,
  );
}

export async function runReportCommand(repoSlug?: string): Promise<void> {
  const configs = await loadRepoConfigs();
  if (configs.length === 0) {
    throw new Error("No repos configured. Run 'warden init <path>' first.");
  }

  if (repoSlug) {
    const config = getRepoConfigBySlug(configs, repoSlug);
    await renderReportForRepo(config);
    return;
  }

  for (const config of configs) {
    await renderReportForRepo(config);
  }
}
