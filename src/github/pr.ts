import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

import type { RepoConfig } from "../types/snapshot.js";
import type { WorkDocument } from "../types/work.js";
import { runCommand } from "../collectors/utils.js";
import { createGithubClient } from "./client.js";

function inferAgentName(doc: WorkDocument): string {
  return doc.assignedTo ?? "lint-fix-agent";
}

function buildPrTitle(doc: WorkDocument): string {
  const summary = doc.notes.at(-1)?.text ?? doc.code;
  return `[Warden] ${inferAgentName(doc)}: ${doc.code} - ${summary.slice(0, 72)}`;
}

function buildPrBody(doc: WorkDocument): string {
  const validation = doc.validationResult;
  return [
    "## Warden Automated Fix",
    "",
    `**Agent:** ${inferAgentName(doc)}`,
    `**Finding:** ${doc.code}`,
    `**Severity:** ${doc.severity}`,
    doc.path ? `**File:** ${doc.path}` : "",
    "",
    "### Validation",
    `- TypeScript/Lint: ${validation?.passed ? "passed" : "failed"}`,
    `- Attempts: ${validation?.attempts ?? 0}`,
    validation?.lastError
      ? `- Last error: ${validation.lastError.slice(0, 280)}`
      : "",
    "",
    "### Context",
    `- First seen: ${doc.firstSeen}`,
    `- Consecutive reports: ${doc.consecutiveReports}`,
    `- Trend: ${doc.trend}`,
    "",
    "---",
    "This PR was created automatically by Warden.",
  ]
    .filter(Boolean)
    .join("\n");
}

async function appendPrRecord(
  slug: string,
  data: Record<string, unknown>,
): Promise<void> {
  const target = path.resolve(
    process.cwd(),
    "data",
    slug,
    "github",
    "pull-requests.jsonl",
  );
  await mkdir(path.dirname(target), { recursive: true });
  await appendFile(target, `${JSON.stringify(data)}\n`, "utf8");
}

export async function pushBranchAndCreatePullRequest(params: {
  config: RepoConfig;
  doc: WorkDocument;
  sourceBranch: string;
  targetBranch: string;
}): Promise<{ prUrl: string; number: number } | null> {
  const github = params.config.github;
  if (!github || params.config.source !== "github") {
    return null;
  }

  await runCommand(
    "git",
    ["push", "-u", "origin", params.sourceBranch],
    params.config.path,
  );
  const client = await createGithubClient();
  const pr = await client.pulls.create({
    owner: github.owner,
    repo: github.repo,
    title: buildPrTitle(params.doc),
    head: params.sourceBranch,
    base: params.targetBranch,
    body: buildPrBody(params.doc),
    draft: true,
    maintainer_can_modify: true,
  });

  try {
    await client.issues.addLabels({
      owner: github.owner,
      repo: github.repo,
      issue_number: pr.data.number,
      labels: ["warden", "automated", params.doc.severity],
    });
  } catch {
    // Labels are optional and may not exist in target repositories.
  }

  await appendPrRecord(params.config.slug, {
    createdAt: new Date().toISOString(),
    number: pr.data.number,
    url: pr.data.html_url,
    sourceBranch: params.sourceBranch,
    targetBranch: params.targetBranch,
    findingId: params.doc.findingId,
    findingCode: params.doc.code,
    agent: inferAgentName(params.doc),
  });

  return {
    prUrl: pr.data.html_url,
    number: pr.data.number,
  };
}
