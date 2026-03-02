import fs from 'node:fs/promises';
import path from 'node:path';
import { TrajectoryGraph, TrajectoryGraphSchema, TrajectoryEvent, PatchOperation } from '../types/trajectory.js';
import { validateTrajectoryInvariants } from './trajectory-invariants.js';

export class TrajectoryStore {
  constructor(private repoSlug: string, private dataDir: string = 'data') {}

  private get baseDir() {
    return path.join(this.dataDir, this.repoSlug, 'trajectory');
  }

  private get statePath() {
    return path.join(this.baseDir, 'state.json');
  }

  private get eventsPath() {
    return path.join(this.baseDir, 'events.jsonl');
  }

  async init(): Promise<void> {
    await fs.mkdir(this.baseDir, { recursive: true });
    
    const initialGraph: TrajectoryGraph = {
      version: 1,
      repoSlug: this.repoSlug,
      nodes: [],
      edges: [],
      meta: {
        revision: 0,
        updatedAt: new Date().toISOString(),
      },
    };

    await this.save(initialGraph);
  }

  async load(): Promise<TrajectoryGraph> {
    try {
      const data = await fs.readFile(this.statePath, 'utf-8');
      const json = JSON.parse(data);
      return TrajectoryGraphSchema.parse(json);
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
        throw new Error(`Trajectory not initialized for repo "${this.repoSlug}". Run init first.`);
      }
      throw error;
    }
  }

  async save(graph: TrajectoryGraph): Promise<void> {
    const errors = validateTrajectoryInvariants(graph);
    if (errors.length > 0) {
      throw new Error(`Invalid trajectory graph: ${errors.join('; ')}`);
    }

    const data = JSON.stringify(graph, null, 2);
    await fs.writeFile(this.statePath, data, 'utf-8');
  }

  async appendEvent(event: TrajectoryEvent): Promise<void> {
    const line = JSON.stringify(event) + '\n';
    await fs.appendFile(this.eventsPath, line, 'utf-8');
  }

  async validate(): Promise<string[]> {
    const graph = await this.load();
    return validateTrajectoryInvariants(graph);
  }

  async patch(
    actor: string,
    operations: PatchOperation[],
    expectedRevision?: number,
  ): Promise<void> {
    const graph = await this.load();

    if (expectedRevision !== undefined && graph.meta.revision !== expectedRevision) {
      throw new Error(
        `Concurrency conflict: expected revision ${expectedRevision} but found ${graph.meta.revision}`,
      );
    }

    const now = new Date().toISOString();

    for (const op of operations) {
      switch (op.type) {
        case 'addNode':
          graph.nodes.push({
            ...op.node,
            createdAt: now,
            updatedAt: now,
          });
          break;
        case 'updateNode': {
          const node = graph.nodes.find(n => n.id === op.id);
          if (!node) throw new Error(`Node not found: ${op.id}`);
          Object.assign(node, op.updates);
          node.updatedAt = now;
          break;
        }
        case 'addEdge':
          graph.edges.push(op.edge);
          break;
        case 'deleteEdge':
          graph.edges = graph.edges.filter(e => !(e.from === op.from && e.to === op.to));
          break;
        case 'deleteNode':
          graph.nodes = graph.nodes.filter(n => n.id !== op.id);
          graph.edges = graph.edges.filter(e => e.from !== op.id && e.to !== op.id);
          break;
        default: {
          const unknownOp = op as { type: string };
          throw new Error(`Unknown patch operation type: ${unknownOp.type}`);
        }
      }
    }

    const oldRevision = graph.meta.revision;
    graph.meta.revision += 1;
    graph.meta.updatedAt = now;

    await this.save(graph);

    await this.appendEvent({
      eventId: crypto.randomUUID(),
      seq: graph.meta.revision,
      type: 'patch',
      at: now,
      actor,
      expectedRevision: oldRevision,
      payload: { operations },
    });
  }
}
