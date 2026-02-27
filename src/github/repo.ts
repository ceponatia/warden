import { mkdir, stat } from "node:fs/promises";
import path from "node:path";

import { runCommand, runCommandSafe } from "../collectors/utils.js";

export interface GithubRepoRef {
  owner: string;
  repo: string;
}

export function parseGithubRepoSpec(spec: string): GithubRepoRef {
  const trimmed = spec.replace(/^github:/, "").trim();
  const match = trimmed.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
  if (!match?.[1] || !match[2]) {
    throw new Error("Invalid GitHub repo spec. Expected github:owner/repo");
  }

  return {
    owner: match[1],
    repo: match[2],
  };
}

export function buildGithubClonePath(slug: string): string {
  return path.resolve(process.cwd(), "data", slug, "clone");
}

async function exists(absolutePath: string): Promise<boolean> {
  try {
    await stat(absolutePath);
    return true;
  } catch {
    return false;
  }
}

export async function ensureGithubClone(params: {
  owner: string;
  repo: string;
  slug: string;
}): Promise<string> {
  const clonePath = buildGithubClonePath(params.slug);
  const remoteUrl = `https://github.com/${params.owner}/${params.repo}.git`;

  if (await exists(path.join(clonePath, ".git"))) {
    await runCommand("git", ["fetch", "origin"], clonePath);
    await runCommand(
      "git",
      ["pull", "--ff-only", "origin", "main"],
      clonePath,
    ).catch(async () => {
      const branchResult = await runCommandSafe(
        "git",
        ["symbolic-ref", "refs/remotes/origin/HEAD"],
        clonePath,
      );
      const branch =
        branchResult.exitCode === 0
          ? branchResult.stdout.trim().replace("refs/remotes/origin/", "")
          : "main";
      await runCommand(
        "git",
        ["pull", "--ff-only", "origin", branch],
        clonePath,
      );
    });

    return clonePath;
  }

  await mkdir(path.dirname(clonePath), { recursive: true });
  await runCommand(
    "git",
    ["clone", "--depth", "1", remoteUrl, clonePath],
    process.cwd(),
  );
  return clonePath;
}

export async function syncGithubClone(repoPath: string): Promise<void> {
  const branchResult = await runCommandSafe(
    "git",
    ["symbolic-ref", "refs/remotes/origin/HEAD"],
    repoPath,
  );
  const defaultBranch =
    branchResult.exitCode === 0
      ? branchResult.stdout.trim().replace("refs/remotes/origin/", "")
      : "main";

  await runCommand("git", ["fetch", "origin"], repoPath);
  await runCommand("git", ["checkout", defaultBranch], repoPath);
  await runCommand(
    "git",
    ["pull", "--ff-only", "origin", defaultBranch],
    repoPath,
  );
}
