import { chmod, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { runAnalyzeCommand } from "./analyze.js";
import { runCollectCommand } from "./collect.js";
import { getRepoConfigBySlug, loadRepoConfigs } from "../../config/loader.js";
import { runCommand } from "../../collectors/utils.js";
import { DEFAULT_COMMIT_THRESHOLD } from "../../config/schema.js";
import type { RepoConfig } from "../../types/snapshot.js";

const HOOK_MARKER_START = "# WARDEN_HOOK_START";
const HOOK_MARKER_END = "# WARDEN_HOOK_END";

interface RepoCounters {
  threshold: number;
  global: number;
  branches: Record<string, number>;
  lastTriggered?: string;
}

interface CounterFile {
  repos: Record<string, RepoCounters>;
}

function getCountersPath(): string {
  return path.resolve(process.cwd(), "data", "counters.json");
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function loadCounters(): Promise<CounterFile> {
  const countersPath = getCountersPath();

  try {
    const raw = await readFile(countersPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<CounterFile>;
    return {
      repos: parsed.repos ?? {},
    };
  } catch (error) {
    const errorWithCode = error as NodeJS.ErrnoException;
    if (errorWithCode.code === "ENOENT") {
      return { repos: {} };
    }
    throw error;
  }
}

async function saveCounters(counters: CounterFile): Promise<void> {
  const countersPath = getCountersPath();
  await mkdir(path.dirname(countersPath), { recursive: true });
  await writeFile(
    countersPath,
    `${JSON.stringify(counters, null, 2)}\n`,
    "utf8",
  );
}

function ensureRepoCounters(
  counters: CounterFile,
  config: RepoConfig,
): RepoCounters {
  const existing = counters.repos[config.slug];
  const threshold = config.commitThreshold || DEFAULT_COMMIT_THRESHOLD;

  if (!existing) {
    const created: RepoCounters = {
      threshold,
      global: 0,
      branches: {},
    };
    counters.repos[config.slug] = created;
    return created;
  }

  existing.threshold = threshold;
  if (!existing.branches) {
    existing.branches = {};
  }
  return existing;
}

function buildHookBlock(config: RepoConfig): string {
  const wardenRoot = process.cwd();
  return [
    HOOK_MARKER_START,
    `# WARDEN_HOOK repo=${config.slug}`,
    `cd "${wardenRoot}" && pnpm warden hook tick --repo "${config.slug}" >/dev/null 2>&1`,
    HOOK_MARKER_END,
  ].join("\n");
}

function stripWardenHookBlock(content: string): string {
  const normalized = content.replace(/\r\n/g, "\n");
  const blockPattern = new RegExp(
    `${HOOK_MARKER_START}[\\s\\S]*?${HOOK_MARKER_END}\\n?`,
    "g",
  );
  return normalized.replace(blockPattern, "").trimEnd();
}

async function installHookForRepo(config: RepoConfig): Promise<void> {
  const hookPath = path.resolve(config.path, ".git", "hooks", "post-commit");
  const hookBlock = buildHookBlock(config);
  const exists = await fileExists(hookPath);

  if (!exists) {
    const content = `#!/bin/sh\n\n${hookBlock}\n`;
    await writeFile(hookPath, content, "utf8");
    await chmod(hookPath, 0o755);
    process.stdout.write(`Installed post-commit hook for ${config.slug}\n`);
  } else {
    const currentContent = await readFile(hookPath, "utf8");
    if (
      currentContent.includes(
        `${HOOK_MARKER_START}\n# WARDEN_HOOK repo=${config.slug}`,
      )
    ) {
      process.stdout.write(`Hook already installed for ${config.slug}\n`);
    } else {
      const withNewline = currentContent.endsWith("\n")
        ? currentContent
        : `${currentContent}\n`;
      await writeFile(hookPath, `${withNewline}\n${hookBlock}\n`, "utf8");
      await chmod(hookPath, 0o755);
      process.stdout.write(`Appended post-commit hook for ${config.slug}\n`);
    }
  }

  const counters = await loadCounters();
  ensureRepoCounters(counters, config);
  await saveCounters(counters);
}

async function uninstallHookForRepo(config: RepoConfig): Promise<void> {
  const hookPath = path.resolve(config.path, ".git", "hooks", "post-commit");
  const exists = await fileExists(hookPath);

  if (exists) {
    const content = await readFile(hookPath, "utf8");
    const updated = stripWardenHookBlock(content);
    const finalContent = updated.length > 0 ? `${updated}\n` : "";
    await writeFile(hookPath, finalContent, "utf8");
    if (finalContent.length > 0) {
      await chmod(hookPath, 0o755);
    }
    process.stdout.write(`Removed Warden hook block from ${config.slug}\n`);
  }

  const counters = await loadCounters();
  if (counters.repos[config.slug]) {
    delete counters.repos[config.slug];
    await saveCounters(counters);
  }
}

async function runHookTick(repoSlug: string): Promise<void> {
  const configs = await loadRepoConfigs();
  const config = getRepoConfigBySlug(configs, repoSlug);

  const branch =
    (
      await runCommand("git", ["branch", "--show-current"], config.path)
    ).trim() || "unknown";

  const counters = await loadCounters();
  const repoCounters = ensureRepoCounters(counters, config);

  repoCounters.global += 1;
  repoCounters.branches[branch] = (repoCounters.branches[branch] ?? 0) + 1;

  const branchCount = repoCounters.branches[branch] ?? 0;
  const threshold = repoCounters.threshold;

  process.stdout.write(
    `Hook tick ${config.slug}@${branch}: ${branchCount}/${threshold} (global ${repoCounters.global})\n`,
  );

  if (branchCount >= threshold) {
    process.stdout.write(
      `Threshold reached for ${config.slug}@${branch}; running collect + analyze...\n`,
    );
    await runCollectCommand(config.slug);
    await runAnalyzeCommand(config.slug);
    repoCounters.branches[branch] = 0;
    repoCounters.lastTriggered = new Date().toISOString();
  }

  await saveCounters(counters);
}

export async function runHookCommand(
  action: "install" | "uninstall" | "tick",
  repoSlug?: string,
): Promise<void> {
  const configs = await loadRepoConfigs();
  if (configs.length === 0) {
    throw new Error("No repos configured. Run 'warden init <path>' first.");
  }

  if (action === "tick") {
    if (!repoSlug) {
      throw new Error("Missing --repo for hook tick");
    }
    await runHookTick(repoSlug);
    return;
  }

  const targets = repoSlug ? [getRepoConfigBySlug(configs, repoSlug)] : configs;

  for (const config of targets) {
    if (action === "install") {
      await installHookForRepo(config);
    } else {
      await uninstallHookForRepo(config);
    }
  }
}
