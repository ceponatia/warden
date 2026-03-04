import { TrajectoryGraph, TrajectoryNode, TrajectoryEdge, TrajectoryNodeStatus } from '../types/trajectory.js';

function edgeKindToArrow(kind: string): string {
  switch (kind) {
    case "planned":    return "-.->";
    case "relatesTo":  return "-.->";
    case "supersedes": return "==>";
    case "blocks":     return "-->";
    case "dependsOn":  return "-->";
    default:           return "-->";
  }
}

export function parseMermaidTrajectory(mmd: string, repoSlug: string): TrajectoryGraph {
  const lines = mmd.split('\n');
  const nodes: TrajectoryNode[] = [];
  const edges: TrajectoryEdge[] = [];
  const now = new Date().toISOString();

  // Simple regex for Mermaid nodes: id("title") or id("title<br/><sub>sub</sub>")
  const nodeRegex = /^\s*([a-zA-Z0-9_-]+)\("([^"]+)"\)/;
  // Simple regex for Mermaid edges: id1 --> id2 or id1 -.-> id2
  const edgeRegex = /^\s*([a-zA-Z0-9_-]+)\s*(-{2,}|-\.{1,}-)>\s*([a-zA-Z0-9_-]+)/;
  // Metadata comment: %% @id [status, type, date, author]
  const metaRegex = /%%\s*@([a-zA-Z0-9_-]+)\s*\[([^\]]+)\]/;

  const metaMap = new Map<string, { status: TrajectoryNodeStatus; type: string; date?: string; author?: string }>();

  for (const line of lines) {
    const metaMatch = line.match(metaRegex);
    if (metaMatch && metaMatch[1] && metaMatch[2]) {
      const parts = metaMatch[2].split(',').map(s => s.trim());
      metaMap.set(metaMatch[1], {
        type: parts[0] || 'task',
        status: (parts[1] === 'closed' ? 'closed' : 'opened') as TrajectoryNodeStatus,
        date: parts[2],
        author: parts[3],
      });
      continue;
    }

    const nodeMatch = line.match(nodeRegex);
    if (nodeMatch && nodeMatch[1] && nodeMatch[2]) {
      const id = nodeMatch[1];
      const title = nodeMatch[2].replace(/<br\/><sub>.*<\/sub>/g, '').trim();
      const meta = metaMap.get(id);
      
      const nodeDate = meta?.date ? `${meta.date}T00:00:00.000Z` : now;

      nodes.push({
        id,
        title,
        status: meta?.status || 'opened',
        type: meta?.type || 'task',
        createdAt: nodeDate,
        updatedAt: nodeDate,
        findingRefs: [],
        workRefs: [],
        tags: [],
        affectsModules: [],
        metadata: meta?.author ? { author: meta.author } : {},
      });
      continue;
    }

    const edgeMatch = line.match(edgeRegex);
    if (edgeMatch && edgeMatch[1] && edgeMatch[3]) {
      edges.push({
        from: edgeMatch[1],
        to: edgeMatch[3],
        // Note: round-tripping 'planned' converts to 'relatesTo' (both use -.-> arrow) — known limitation
        kind: line.includes('==>') ? 'supersedes' : line.includes('-.->') ? 'relatesTo' : 'blocks',
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
    const dateStr = node.updatedAt.slice(0, 10);
    const author = node.metadata?.author || 'system';
    mmd += `    %% @${node.id} [${node.type}, ${node.status}, ${dateStr}, ${author}]\n`;
  }
  
  mmd += '\n';

  // 2. Nodes with rich descriptions
  for (const node of graph.nodes) {
    let content = node.title;
    const desc = node.metadata?.description;
    if (desc && typeof desc === 'string') {
      content += `<br/><sub>${desc}</sub>`;
    }
    mmd += `    ${node.id}("${content}")\n`;
  }

  mmd += '\n';

  // 3. Edges
  for (const edge of graph.edges) {
    const arrow = edgeKindToArrow(edge.kind);
    mmd += `    ${edge.from} ${arrow} ${edge.to}\n`;
  }

  mmd += '\n';

  // 4. Styles (The "Vibe")
  for (const node of graph.nodes) {
    let fill = '#1a1a2e';
    let stroke = '#a78bfa';
    let color = '#c4b5fd';
    let strokeWidth = '1px';

    if (node.status === 'opened') {
      stroke = '#4ade80';
      color = '#86efac';
    } else if (node.status === 'blocked') {
      stroke = '#f87171';
      color = '#fca5a5';
    } else if (node.status === 'deferred') {
      stroke = '#94a3b8';
      color = '#cbd5e1';
    }

    // Highlight the last active node
    if (node.id === graph.meta.lastActiveNodeId) {
      fill = '#2d1f4e';
      stroke = '#c084fc';
      color = '#e9d5ff';
      strokeWidth = '2px';
    }

    mmd += `    style ${node.id} fill:${fill},stroke:${stroke},color:${color},stroke-width:${strokeWidth}\n`;
  }

  return mmd;
}
