import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { TrajectoryStore } from '../trajectory-store.js';
import { PatchOperation } from '../../types/trajectory.js';

describe('TrajectoryStore', () => {
  let tmpDir: string;
  let store: TrajectoryStore;
  const repoSlug = 'test-repo';

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'warden-test-'));
    store = new TrajectoryStore(repoSlug, tmpDir);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('should initialize a new trajectory graph', async () => {
    await store.init();
    const graph = await store.load();
    expect(graph.repoSlug).toBe(repoSlug);
    expect(graph.nodes).toEqual([]);
    expect(graph.edges).toEqual([]);
    expect(graph.meta.revision).toBe(0);
  });

  it('should save and load a graph with nodes and edges', async () => {
    await store.init();
    const graph = await store.load();
    
    graph.nodes.push({
      id: 'node-1',
      title: 'First Node',
      status: 'opened',
      type: 'task',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      findingRefs: [],
      workRefs: [],
      tags: [],
      metadata: {},
    });

    graph.nodes.push({
      id: 'node-2',
      title: 'Second Node',
      status: 'opened',
      type: 'task',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      findingRefs: [],
      workRefs: [],
      tags: [],
      metadata: {},
    });

    graph.edges.push({
      from: 'node-1',
      to: 'node-2',
      kind: 'blocks',
      metadata: {},
    });

    await store.save(graph);
    
    const loaded = await store.load();
    expect(loaded.nodes).toHaveLength(2);
    expect(loaded.edges).toHaveLength(1);
    expect(loaded.edges[0]?.from).toBe('node-1');
  });

  it('should throw an error when loading non-existent trajectory', async () => {
    await expect(store.load()).rejects.toThrow(/not initialized/);
  });

  it('should validate invariants on save', async () => {
    await store.init();
    const graph = await store.load();
    
    graph.edges.push({
      from: 'missing',
      to: 'node-2',
      kind: 'blocks',
      metadata: {},
    });

    await expect(store.save(graph)).rejects.toThrow(/Edge references missing node/);
  });

  it('should apply a patch of operations', async () => {
    await store.init();
    
    await store.patch('test-actor', [
      {
        type: 'addNode',
        node: {
          id: 'n1',
          title: 'Node 1',
          status: 'opened',
          type: 'task',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          findingRefs: [],
          workRefs: [],
          tags: [],
          metadata: {},
        }
      },
      {
        type: 'addNode',
        node: {
          id: 'n2',
          title: 'Node 2',
          status: 'opened',
          type: 'task',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          findingRefs: [],
          workRefs: [],
          tags: [],
          metadata: {},
        }
      },
      {
        type: 'addEdge',
        edge: { from: 'n1', to: 'n2', kind: 'blocks', metadata: {} }
      }
    ]);

    const graph = await store.load();
    expect(graph.nodes).toHaveLength(2);
    expect(graph.edges).toHaveLength(1);
    expect(graph.meta.revision).toBe(1);
  });

  it('should detect cycles in patch', async () => {
    await store.init();
    const now = new Date().toISOString();
    
    await store.patch('test-actor', [
      { type: 'addNode', node: { id: 'n1', title: 'N1', status: 'opened', type: 'task', createdAt: now, updatedAt: now, findingRefs: [], workRefs: [], tags: [], metadata: {} } },
      { type: 'addNode', node: { id: 'n2', title: 'N2', status: 'opened', type: 'task', createdAt: now, updatedAt: now, findingRefs: [], workRefs: [], tags: [], metadata: {} } },
      { type: 'addEdge', edge: { from: 'n1', to: 'n2', kind: 'blocks', metadata: {} } }
    ]);

    const cyclePatch: PatchOperation[] = [
      { type: 'addEdge', edge: { from: 'n2', to: 'n1', kind: 'blocks', metadata: {} } }
    ];
    await expect(store.patch('test-actor', cyclePatch)).rejects.toThrow(/Cycle detected/);
  });
});
