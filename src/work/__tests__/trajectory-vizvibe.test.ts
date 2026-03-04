import { describe, it, expect } from 'vitest';
import { parseMermaidTrajectory, exportMermaidTrajectory } from '../trajectory-vizvibe.js';

describe('Mermaid Trajectory Adapter', () => {
  const repoSlug = 'test-repo';

  it('should parse a basic Mermaid trajectory', () => {
    const mmd = `flowchart TD
    %% @node-1 [task, opened]
    %% @node-2 [task, closed]

    node-1("First Node")
    node-2("Second Node")

    node-1 --> node-2
`;
    const graph = parseMermaidTrajectory(mmd, repoSlug);
    expect(graph.nodes).toHaveLength(2);
    expect(graph.edges).toHaveLength(1);
    expect(graph.nodes[0]?.id).toBe('node-1');
    expect(graph.nodes[0]?.status).toBe('opened');
    expect(graph.nodes[1]?.status).toBe('closed');
    expect(graph.edges[0]?.from).toBe('node-1');
  });

  it('should roundtrip a trajectory graph', () => {
    const mmd = `flowchart TD
    %% @n1 [task, opened]
    %% @n2 [task, closed]

    n1("Start")
    n2("End")

    n1 --> n2
`;
    const graph = parseMermaidTrajectory(mmd, repoSlug);
    const exported = exportMermaidTrajectory(graph);
    
    const secondGraph = parseMermaidTrajectory(exported, repoSlug);
    // Compare without timestamps since parseMermaidTrajectory assigns 'now'
    expect(secondGraph.nodes.map(n => ({ id: n.id, title: n.title, status: n.status })))
      .toEqual(graph.nodes.map(n => ({ id: n.id, title: n.title, status: n.status })));
    expect(secondGraph.edges).toEqual(graph.edges);
  });

  it('should handle dashed edges (-.-> maps to relatesTo)', () => {
    const mmd = `flowchart TD
    n1("Start")
    n2("Future")
    n1 -.-> n2
`;
    const graph = parseMermaidTrajectory(mmd, repoSlug);
    // -.-> is ambiguous between planned and relatesTo; parser defaults to relatesTo
    expect(graph.edges[0]?.kind).toBe('relatesTo');

    const exported = exportMermaidTrajectory(graph);
    expect(exported).toContain('-.->');
  });
});
