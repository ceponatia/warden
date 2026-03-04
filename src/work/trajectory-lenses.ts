import fs from "node:fs/promises";
import path from "node:path";
import type { TrajectoryGraph } from "../types/trajectory.js";
import { callProvider } from "../agents/provider.js";

export interface ProjectStateLensOptions {
  maxNodes: number;
  hideClosedOlderThanDays: number;
  collapseByTag: boolean;
}

const STATUS_PRIORITY: Record<string, number> = {
  opened: 0,
  blocked: 1,
  deferred: 2,
  closed: 3,
};

export function generateProjectStateLens(
  graph: TrajectoryGraph,
  options: Partial<ProjectStateLensOptions> = {},
): TrajectoryGraph {
  const opts: ProjectStateLensOptions = {
    maxNodes: 30,
    hideClosedOlderThanDays: 90,
    collapseByTag: true,
    ...options,
  };

  const cutoffMs = Date.now() - opts.hideClosedOlderThanDays * 86_400_000;
  const cutoffIso = new Date(cutoffMs).toISOString();

  // 1. Filter: remove closed nodes older than threshold
  let nodes = graph.nodes.filter(
    (n) => n.status !== "closed" || n.updatedAt >= cutoffIso,
  );

  // 2. Group by tag collapse (if enabled and still over maxNodes)
  if (opts.collapseByTag && nodes.length > opts.maxNodes) {
    const tagGroups = new Map<string, typeof nodes>();
    const ungrouped: typeof nodes = [];

    for (const node of nodes) {
      const primaryTag = node.tags[0];
      if (primaryTag) {
        const group = tagGroups.get(primaryTag) ?? [];
        group.push(node);
        tagGroups.set(primaryTag, group);
      } else {
        ungrouped.push(node);
      }
    }

    const collapsed: typeof nodes = [];
    for (const [tag, group] of tagGroups) {
      if (group.length <= 1) {
        collapsed.push(...group);
      } else {
        // Collapse: pick most severe status, newest date
        const bestStatus = group.reduce(
          (best, n) =>
            (STATUS_PRIORITY[n.status] ?? 3) < (STATUS_PRIORITY[best] ?? 3)
              ? n.status
              : best,
          "closed" as string,
        );
        const newestDate = group.reduce(
          (best, n) => (n.updatedAt > best ? n.updatedAt : best),
          group[0]?.updatedAt ?? new Date().toISOString(),
        );
        collapsed.push({
          id: `group-${tag}`,
          title: `${tag} (${group.length} items)`,
          status: bestStatus as "opened" | "closed" | "blocked" | "deferred",
          type: "group",
          createdAt: group[0]?.createdAt ?? new Date().toISOString(),
          updatedAt: newestDate,
          findingRefs: [],
          workRefs: [],
          tags: [tag],
          affectsModules: [],
          metadata: { collapsedIds: group.map((n) => n.id) },
        });
      }
    }
    nodes = [...collapsed, ...ungrouped];
  }

  // 3. Prune: if still > maxNodes, sort by priority then trim
  if (nodes.length > opts.maxNodes) {
    nodes.sort((a, b) => {
      const pa = STATUS_PRIORITY[a.status] ?? 3;
      const pb = STATUS_PRIORITY[b.status] ?? 3;
      if (pa !== pb) return pa - pb;
      return b.updatedAt.localeCompare(a.updatedAt);
    });
    nodes = nodes.slice(0, opts.maxNodes);
  }

  // 4. Rebuild edges for remaining nodes
  const nodeIds = new Set(nodes.map((n) => n.id));
  const edges = graph.edges.filter(
    (e) => nodeIds.has(e.from) && nodeIds.has(e.to),
  );

  return {
    ...graph,
    nodes,
    edges,
  };
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

export async function generateTrajectorySummary(
  fullGraph: TrajectoryGraph,
  lensGraph: TrajectoryGraph,
): Promise<string> {
  const openCount = lensGraph.nodes.filter((n) => n.status === "opened").length;
  const blockedCount = lensGraph.nodes.filter((n) => n.status === "blocked").length;
  const totalCount = fullGraph.nodes.length;
  const lensCount = lensGraph.nodes.length;

  try {
    const summary = await callProvider({
      systemPrompt:
        "You are a concise project status summarizer. Given trajectory node counts, produce a 1-2 sentence plain-text summary of project health. No markdown.",
      userPrompt: `Project trajectory: ${totalCount} total nodes, ${lensCount} active/recent. Of those: ${openCount} open, ${blockedCount} blocked. Node titles: ${lensGraph.nodes.map((n) => `${n.title} [${n.status}]`).join(", ")}`,
      maxTokens: 150,
    });
    return summary.trim();
  } catch (error) {
    console.error("Failed to generate trajectory summary:", error);
    return "";
  }
}

const MAX_DIFF_CHARS = 8000;

export async function generateLocalImpactLens(
  graph: TrajectoryGraph,
  prDiff: string,
  prTitle: string,
  prBody: string,
  hops: number = 2,
): Promise<TrajectoryGraph | null> {
  const truncatedDiff = prDiff.slice(0, MAX_DIFF_CHARS);

  let modules: string[];
  try {
    const agentPromptPath = path.join(process.cwd(), ".github", "agents", "trajectory-impact.agent.md");
    const systemPrompt = await fs.readFile(agentPromptPath, "utf-8");
    const responseText = await callProvider({
      systemPrompt,
      userPrompt: `PR Title: ${prTitle}\nPR Body: ${prBody || "None"}\n\nDiff (truncated):\n${truncatedDiff}\n\nReturn a JSON array of module/area names affected. Return ONLY JSON.`,
      maxTokens: 256,
    });
    const cleanJson = responseText.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    modules = JSON.parse(cleanJson);
    if (!Array.isArray(modules) || modules.length === 0) {
      return null;
    }
  } catch (error) {
    console.error("Failed to generate local impact lens:", error);
    return null;
  }

  const matchedNodeIds = new Set<string>();
  for (const node of graph.nodes) {
    const moduleMatch = node.affectsModules?.some((m: string) =>
      modules.some((mod) => m.toLowerCase().includes(mod.toLowerCase())),
    );
    const titleMatch = modules.some((mod) =>
      node.title.toLowerCase().includes(mod.toLowerCase()),
    );
    const tagMatch = node.tags.some((tag: string) =>
      modules.some((mod) => tag.toLowerCase().includes(mod.toLowerCase())),
    );
    if (moduleMatch || titleMatch || tagMatch) {
      matchedNodeIds.add(node.id);
    }
  }

  if (matchedNodeIds.size === 0) return null;

  const adjacency = buildAdjacency(graph);
  const collected = new Set<string>(matchedNodeIds);
  let frontier = new Set<string>(matchedNodeIds);
  for (let hop = 0; hop < hops; hop++) {
    const nextFrontier = new Set<string>();
    for (const nodeId of frontier) {
      for (const neighbor of adjacency.get(nodeId) ?? []) {
        if (!collected.has(neighbor)) {
          collected.add(neighbor);
          nextFrontier.add(neighbor);
        }
      }
    }
    frontier = nextFrontier;
  }

  return {
    ...graph,
    nodes: graph.nodes.filter((n) => collected.has(n.id)),
    edges: graph.edges.filter((e) => collected.has(e.from) && collected.has(e.to)),
  };
}

function buildAdjacency(graph: TrajectoryGraph): Map<string, string[]> {
  const adj = new Map<string, string[]>();
  for (const edge of graph.edges) {
    adj.set(edge.from, [...(adj.get(edge.from) ?? []), edge.to]);
    adj.set(edge.to, [...(adj.get(edge.to) ?? []), edge.from]);
  }
  return adj;
}
