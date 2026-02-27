import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { getRepoConfigBySlug, loadRepoConfigs } from "../../config/loader.js";
import { runCollectors } from "../../collectors/index.js";
import { syncGithubClone } from "../../github/repo.js";
import { pruneRepoArtifacts } from "../../retention.js";
import type { RepoConfig } from "../../types/snapshot.js";

function timestampFolderName(date: Date): string {
  return date.toISOString().replace(/:/g, "-").replace(/\..+$/, "");
}

async function collectForRepo(config: RepoConfig): Promise<void> {
  process.stdout.write(`Collecting data for ${config.slug}...\n`);
  if (config.source === "github") {
    process.stdout.write(`  Syncing clone from GitHub...\n`);
    await syncGithubClone(config.path);
  }

  const results = await runCollectors(config);
  const snapshotTimestamp = timestampFolderName(new Date());
  const snapshotDir = path.resolve(
    process.cwd(),
    "data",
    config.slug,
    "snapshots",
    snapshotTimestamp,
  );

  await mkdir(snapshotDir, { recursive: true });

  await Promise.all([
    writeFile(
      path.join(snapshotDir, "git-stats.json"),
      `${JSON.stringify(results.gitStats, null, 2)}\n`,
      "utf8",
    ),
    writeFile(
      path.join(snapshotDir, "staleness.json"),
      `${JSON.stringify(results.staleness, null, 2)}\n`,
      "utf8",
    ),
    writeFile(
      path.join(snapshotDir, "debt-markers.json"),
      `${JSON.stringify(results.debtMarkers, null, 2)}\n`,
      "utf8",
    ),
    writeFile(
      path.join(snapshotDir, "complexity.json"),
      `${JSON.stringify(results.complexity, null, 2)}\n`,
      "utf8",
    ),
    writeFile(
      path.join(snapshotDir, "imports.json"),
      `${JSON.stringify(results.imports, null, 2)}\n`,
      "utf8",
    ),
    writeFile(
      path.join(snapshotDir, "runtime.json"),
      `${JSON.stringify(results.runtime, null, 2)}\n`,
      "utf8",
    ),
    writeFile(
      path.join(snapshotDir, "coverage.json"),
      `${JSON.stringify(results.coverage, null, 2)}\n`,
      "utf8",
    ),
    writeFile(
      path.join(snapshotDir, "doc-staleness.json"),
      `${JSON.stringify(results.docStaleness, null, 2)}\n`,
      "utf8",
    ),
  ]);

  process.stdout.write(
    `  git-stats: ${results.gitStats.windows["7d"].totalFilesChanged} files analyzed, ${results.gitStats.windows["7d"].files.length} flagged\n`,
  );
  process.stdout.write(
    `  staleness: ${results.staleness.staleFiles.length} stale files, ${results.staleness.staleDirectories.length} stale directories\n`,
  );
  process.stdout.write(
    `  debt-markers: ${results.debtMarkers.summary.totalTodos} TODOs, ${results.debtMarkers.summary.totalEslintDisables} eslint-disable, ${results.debtMarkers.summary.totalAnyCasts} any-casts\n`,
  );
  process.stdout.write(
    `  complexity: ${results.complexity.summary.totalFindings} findings\n`,
  );
  process.stdout.write(
    `  imports: ${results.imports.summary.filesScanned} files scanned, ${results.imports.summary.deepImports} deep imports\n`,
  );
  process.stdout.write(
    `  runtime: ${results.runtime.summary.apiHitEvents} API hit events, ${results.runtime.summary.coverageFiles} coverage files\n`,
  );
  process.stdout.write(
    `  coverage: ${results.coverage.summary.totalFiles} files, avg ${results.coverage.summary.averageCoverage}%\n`,
  );
  process.stdout.write(
    `  doc-staleness: ${results.docStaleness.summary.staleDocFiles} stale docs, ${results.docStaleness.summary.orphanedRefs} orphaned refs\n`,
  );
  process.stdout.write(
    `Snapshot written to data/${config.slug}/snapshots/${snapshotTimestamp}/\n`,
  );

  const pruned = await pruneRepoArtifacts(config);
  if (pruned.snapshots.length > 0 || pruned.reports.length > 0) {
    process.stdout.write(
      `Pruned ${pruned.snapshots.length} snapshots and ${pruned.reports.length} reports for ${config.slug}\n`,
    );
  }
}

export async function runCollectCommand(repoSlug?: string): Promise<void> {
  const configs = await loadRepoConfigs();
  if (configs.length === 0) {
    throw new Error("No repos configured. Run 'warden init <path>' first.");
  }

  if (repoSlug) {
    const config = getRepoConfigBySlug(configs, repoSlug);
    await collectForRepo(config);
    return;
  }

  for (const config of configs) {
    await collectForRepo(config);
  }
}
