import { TrajectoryGraph, TrajectoryNodeStatus } from '../types/trajectory.js';

export function validateTrajectoryInvariants(graph: TrajectoryGraph): string[] {
  const errors: string[] = [];
  const nodes = graph.nodes;
  const nodeIds = new Set(nodes.map(n => n.id));

  // 1. Duplicate IDs
  if (nodeIds.size !== nodes.length) {
    const ids = nodes.map(n => n.id);
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

  // 3. Cycle Detection (Strict DAG for blockers)
  const adj = new Map<string, string[]>();
  for (const edge of graph.edges) {
    if (edge.kind === 'blocks') {
      const list = adj.get(edge.from) || [];
      list.push(edge.to);
      adj.set(edge.from, list);
    }
  }

  const visited = new Set<string>();
  const recStack = new Set<string>();

  function hasCycle(u: string): boolean {
    visited.add(u);
    recStack.add(u);

    const neighbors = adj.get(u) || [];
    for (const v of neighbors) {
      if (!visited.has(v)) {
        if (hasCycle(v)) return true;
      } else if (recStack.has(v)) {
        return true;
      }
    }

    recStack.delete(u);
    return false;
  }

  for (const node of nodes) {
    if (!visited.has(node.id)) {
      if (hasCycle(node.id)) {
        errors.push(`Cycle detected in trajectory graph starting at node "${node.id}"`);
        break; 
      }
    }
  }

  return errors;
}

export function validateStateTransition(
  oldStatus: TrajectoryNodeStatus,
  newStatus: TrajectoryNodeStatus
): string | null {
  if (oldStatus === newStatus) return null;

  // Rules:
  // - closed nodes cannot be reopened without explicit action (warn for now)
  // - deferred nodes can be opened
  // - blocked nodes stay blocked until dependencies are cleared (external logic)
  
  if (oldStatus === 'closed' && newStatus === 'opened') {
    // Reopening is allowed but we might want to log it specifically.
    return null;
  }

  return null; // For now, all transitions are allowed via policy, but we have the hook.
}

