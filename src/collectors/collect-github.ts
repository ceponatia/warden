import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";

import type {
  GitHubBranchEntry,
  GitHubCiRunEntry,
  GitHubPrEntry,
  GitHubSnapshot,
  RepoConfig,
} from "../types/snapshot.js";

const execFile = promisify(execFileCb);

interface GitHubApiPr {
  number: number;
  title: string;
  user: { login: string };
  created_at: string;
  updated_at: string;
  draft: boolean;
}

interface GitHubApiBranch {
  name: string;
  protected: boolean;
  commit: { commit: { author: { date: string } } };
}

interface GitHubApiWorkflowRun {
  name: string;
  conclusion: string | null;
  created_at: string;
}

function daysSince(dateStr: string): number {
  const ms = Date.now() - new Date(dateStr).getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

async function ghApi<T>(endpoint: string, token: string): Promise<T> {
  const { stdout } = await execFile("curl", [
    "-sf",
    "-H",
    `Authorization: Bearer ${token}`,
    "-H",
    "Accept: application/vnd.github+json",
    "-H",
    "X-GitHub-Api-Version: 2022-11-28",
    `https://api.github.com${endpoint}`,
  ]);
  return JSON.parse(stdout) as T;
}

export async function collectGitHub(
  config: RepoConfig,
): Promise<GitHubSnapshot> {
  const collectedAt = new Date().toISOString();
  const token = process.env["GITHUB_TOKEN"] ?? "";
  const repo = config.githubRepo;

  const empty: GitHubSnapshot = {
    collectedAt,
    branch: "",
    summary: {
      openPrs: 0,
      stalePrs: 0,
      staleBranches: 0,
      ciRunsAnalyzed: 0,
      ciFailureRatePct: 0,
    },
    stalePrs: [],
    staleBranches: [],
    recentCiRuns: [],
  };

  if (!token || !repo) {
    return empty;
  }

  const { stalePrDays, staleBranchDays } = config.thresholds;

  const [rawPrs, rawBranches, rawRuns] = await Promise.all([
    ghApi<GitHubApiPr[]>(`/repos/${repo}/pulls?state=open&per_page=100`, token),
    ghApi<GitHubApiBranch[]>(
      `/repos/${repo}/branches?per_page=100`,
      token,
    ),
    ghApi<{ workflow_runs: GitHubApiWorkflowRun[] }>(
      `/repos/${repo}/actions/runs?per_page=50`,
      token,
    ),
  ]);

  const allPrs: GitHubPrEntry[] = rawPrs.map((pr) => ({
    number: pr.number,
    title: pr.title,
    author: pr.user.login,
    createdAt: pr.created_at,
    updatedAt: pr.updated_at,
    daysSinceUpdate: daysSince(pr.updated_at),
    isDraft: pr.draft,
  }));

  const stalePrs = allPrs.filter(
    (pr) => pr.daysSinceUpdate >= stalePrDays,
  );

  const staleBranches: GitHubBranchEntry[] = rawBranches
    .map((b) => ({
      name: b.name,
      lastCommitDate: b.commit.commit.author.date,
      daysSinceCommit: daysSince(b.commit.commit.author.date),
      isProtected: b.protected,
    }))
    .filter((b) => b.daysSinceCommit >= staleBranchDays && !b.isProtected);

  const recentCiRuns: GitHubCiRunEntry[] = (
    rawRuns.workflow_runs ?? []
  ).map((run) => ({
    workflowName: run.name,
    conclusion: run.conclusion ?? "unknown",
    runAt: run.created_at,
  }));

  const completedRuns = recentCiRuns.filter(
    (r) => r.conclusion !== "unknown",
  );
  const failedRuns = completedRuns.filter(
    (r) => r.conclusion === "failure",
  );
  const ciFailureRatePct =
    completedRuns.length > 0
      ? Math.round((failedRuns.length / completedRuns.length) * 100)
      : 0;

  return {
    collectedAt,
    branch: "",
    summary: {
      openPrs: allPrs.length,
      stalePrs: stalePrs.length,
      staleBranches: staleBranches.length,
      ciRunsAnalyzed: completedRuns.length,
      ciFailureRatePct,
    },
    stalePrs,
    staleBranches,
    recentCiRuns,
  };
}
