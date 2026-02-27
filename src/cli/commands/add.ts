import { mkdir, stat } from "node:fs/promises";
import path from "node:path";

import { upsertRepoConfig } from "../../config/loader.js";
import { ensureStarterAllowlist } from "../../config/allowlist.js";
import {
  generateDefaultScopeFile,
  getDefaultScopeFilePath,
} from "../../config/scope.js";
import {
  DEFAULT_COMMIT_THRESHOLD,
  DEFAULT_RETENTION,
  DEFAULT_THRESHOLDS,
} from "../../config/schema.js";
import { readGitIgnore, runCommand, runCommandSafe } from "../../collectors/utils.js";
import { ensureGithubClone, parseGithubRepoSpec } from "../../github/repo.js";
import type { RepoConfig } from "../../types/snapshot.js";

function toSlug(input: string): string {
  const base = path.basename(input).toLowerCase();
  const slug = base
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "default-slug";
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

async function buildRepoConfigFromPath(params: {
  slug: string;
  repoPath: string;
  source: "local" | "github";
  github?: RepoConfig["github"];
}): Promise<RepoConfig> {
  await runCommand("git", ["rev-parse", "--git-dir"], params.repoPath);

  const [type, sourceRoots, docFiles, gitIgnorePatterns] = await Promise.all([
    detectType(params.repoPath),
    detectSourceRoots(params.repoPath),
    detectDocFiles(params.repoPath),
    readGitIgnore(params.repoPath),
  ]);

  const ignorePatterns = [
    ...new Set(["node_modules", "dist", ".next", ...gitIgnorePatterns]),
  ];
  const scopeFile = `config/${params.slug}.scope`;

  return {
    slug: params.slug,
    path: params.repoPath,
    type,
    source: params.source,
    github: params.github,
    sourceRoots,
    testPatterns: detectTestPatterns(),
    docFiles,
    ignorePatterns,
    scopeFile,
    thresholds: { ...DEFAULT_THRESHOLDS },
    retention: { ...DEFAULT_RETENTION },
    commitThreshold: DEFAULT_COMMIT_THRESHOLD,
  };
}

async function initializeArtifacts(config: RepoConfig): Promise<void> {
  await upsertRepoConfig(config);
  await ensureStarterAllowlist(config);
  const ignorePatterns = await readGitIgnore(config.path);
  await generateDefaultScopeFile(
    getDefaultScopeFilePath(config.slug),
    ignorePatterns,
  );

  const dirs = ["snapshots", "reports", "analyses", "work"];
  await Promise.all(
    dirs.map((name) =>
      mkdir(path.resolve(process.cwd(), "data", config.slug, name), {
        recursive: true,
      }),
    ),
  );
}

async function addLocalRepo(targetPath: string): Promise<void> {
  const repoPath = path.resolve(process.cwd(), targetPath);
  const slug = toSlug(repoPath);
  const config = await buildRepoConfigFromPath({
    slug,
    repoPath,
    source: "local",
  });
  await initializeArtifacts(config);

  process.stdout.write(`Added local repo ${slug} at ${repoPath}\n`);
}

async function addGithubRepo(target: string): Promise<void> {
  const { owner, repo } = parseGithubRepoSpec(target);
  const slug = toSlug(repo);
  const clonePath = await ensureGithubClone({ owner, repo, slug });

  const branchResult = await runCommandSafe(
    "git",
    ["symbolic-ref", "refs/remotes/origin/HEAD"],
    clonePath,
  );
  const defaultBranch =
    branchResult.exitCode === 0
      ? branchResult.stdout.trim().replace("refs/remotes/origin/", "")
      : "main";

  const config = await buildRepoConfigFromPath({
    slug,
    repoPath: clonePath,
    source: "github",
    github: {
      owner,
      repo,
      url: `https://github.com/${owner}/${repo}`,
      defaultBranch,
    },
  });

  await initializeArtifacts(config);

  process.stdout.write(`Added GitHub repo ${owner}/${repo} as ${slug}\n`);
  process.stdout.write(`  Clone path: ${clonePath}\n`);
}

export async function runAddCommand(target: string): Promise<void> {
  if (!target) {
    throw new Error(
      "Missing target argument. Usage: warden add <path|github:owner/repo>",
    );
  }

  if (target.startsWith("github:")) {
    await addGithubRepo(target);
    return;
  }

  await addLocalRepo(target);
}
