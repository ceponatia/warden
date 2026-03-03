import { createGithubClient } from "../github/client.js";
import { callProvider } from "../agents/provider.js";
import { TrajectoryStore } from "./trajectory-store.js";
import { exportMermaidTrajectory } from "./trajectory-vizvibe.js";
import type { PatchOperation } from "../types/trajectory.js";
import fs from "node:fs/promises";
import path from "node:path";

export async function syncTrajectoryWithPullRequest(
  owner: string,
  repo: string,
  prNumber: number,
  repoSlug: string,
): Promise<void> {
  const octokit = await createGithubClient();
  const store = new TrajectoryStore(repoSlug);
  
  // 1. Fetch PR details
  const { data: pr } = await octokit.pulls.get({
    owner,
    repo,
    pull_number: prNumber,
  });

  if (!pr.merged) {
    console.log(`PR #${prNumber} is not merged. Skipping trajectory sync.`);
    return;
  }

  // 2. Load current trajectory state and agent instructions
  const graph = await store.load();
  const agentDocPath = path.join(process.cwd(), ".github", "agents", "trajectory.agent.md");
  const systemPrompt = await fs.readFile(agentDocPath, "utf-8");

  // 3. Formulate the user prompt
  const userPrompt = `
CURRENT TRAJECTORY GRAPH:
${JSON.stringify(graph.nodes.map(n => ({ id: n.id, title: n.title, status: n.status })), null, 2)}

MERGED PULL REQUEST #${prNumber}:
Title: ${pr.title}
Body:
${pr.body || "No description provided."}

Return a valid JSON array of PatchOperations to update the trajectory graph based on this PR. Return ONLY JSON.`;

  // 4. Call the AI Provider (defaults to GitHub Models if no env var is set)
  console.log(`Analyzing PR #${prNumber} with AI Provider...`);
  const responseText = await callProvider({
    systemPrompt,
    userPrompt,
    maxTokens: 1024,
  });

  // 5. Parse and apply patch
  try {
    const cleanJson = responseText.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const operations: PatchOperation[] = JSON.parse(cleanJson);
    
    if (operations.length === 0) {
      console.log("AI suggested no changes to the trajectory.");
      return;
    }

    console.log(`Applying ${operations.length} patch operations...`);
    await store.patch(`github-pr-${prNumber}`, operations);

    // 6. Re-export Mermaid file
    const updatedGraph = await store.load();
    const mmd = exportMermaidTrajectory(updatedGraph);
    await fs.writeFile(path.join(process.cwd(), "vizvibe.mmd"), mmd, "utf-8");
    
    console.log(`Successfully synced trajectory and exported vizvibe.mmd`);
  } catch (error) {
    console.error("Failed to parse or apply AI patch operations:");
    console.error(responseText);
    throw error;
  }
}
