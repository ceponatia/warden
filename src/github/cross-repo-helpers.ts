import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { readJsonIfPresent } from "../snapshots.js";
import type { StructuredReport } from "../types/report.js";
import type { Severity } from "../types/work.js";

const execFileAsync = promisify(execFile);

export type DriftLevel = "major" | "minor" | "patch" | "unknown";

export function severityRank(severity: Severity): number {
  return Number(severity.replace("S", ""));
}

export function worstSeverity(severities: Severity[]): Severity {
  if (severities.length === 0) {
    return "S5";
  }
  const worst = Math.min(...severities.map(severityRank));
  return `S${worst}` as Severity;
}

function normalizeVersion(value: string): string {
  return value.replace(/^[~^<>=\s]*/, "").trim();
}

function parseSemver(value: string): [number, number, number] | null {
  const normalized = normalizeVersion(value);
  const match = normalized.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) {
    return null;
  }
  const [majorRaw, minorRaw, patchRaw] = match.slice(1);
  const major = Number(majorRaw);
  const minor = Number(minorRaw);
  const patch = Number(patchRaw);
  if (
    !Number.isFinite(major) ||
    !Number.isFinite(minor) ||
    !Number.isFinite(patch)
  ) {
    return null;
  }
  return [major, minor, patch];
}

export function classifyDriftLevel(versions: string[]): DriftLevel {
  const parsed = versions.map(parseSemver);
  if (parsed.some((entry) => entry === null)) {
    return "unknown";
  }

  const typed = parsed as [number, number, number][];
  if (new Set(typed.map((entry) => entry[0])).size > 1) {
    return "major";
  }
  if (new Set(typed.map((entry) => entry[1])).size > 1) {
    return "minor";
  }
  if (new Set(typed.map((entry) => entry[2])).size > 1) {
    return "patch";
  }
  return "unknown";
}

export function driftSeverity(level: DriftLevel): Severity {
  if (level === "major") return "S2";
  if (level === "minor") return "S4";
  if (level === "patch") return "S5";
  return "S3";
}

export async function readPackageVersionMap(
  repoPath: string,
): Promise<Map<string, string>> {
  const packageJsonPath = path.join(repoPath, "package.json");
  try {
      const raw = await readFile(packageJsonPath, "utf8");
    const parsed = JSON.parse(raw) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };
    const merged = {
      ...(parsed.dependencies ?? {}),
      ...(parsed.devDependencies ?? {}),
      ...(parsed.peerDependencies ?? {}),
    };
    return new Map(Object.entries(merged));
  } catch {
    return new Map();
  }
}

function collectNodeVersions(
  depName: string,
  depNode: unknown,
  bucket: Map<string, Set<string>>,
): void {
  if (typeof depNode !== "object" || depNode === null) {
    return;
  }

  const node = depNode as {
    name?: string;
    version?: string;
    dependencies?: Record<string, unknown> | unknown[];
  };
  const effectiveName = typeof node.name === "string" ? node.name : depName;
  if (typeof node.version === "string" && effectiveName) {
    const set = bucket.get(effectiveName) ?? new Set<string>();
    set.add(node.version);
    bucket.set(effectiveName, set);
  }

  const deps = node.dependencies;
  if (Array.isArray(deps)) {
    for (const child of deps) {
      collectNodeVersions("", child, bucket);
    }
    return;
  }
  if (!deps || typeof deps !== "object") {
    return;
  }
  for (const [childName, childNode] of Object.entries(deps)) {
    collectNodeVersions(childName, childNode, bucket);
  }
}

function collectProjectDependencyVersions(
  project: unknown,
  versionSets: Map<string, Set<string>>,
): void {
  if (typeof project !== "object" || project === null) {
    return;
  }
  const deps = (project as { dependencies?: Record<string, unknown> })
    .dependencies;
  if (!deps || typeof deps !== "object") {
    return;
  }
  for (const [depName, depNode] of Object.entries(deps)) {
    collectNodeVersions(depName, depNode, versionSets);
  }
}

export async function readTransitiveVersionMap(
  repoPath: string,
): Promise<Map<string, string>> {
  try {
    const { stdout } = await execFileAsync(
      "pnpm",
      ["ls", "--json", "--depth", "Infinity"],
      { cwd: repoPath, maxBuffer: 1024 * 1024 * 20 },
    );
    const parsed = JSON.parse(stdout) as unknown;
    const projects = Array.isArray(parsed) ? parsed : [parsed];
    const versionSets = new Map<string, Set<string>>();

    for (const project of projects) {
      collectProjectDependencyVersions(project, versionSets);
    }

    const collapsed = new Map<string, string>();
    for (const [dep, versions] of versionSets.entries()) {
      const ordered = [...versions].sort((a, b) => a.localeCompare(b));
      if (ordered.length === 1) {
        collapsed.set(dep, ordered[0] ?? "");
      } else if (ordered.length > 1) {
        collapsed.set(dep, ordered.join(" | "));
      }
    }
    return collapsed;
  } catch {
    return new Map();
  }
}

export async function readLatestTwoStructuredReports(
  slug: string,
): Promise<[StructuredReport | null, StructuredReport | null]> {
  const reportsDir = path.resolve(process.cwd(), "data", slug, "reports");
  let entries: string[] = [];
  try {
    entries = (await readdir(reportsDir)).filter((name) =>
      name.endsWith(".json"),
    );
  } catch {
    return [null, null];
  }

  const [latestName, previousName] = entries.sort((a, b) => b.localeCompare(a));
  if (!latestName) {
    return [null, null];
  }

  const latest = await readJsonIfPresent<StructuredReport>(
    path.join(reportsDir, latestName),
  );
  const previous = previousName
    ? await readJsonIfPresent<StructuredReport>(
        path.join(reportsDir, previousName),
      )
    : null;

  return [latest, previous];
}
