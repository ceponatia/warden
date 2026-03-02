import { TrajectoryGraph, TrajectoryNode, TrajectoryEdge, TrajectoryNodeStatus } from '../types/trajectory.js';

export function parseMermaidTrajectory(mmd: string, repoSlug: string): TrajectoryGraph {
  const lines = mmd.split('\n');
  const nodes: TrajectoryNode[] = [];
  const edges: TrajectoryEdge[] = [];
  const now = new Date().toISOString();

  // Simple regex for Mermaid nodes: id("title") or id("title<br/><sub>sub</sub>")
  const nodeRegex = /^\s*([a-zA-Z0-9_-]+)\("([^"]+)"\)/;
  // Simple regex for Mermaid edges: id1 --> id2 or id1 -.-> id2
  const edgeRegex = /^\s*([a-zA-Z0-9_-]+)\s*(-{2,}|-\.{1,}-)>\s*([a-zA-Z0-9_-]+)/;
  // Metadata comment: %% @id [status, type]
  const metaRegex = /%%\s*@([a-zA-Z0-9_-]+)\s*\[([^\]]+)\]/;

  const metaMap = new Map<string, { status: TrajectoryNodeStatus; type: string }>();

  for (const line of lines) {
    const metaMatch = line.match(metaRegex);
    if (metaMatch && metaMatch[1] && metaMatch[2]) {
      const parts = metaMatch[2].split(',').map(s => s.trim());
      metaMap.set(metaMatch[1], {
        type: parts[0] || 'task',
        status: (parts[1] === 'closed' ? 'closed' : 'opened') as TrajectoryNodeStatus,
      });
      continue;
    }

    const nodeMatch = line.match(nodeRegex);
    if (nodeMatch && nodeMatch[1] && nodeMatch[2]) {
      const id = nodeMatch[1];
      const title = nodeMatch[2].replace(/<br\/><sub>.*<\/sub>/g, '').trim();
      const meta = metaMap.get(id);
      
      nodes.push({
        id,
        title,
        status: meta?.status || 'opened',
        type: meta?.type || 'task',
        createdAt: now,
        updatedAt: now,
        findingRefs: [],
        workRefs: [],
        tags: [],
        metadata: {},
      });
      continue;
    }

    const edgeMatch = line.match(edgeRegex);
    if (edgeMatch && edgeMatch[1] && edgeMatch[3]) {
      edges.push({
        from: edgeMatch[1],
        to: edgeMatch[3],
        kind: line.includes('-.->') ? 'planned' : 'blocks',
        metadata: {},
      });
    }
  }

  return {
    version: 1,
    repoSlug,
    nodes,
    edges,
    meta: {
      revision: 0,
      updatedAt: now,
    },
  };
}

export function exportMermaidTrajectory(graph: TrajectoryGraph): string {
  let mmd = 'flowchart TD\n';
  
  // 1. Comments with metadata
  for (const node of graph.nodes) {
    mmd += `    %% @${node.id} [${node.type}, ${node.status}]\n`;
  }
  
  mmd += '\n';

  // 2. Nodes
  for (const node of graph.nodes) {
    mmd += `    ${node.id}("${node.title}")\n`;
  }

  mmd += '\n';

  // 3. Edges
  for (const edge of graph.edges) {
    const arrow = edge.kind === 'planned' ? '-.->' : '-->';
    mmd += `    ${edge.from} ${arrow} ${edge.to}\n`;
  }

  return mmd;
}
