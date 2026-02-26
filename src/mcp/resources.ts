import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { loadRepoConfigs } from "../config/loader.js";
import { listCodes, lookupCode } from "../findings/registry.js";
import { listSnapshotTimestamps } from "../snapshots.js";

async function readLatestReport(slug: string): Promise<string> {
  const reportsDir = path.resolve(process.cwd(), "data", slug, "reports");
  const entries = await readdir(reportsDir, { withFileTypes: true });
  const latest = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort((left, right) => right.localeCompare(left))[0];

  if (!latest) {
    throw new Error(`No reports found for ${slug}`);
  }

  return readFile(path.join(reportsDir, latest), "utf8");
}

async function readLatestSnapshot(slug: string): Promise<string> {
  const timestamps = await listSnapshotTimestamps(slug);
  const latest = timestamps[0];
  if (!latest) {
    throw new Error(`No snapshots found for ${slug}`);
  }

  const snapshotDir = path.resolve(
    process.cwd(),
    "data",
    slug,
    "snapshots",
    latest,
  );
  const files = [
    "git-stats.json",
    "staleness.json",
    "debt-markers.json",
    "complexity.json",
    "imports.json",
    "runtime.json",
  ];

  const out: Record<string, unknown> = { timestamp: latest };
  for (const file of files) {
    try {
      const content = await readFile(path.join(snapshotDir, file), "utf8");
      out[file] = JSON.parse(content);
    } catch {
      out[file] = null;
    }
  }

  return JSON.stringify(out, null, 2);
}

async function readWiki(uri: string): Promise<string | null> {
  const wikiMatch = uri.match(/^warden:\/\/wiki\/(WD-M\d-\d{3})$/i);
  if (!wikiMatch?.[1]) {
    return null;
  }

  const code = wikiMatch[1].toUpperCase();
  const definition = lookupCode(code);
  if (!definition) {
    throw new Error(`Unknown finding code: ${code}`);
  }

  const wikiPath = path.resolve(process.cwd(), definition.wikiPath);
  return readFile(wikiPath, "utf8");
}

async function readRepoUri(uri: string): Promise<string | null> {
  const latestSnapshotMatch = uri.match(
    /^warden:\/\/repos\/([^/]+)\/latest-snapshot$/,
  );
  if (latestSnapshotMatch?.[1]) {
    return readLatestSnapshot(latestSnapshotMatch[1]);
  }

  const latestReportMatch = uri.match(
    /^warden:\/\/repos\/([^/]+)\/latest-report$/,
  );
  if (latestReportMatch?.[1]) {
    return readLatestReport(latestReportMatch[1]);
  }

  const snapshotsMatch = uri.match(/^warden:\/\/repos\/([^/]+)\/snapshots$/);
  if (snapshotsMatch?.[1]) {
    const snapshots = await listSnapshotTimestamps(snapshotsMatch[1]);
    return JSON.stringify(snapshots, null, 2);
  }

  return null;
}

export async function readResourceByUri(uri: string): Promise<string> {
  if (uri === "warden://repos") {
    const configs = await loadRepoConfigs();
    return JSON.stringify(configs, null, 2);
  }

  if (uri === "warden://findings") {
    return JSON.stringify(listCodes(), null, 2);
  }

  const repoResult = await readRepoUri(uri);
  if (repoResult !== null) {
    return repoResult;
  }

  const wikiResult = await readWiki(uri);
  if (wikiResult !== null) {
    return wikiResult;
  }

  throw new Error(`Unsupported resource URI: ${uri}`);
}
