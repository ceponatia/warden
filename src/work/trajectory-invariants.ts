import { TrajectoryGraph } from '../types/trajectory.js';

export function validateTrajectoryInvariants(graph: TrajectoryGraph): string[] {
  const errors: string[] = [];
  const nodeIds = new Set(graph.nodes.map(n => n.id));

  // 1. Duplicate IDs
  if (nodeIds.size !== graph.nodes.length) {
    const ids = graph.nodes.map(n => n.id);
    const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
    errors.push(`Duplicate node IDs found: ${[...new Set(duplicates)].join(', ')}`);
  }

  // 2. Dangling edges
  for (const edge of graph.edges) {
    if (!nodeIds.has(edge.from)) {
      errors.push(`Edge references missing node: from="${edge.from}"`);
    }
    if (!nodeIds.has(edge.to)) {
      errors.push(`Edge references missing node: to="${edge.to}"`);
    }
  }

  // 3. Cycle detection (Simple BFS-based check for DAG if needed, but for now just basic connectivity)
  // For a trajectory, cycles are usually errors but some "redo" loops might exist in Mermaid. 
  // Let's keep it simple for now.

  return errors;
}
