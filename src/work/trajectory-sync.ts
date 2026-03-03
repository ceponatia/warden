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

  // 2. Load current trajectory state
  const graph = await store.load();

  // 3. Formulate the prompt
  const systemPrompt = `You are a strict, deterministic Trajectory Management Agent.
Your job is to read a merged Pull Request and the current Project Trajectory Graph, and output an array of JSON patch operations to update the graph.

Guidelines:
- If the PR completes an existing 'opened' node, output an 'updateNode' operation to set its status to 'closed'.
- If the PR introduces a new capability not on the graph, use 'addNode' to add it as 'closed', and 'addEdge' to connect it to the relevant parent.
- If the PR mentions future work or TODOs, use 'addNode' to create an 'opened' node, and 'addEdge' to connect it to the newly closed work.
- DO NOT hallucinate nodes.
- Keep node titles under 30 chars and descriptions concise.
- Output ONLY a JSON array of PatchOperation objects matching this TypeScript type:

type PatchOperation =
  | { type: 'addNode'; node: { id: string, title: string, status: 'opened'|'closed', type: string, metadata: any } }
  | { type: 'updateNode'; id: string; updates: any }
  | { type: 'addEdge'; edge: { from: string, to: string, kind: string, metadata: any } }
`;

  const userPrompt = `
CURRENT TRAJECTORY GRAPH:
${JSON.stringify(graph.nodes.map(n => ({ id: n.id, title: n.title, status: n.status })), null, 2)}

MERGED PULL REQUEST #${prNumber}:
Title: ${pr.title}
Body:
${pr.body || "No description provided."}

Return a valid JSON array of PatchOperations to update the trajectory graph based on this PR. Return ONLY JSON.`;

  // 4. Call the cheap/fast model
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
