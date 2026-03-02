import fs from 'node:fs/promises';
import path from 'node:path';
import { TrajectoryGraph, TrajectoryGraphSchema, TrajectoryEvent } from '../types/trajectory.js';
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
}
