import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { TrajectoryStore } from '../trajectory-store.js';

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
});
