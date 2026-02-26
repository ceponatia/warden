import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { shouldIgnore } from "../collectors/utils.js";
import type { RepoConfig } from "../types/snapshot.js";

export interface AllowlistRule {
  code: string;
  entries: string[];
}

export interface ParsedAllowlist {
  path: string;
  rules: AllowlistRule[];
}

function normalizeEntry(entry: string): string {
  return entry.split(path.sep).join("/").trim();
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

export function parseAllowlist(content: string): AllowlistRule[] {
  const lines = content.split(/\r?\n/);
  const map = new Map<string, string[]>();
  let currentCode: string | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const headerMatch = trimmed.match(/^\[(WD-M\d+-\d{3})\]$/i);
    if (headerMatch?.[1]) {
      currentCode = headerMatch[1].toUpperCase();
      if (!map.has(currentCode)) {
        map.set(currentCode, []);
      }
      continue;
    }

    if (currentCode) {
      map.get(currentCode)?.push(normalizeEntry(trimmed));
    }
  }

  return [...map.entries()].map(([code, entries]) => ({ code, entries }));
}

function resolveAllowlistPath(config: RepoConfig): string {
  return path.resolve(process.cwd(), "config", `${config.slug}.allowlist`);
}

function resolveRepoAllowlistPath(config: RepoConfig): string {
  return path.resolve(config.path, ".warden", "allowlist");
}

export async function loadAllowlist(
  config: RepoConfig,
): Promise<ParsedAllowlist> {
  const repoAllowlistPath = resolveRepoAllowlistPath(config);
  const localAllowlistPath = resolveAllowlistPath(config);
  const selectedPath = (await fileExists(repoAllowlistPath))
    ? repoAllowlistPath
    : localAllowlistPath;

  try {
    const raw = await readFile(selectedPath, "utf8");
    return {
      path: selectedPath,
      rules: parseAllowlist(raw),
    };
  } catch (error) {
    const errorWithCode = error as NodeJS.ErrnoException;
    if (errorWithCode.code === "ENOENT") {
      return {
        path: selectedPath,
        rules: [],
      };
    }
    throw error;
  }
}

function matchesAllowlistEntry(
  entry: string,
  findingPath?: string,
  symbol?: string,
): boolean {
  if (!findingPath) {
    return false;
  }

  if (entry.includes(":")) {
    const colonIndex = entry.indexOf(":");
    const entryPath = entry.slice(0, colonIndex);
    const entrySymbol = entry.slice(colonIndex + 1);
    if (!entryPath || !entrySymbol) {
      return false;
    }

    return entryPath === findingPath && entrySymbol === symbol;
  }

  return entry === findingPath;
}

export function isFindingSuppressed(
  config: RepoConfig,
  rules: AllowlistRule[],
  code: string,
  findingPath?: string,
  symbol?: string,
): boolean {
  const normalizedCode = code.toUpperCase();
  const allowlistRule = rules.find((rule) => rule.code === normalizedCode);
  if (
    allowlistRule &&
    allowlistRule.entries.some((entry) =>
      matchesAllowlistEntry(entry, findingPath, symbol),
    )
  ) {
    return true;
  }

  if (!findingPath) {
    return false;
  }

  const suppressions = config.suppressions ?? [];
  return suppressions.some(
    (suppression) =>
      suppression.codes.includes(normalizedCode) &&
      (suppression.pattern === findingPath ||
        shouldIgnore(findingPath, [suppression.pattern])),
  );
}

export async function ensureStarterAllowlist(
  config: RepoConfig,
): Promise<string> {
  const allowlistPath = resolveAllowlistPath(config);
  const exists = await fileExists(allowlistPath);
  if (exists) {
    return allowlistPath;
  }

  const starter = `# ${config.slug} allowlist\n# Lines under each [CODE] block are suppressed paths (or path:symbol).\n\n[WD-M2-002]\n# src/legacy/keep-for-reference.ts\n\n[WD-M6-002]\n# src/safe-interop.ts:externalPayload\n`;

  await writeFile(allowlistPath, starter, "utf8");
  return allowlistPath;
}
