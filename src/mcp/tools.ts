import { readFile } from "node:fs/promises";
import path from "node:path";

import { loadRepoConfigs } from "../config/loader.js";
import { computeDelta } from "../agents/delta.js";
import { runAnalyzeCommand } from "../cli/commands/analyze.js";
import { runCollectCommand } from "../cli/commands/collect.js";
import { runReportCommand } from "../cli/commands/report.js";
import { lookupCode } from "../findings/registry.js";
import { loadSnapshotByTimestamp, loadLatestSnapshot } from "../snapshots.js";

function ensureSlug(slug: string | undefined): string {
  if (!slug || slug.trim().length === 0) {
    throw new Error("Missing repo slug");
  }

  return slug;
}

export async function toolListRepos(): Promise<string> {
  const repos = await loadRepoConfigs();
  return JSON.stringify(
    repos.map((repo) => ({
      slug: repo.slug,
      type: repo.type,
      path: repo.path,
    })),
    null,
    2,
  );
}

export async function toolCollect(slug: string | undefined): Promise<string> {
  const repoSlug = ensureSlug(slug);
  await runCollectCommand(repoSlug);
  return `Collection complete for ${repoSlug}`;
}

export async function toolAnalyze(slug: string | undefined): Promise<string> {
  const repoSlug = ensureSlug(slug);
  await runAnalyzeCommand(repoSlug);
  return `Analysis complete for ${repoSlug}`;
}

export async function toolReport(slug: string | undefined): Promise<string> {
  const repoSlug = ensureSlug(slug);
  await runReportCommand(repoSlug, false);
  return `Report generated for ${repoSlug}`;
}

export async function toolWikiLookup(
  code: string | undefined,
): Promise<string> {
  if (!code || code.trim().length === 0) {
    throw new Error("Missing finding code");
  }

  const normalizedCode = code.toUpperCase();
  const definition = lookupCode(normalizedCode);
  if (!definition) {
    throw new Error(`Unknown finding code: ${normalizedCode}`);
  }

  const wikiPath = path.resolve(process.cwd(), definition.wikiPath);
  return readFile(wikiPath, "utf8");
}

export async function toolSnapshotDiff(
  slug: string | undefined,
  leftTimestamp: string | undefined,
  rightTimestamp: string | undefined,
): Promise<string> {
  const repoSlug = ensureSlug(slug);

  const right = rightTimestamp
    ? await loadSnapshotByTimestamp(repoSlug, rightTimestamp)
    : await loadLatestSnapshot(repoSlug);

  const left = leftTimestamp
    ? await loadSnapshotByTimestamp(repoSlug, leftTimestamp)
    : null;

  if (!left) {
    return JSON.stringify({
      message: "Left snapshot not provided; pass leftTimestamp to diff.",
      rightTimestamp: right.timestamp,
    });
  }

  const delta = computeDelta(left, right);
  return JSON.stringify(
    {
      leftTimestamp: left.timestamp,
      rightTimestamp: right.timestamp,
      delta,
    },
    null,
    2,
  );
}
