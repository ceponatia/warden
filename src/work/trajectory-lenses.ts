import fs from "node:fs/promises";
import path from "node:path";
import type { TrajectoryGraph } from "../types/trajectory.js";
import { callProvider } from "../agents/provider.js";

export interface ProjectStateLensOptions {
  maxNodes: number;
  hideClosedOlderThanDays: number;
  collapseByTag: boolean;
}

export async function generateProjectStateLens(
  graph: TrajectoryGraph,
): Promise<string> {
  const agentPromptPath = path.join(process.cwd(), ".github", "agents", "trajectory-telescope.agent.md");
  const systemPrompt = await fs.readFile(agentPromptPath, "utf-8");
  
  const userPrompt = `
FULL PROJECT TRAJECTORY (JSON):
${JSON.stringify(graph, null, 2)}

Generate the Macro Visionary (Telescope) view in Mermaid syntax.`;

  return await callProvider({
    systemPrompt,
    userPrompt,
    maxTokens: 2048,
  });
}

export async function generateLocalImpactLens(
  graph: TrajectoryGraph,
  prDiff: string,
  prTitle: string,
  prBody: string,
): Promise<string> {
  const agentPromptPath = path.join(process.cwd(), ".github", "agents", "trajectory-microscope.agent.md");
  const systemPrompt = await fs.readFile(agentPromptPath, "utf-8");
  
  const userPrompt = `
PR Title: ${prTitle}
PR Body: ${prBody || "None"}
PR Diff: ${prDiff.slice(0, 8000)}

FULL PROJECT TRAJECTORY (JSON):
${JSON.stringify(graph, null, 2)}

Generate the Contextual Neighborhood (Microscope) view in Mermaid syntax.`;

  return await callProvider({
    systemPrompt,
    userPrompt,
    maxTokens: 2048,
  });
}

export function pruneArchive(
  graph: TrajectoryGraph,
  policy: { fullFidelityMonths: number; maxNodes: number },
): { pruned: TrajectoryGraph; removedCount: number } {
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - policy.fullFidelityMonths);
  const cutoffIso = cutoff.toISOString();

  // Remove closed nodes older than fullFidelityMonths
  let nodes = graph.nodes.filter(
    (n) => n.status !== "closed" || n.updatedAt >= cutoffIso,
  );

  // Hard cap at maxNodes (keep newest by updatedAt)
  if (nodes.length > policy.maxNodes) {
    nodes.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    nodes = nodes.slice(0, policy.maxNodes);
  }

  const nodeIds = new Set(nodes.map((n) => n.id));
  const edges = graph.edges.filter(
    (e) => nodeIds.has(e.from) && nodeIds.has(e.to),
  );

  return {
    pruned: { ...graph, nodes, edges },
    removedCount: graph.nodes.length - nodes.length,
  };
}

