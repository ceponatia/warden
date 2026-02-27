import { readFile } from "node:fs/promises";
import path from "node:path";

import { resolveFileScope } from "../config/scope.js";
import type {
  DocStalenessSnapshot,
  OrphanedRefEntry,
  RepoConfig,
  ScopeRule,
  StaleDocEntry,
  UndocumentedApiEntry,
} from "../types/snapshot.js";
import { daysBetween, normalizePath, runCommand, runCommandSafe } from "./utils.js";

const SOURCE_FILE_RE = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const DOC_HINT_FILES = new Set([
  "README.md",
  "AGENTS.md",
  "CHANGELOG.md",
  "CONTRIBUTING.md",
  "API.md",
]);

interface DocReference {
  line: number;
  reference: string;
  referenceType: "file" | "function" | "api";
}

interface ExportDecl {
  path: string;
  exportName: string;
  exportType: "function" | "class" | "type" | "interface";
}

function isDocFile(filePath: string): boolean {
  const base = path.basename(filePath);
  return filePath.endsWith(".md") || DOC_HINT_FILES.has(base) || filePath.startsWith("docs/");
}

function parseReferences(markdown: string): DocReference[] {
  const refs: DocReference[] = [];
  const lines = markdown.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const lineNo = index + 1;

    for (const match of line.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
      const ref = match[1];
      if (!ref || /^https?:\/\//.test(ref)) {
        continue;
      }

      refs.push({
        line: lineNo,
        reference: ref.replace(/^\.\//, ""),
        referenceType: "file",
      });
    }

    for (const match of line.matchAll(/`([^`]+)`/g)) {
      const ref = match[1];
      if (!ref) {
        continue;
      }

      if (/\.(ts|tsx|js|jsx|md|json)$/.test(ref) || ref.includes("/")) {
        refs.push({ line: lineNo, reference: ref.replace(/^\.\//, ""), referenceType: "file" });
        continue;
      }

      if (/^[A-Z][A-Za-z0-9_]*$/.test(ref)) {
        refs.push({ line: lineNo, reference: ref, referenceType: "api" });
        continue;
      }

      if (/^[a-z][A-Za-z0-9_]*$/.test(ref)) {
        refs.push({ line: lineNo, reference: ref, referenceType: "function" });
      }
    }
  }

  return refs;
}

function extractExports(sourcePath: string, content: string): ExportDecl[] {
  const out: ExportDecl[] = [];
  const patterns: Array<{
    regex: RegExp;
    exportType: ExportDecl["exportType"];
  }> = [
    { regex: /export\s+function\s+([A-Za-z_][A-Za-z0-9_]*)/g, exportType: "function" },
    { regex: /export\s+class\s+([A-Za-z_][A-Za-z0-9_]*)/g, exportType: "class" },
    { regex: /export\s+type\s+([A-Za-z_][A-Za-z0-9_]*)/g, exportType: "type" },
    { regex: /export\s+interface\s+([A-Za-z_][A-Za-z0-9_]*)/g, exportType: "interface" },
  ];

  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern.regex)) {
      const exportName = match[1];
      if (!exportName) {
        continue;
      }

      out.push({ path: sourcePath, exportName, exportType: pattern.exportType });
    }
  }

  return out;
}

async function listTrackedFiles(config: RepoConfig): Promise<string[]> {
  const output = await runCommand("git", ["ls-files"], config.path);
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => normalizePath(line));
}

function filterScopedDocs(files: string[], scopeRules: ScopeRule[]): string[] {
  return files.filter((filePath) => {
    if (!isDocFile(filePath)) {
      return false;
    }

    const scope = resolveFileScope(filePath, scopeRules);
    return !scope.ignored && scope.metrics.includes("doc-staleness");
  });
}

function sourceFiles(files: string[]): string[] {
  return files.filter((filePath) => SOURCE_FILE_RE.test(filePath));
}

function describedByReadme(docPath: string, sources: string[]): string[] {
  const dir = normalizePath(path.dirname(docPath));
  return sources.filter((source) => source === dir || source.startsWith(`${dir}/`));
}

function resolveRefPath(docPath: string, reference: string): string {
  const baseDir = normalizePath(path.dirname(docPath));
  const joined = normalizePath(path.join(baseDir, reference));
  return joined.replace(/^\.\//, "");
}

function describedByReferences(
  docPath: string,
  refs: DocReference[],
  tracked: Set<string>,
): string[] {
  const described = new Set<string>();
  for (const ref of refs) {
    if (ref.referenceType !== "file") {
      continue;
    }

    const resolved = resolveRefPath(docPath, ref.reference);
    if (tracked.has(resolved)) {
      described.add(resolved);
    }
  }

  return [...described].sort((a, b) => a.localeCompare(b));
}

async function latestCommitDateForPath(
  repoPath: string,
  targetPath: string,
): Promise<string | null> {
  const output = await runCommandSafe(
    "git",
    ["log", "-1", "--format=%aI", "--", targetPath],
    repoPath,
  );
  if (output.exitCode !== 0) {
    return null;
  }

  const line = output.stdout.trim();
  return line.length > 0 ? line : null;
}

async function codeChangesSince(
  repoPath: string,
  sinceIso: string,
  describedPaths: string[],
): Promise<number> {
  if (describedPaths.length === 0) {
    return 0;
  }

  const output = await runCommandSafe(
    "git",
    ["rev-list", "--count", `--since=${sinceIso}`, "HEAD", "--", ...describedPaths],
    repoPath,
  );
  if (output.exitCode !== 0) {
    return 0;
  }

  return Number.parseInt(output.stdout.trim(), 10) || 0;
}

async function latestCodeCommitSince(
  repoPath: string,
  describedPaths: string[],
): Promise<string> {
  if (describedPaths.length === 0) {
    return "";
  }

  const output = await runCommandSafe(
    "git",
    ["log", "-1", "--format=%aI", "--", ...describedPaths],
    repoPath,
  );
  if (output.exitCode !== 0) {
    return "";
  }

  return output.stdout.trim();
}

async function buildStaleDocEntry(
  config: RepoConfig,
  docPath: string,
  describedPaths: string[],
): Promise<StaleDocEntry | null> {
  const lastDocCommit = await latestCommitDateForPath(config.path, docPath);
  if (!lastDocCommit) {
    return null;
  }

  const changes = await codeChangesSince(config.path, lastDocCommit, describedPaths);
  const latestCodeCommit = await latestCodeCommitSince(config.path, describedPaths);
  const daysSinceDocUpdate = daysBetween(lastDocCommit, new Date());

  if (changes <= 0 || daysSinceDocUpdate <= config.thresholds.docStaleDays) {
    return null;
  }

  return {
    docPath,
    lastDocCommit,
    daysSinceDocUpdate,
    describedPaths,
    codeChangesSince: changes,
    latestCodeCommit,
  };
}

async function findOrphanedRefs(
  config: RepoConfig,
  docs: string[],
  tracked: Set<string>,
  sourceBlob: string,
): Promise<OrphanedRefEntry[]> {
  const orphaned: OrphanedRefEntry[] = [];

  for (const docPath of docs) {
    const absolute = path.resolve(config.path, docPath);
    const content = await readFile(absolute, "utf8");
    const refs = parseReferences(content);

    for (const ref of refs) {
      if (ref.referenceType === "file") {
        const resolved = resolveRefPath(docPath, ref.reference);
        if (!tracked.has(resolved)) {
          orphaned.push({
            docPath,
            line: ref.line,
            reference: ref.reference,
            referenceType: "file",
          });
        }
        continue;
      }

      const tokenRegex = new RegExp(`\\b${ref.reference}\\b`);
      if (!tokenRegex.test(sourceBlob)) {
        orphaned.push({
          docPath,
          line: ref.line,
          reference: ref.reference,
          referenceType: ref.referenceType,
        });
      }
    }
  }

  return orphaned;
}

function isPublicSourceFile(filePath: string): boolean {
  const base = path.basename(filePath);
  return base.startsWith("index.") || filePath.includes("/api/") || filePath.includes("/routes/");
}

async function findUndocumentedApis(
  config: RepoConfig,
  sourcePaths: string[],
  docsText: string,
): Promise<UndocumentedApiEntry[]> {
  const undocumented: UndocumentedApiEntry[] = [];

  for (const sourcePath of sourcePaths) {
    if (!isPublicSourceFile(sourcePath)) {
      continue;
    }

    const absolute = path.resolve(config.path, sourcePath);
    const content = await readFile(absolute, "utf8");
    const exports = extractExports(sourcePath, content);

    for (const exported of exports) {
      const tokenRegex = new RegExp(`\\b${exported.exportName}\\b`);
      if (!tokenRegex.test(docsText)) {
        undocumented.push(exported);
      }
    }
  }

  return undocumented;
}

export async function collectDocStaleness(
  config: RepoConfig,
  scopeRules: ScopeRule[],
): Promise<DocStalenessSnapshot> {
  const branch = (
    await runCommand("git", ["rev-parse", "--abbrev-ref", "HEAD"], config.path)
  ).trim();

  const tracked = await listTrackedFiles(config);
  const trackedSet = new Set(tracked);
  const docs = filterScopedDocs(tracked, scopeRules);
  const sources = sourceFiles(tracked);

  const staleDocFiles: StaleDocEntry[] = [];
  const docsContent: string[] = [];
  const sourceContent: string[] = [];

  for (const sourcePath of sources) {
    const content = await readFile(path.resolve(config.path, sourcePath), "utf8");
    sourceContent.push(content);
  }

  for (const docPath of docs) {
    const content = await readFile(path.resolve(config.path, docPath), "utf8");
    docsContent.push(content);

    const refs = parseReferences(content);
    const described =
      path.basename(docPath) === "AGENTS.md"
        ? [...sources]
        : path.basename(docPath) === "README.md"
          ? describedByReadme(docPath, sources)
          : describedByReferences(docPath, refs, trackedSet);

    const staleEntry = await buildStaleDocEntry(config, docPath, described.slice(0, 150));
    if (staleEntry) {
      staleDocFiles.push(staleEntry);
    }
  }

  const orphanedRefs = await findOrphanedRefs(
    config,
    docs,
    trackedSet,
    sourceContent.join("\n"),
  );
  const undocumentedApis = await findUndocumentedApis(
    config,
    sources,
    docsContent.join("\n"),
  );

  staleDocFiles.sort((left, right) => right.daysSinceDocUpdate - left.daysSinceDocUpdate);

  return {
    collectedAt: new Date().toISOString(),
    branch,
    summary: {
      totalDocFiles: docs.length,
      staleDocFiles: staleDocFiles.length,
      orphanedRefs: orphanedRefs.length,
      undocumentedApis: undocumentedApis.length,
    },
    staleDocFiles,
    orphanedRefs,
    undocumentedApis,
  };
}
