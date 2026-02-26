import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import * as vscode from "vscode";

import type { RepoSettings, Severity } from "./types";

interface RepoConfigEntry {
  slug: string;
  path?: string;
}

const DEFAULT_SEVERITIES: Severity[] = ["S0", "S1", "S2", "S3"];

async function readRepoConfigEntries(
  workspaceRoot: string,
): Promise<RepoConfigEntry[]> {
  const filePath = path.join(workspaceRoot, "config", "repos.json");
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as RepoConfigEntry[]) : [];
  } catch {
    return [];
  }
}

async function detectRepoSlug(
  workspaceRoot: string,
  dataPath: string,
): Promise<string | undefined> {
  const configured = await readRepoConfigEntries(workspaceRoot);
  const workspaceFromConfig = configured.find(
    (entry) => entry.path && path.resolve(entry.path) === workspaceRoot,
  );
  if (workspaceFromConfig?.slug) {
    return workspaceFromConfig.slug;
  }

  const dataRoot = path.resolve(workspaceRoot, dataPath);
  try {
    const slugs = (await readdir(dataRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    if (slugs.length === 1) {
      return slugs[0];
    }
  } catch {
    return undefined;
  }

  return undefined;
}

export async function loadRepoSettings(): Promise<RepoSettings | null> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    return null;
  }

  const workspaceRoot = folder.uri.fsPath;
  const config = vscode.workspace.getConfiguration("warden");
  const dataPath = config.get<string>("dataPath", "data");
  const autoRefresh = config.get<boolean>("autoRefresh", true);

  const configuredSlug = config.get<string>("repoSlug", "auto-detect");
  const normalized = configuredSlug.trim();
  const repoSlug =
    normalized && normalized !== "auto-detect"
      ? normalized
      : ((await detectRepoSlug(workspaceRoot, dataPath)) ?? "");

  if (!repoSlug) {
    return null;
  }

  const levels = config.get<Severity[]>("severityFilter", DEFAULT_SEVERITIES);
  const severityFilter = new Set<Severity>(levels);

  const repoConfigEntries = await readRepoConfigEntries(workspaceRoot);
  const matchedEntry = repoConfigEntries.find(
    (entry) => entry.slug === repoSlug,
  );

  return {
    workspaceRoot,
    dataPath,
    repoSlug,
    autoRefresh,
    severityFilter,
    repoRoot: matchedEntry?.path,
  };
}
