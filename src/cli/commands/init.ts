import { mkdir, stat } from "node:fs/promises";
import path from "node:path";

import { upsertRepoConfig } from "../../config/loader.js";
import {
  generateDefaultScopeFile,
  getDefaultScopeFilePath,
} from "../../config/scope.js";
import { DEFAULT_THRESHOLDS } from "../../config/schema.js";
import { readGitIgnore, runCommand } from "../../collectors/utils.js";
import type { RepoConfig } from "../../types/snapshot.js";

function toSlug(repoPath: string): string {
  return path
    .basename(repoPath)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-");
}

async function exists(absolutePath: string): Promise<boolean> {
  try {
    await stat(absolutePath);
    return true;
  } catch {
    return false;
  }
}

async function detectType(repoPath: string): Promise<string> {
  const indicators = {
    packageJson: await exists(path.resolve(repoPath, "package.json")),
    pnpmWorkspace: await exists(path.resolve(repoPath, "pnpm-workspace.yaml")),
    tsconfig: await exists(path.resolve(repoPath, "tsconfig.json")),
    cargo: await exists(path.resolve(repoPath, "Cargo.toml")),
    pyproject: await exists(path.resolve(repoPath, "pyproject.toml")),
    gomod: await exists(path.resolve(repoPath, "go.mod")),
  };

  if (indicators.packageJson && indicators.pnpmWorkspace) {
    return "typescript/pnpm-monorepo";
  }
  if (indicators.packageJson && indicators.tsconfig) {
    return "typescript/node";
  }
  if (indicators.cargo) {
    return "rust";
  }
  if (indicators.pyproject) {
    return "python";
  }
  if (indicators.gomod) {
    return "go";
  }

  return "unknown";
}

async function detectSourceRoots(repoPath: string): Promise<string[]> {
  const candidates = ["src", "apps", "packages", "lib", "services"];
  const found = await Promise.all(
    candidates.map(async (candidate) => {
      const absolute = path.resolve(repoPath, candidate);
      return (await exists(absolute)) ? candidate : null;
    }),
  );

  const roots = found.filter((item): item is string => Boolean(item));
  return roots.length > 0 ? roots : ["src"];
}

async function detectDocFiles(repoPath: string): Promise<string[]> {
  const candidates = ["AGENTS.md", "README.md"];
  const found = await Promise.all(
    candidates.map(async (candidate) => {
      const absolute = path.resolve(repoPath, candidate);
      return (await exists(absolute)) ? candidate : null;
    }),
  );

  return found.filter((item): item is string => Boolean(item));
}

function detectTestPatterns(): string[] {
  return [
    "**/__tests__/**",
    "**/*.test.ts",
    "**/*.test.tsx",
    "**/*.spec.ts",
    "**/*.spec.tsx",
  ];
}

export async function runInitCommand(targetPath: string): Promise<void> {
  const repoPath = path.resolve(process.cwd(), targetPath);
  const slug = toSlug(repoPath);

  await runCommand("git", ["rev-parse", "--git-dir"], repoPath);

  const [type, sourceRoots, docFiles, gitIgnorePatterns] = await Promise.all([
    detectType(repoPath),
    detectSourceRoots(repoPath),
    detectDocFiles(repoPath),
    readGitIgnore(repoPath),
  ]);

  const ignorePatterns = [
    ...new Set(["node_modules", "dist", ".next", ...gitIgnorePatterns]),
  ];
  const scopeFile = `config/${slug}.scope`;

  const config: RepoConfig = {
    slug,
    path: repoPath,
    type,
    sourceRoots,
    testPatterns: detectTestPatterns(),
    docFiles,
    ignorePatterns,
    scopeFile,
    thresholds: { ...DEFAULT_THRESHOLDS },
  };

  await upsertRepoConfig(config);
  await generateDefaultScopeFile(
    getDefaultScopeFilePath(slug),
    gitIgnorePatterns,
  );

  const snapshotsPath = path.resolve(process.cwd(), "data", slug, "snapshots");
  const reportsPath = path.resolve(process.cwd(), "data", slug, "reports");

  await mkdir(snapshotsPath, { recursive: true });
  await mkdir(reportsPath, { recursive: true });

  process.stdout.write(`Initialized ${slug} at ${repoPath}\n`);
  process.stdout.write(`  Type: ${type}\n`);
  process.stdout.write(
    `  Source roots: ${sourceRoots.join(", ") || "(none detected)"}\n`,
  );
  process.stdout.write(`  Test patterns: ${config.testPatterns.join(", ")}\n`);
  process.stdout.write(
    `  Doc files: ${docFiles.join(", ") || "(none detected)"}\n`,
  );
  process.stdout.write(`  Scope file: ${scopeFile}\n`);
  process.stdout.write(`  Config written to config/repos.json\n`);
}
