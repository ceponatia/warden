import { z } from 'zod';

export const TrajectoryNodeStatusSchema = z.enum(['opened', 'closed', 'blocked', 'deferred']);
export type TrajectoryNodeStatus = z.infer<typeof TrajectoryNodeStatusSchema>;

export const TrajectoryNodeSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: TrajectoryNodeStatusSchema,
  type: z.string().default('task'),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  findingRefs: z.array(z.string()).default([]),
  workRefs: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  metadata: z.record(z.string(), z.any()).default({}),
});
export type TrajectoryNode = z.infer<typeof TrajectoryNodeSchema>;

export const TrajectoryEdgeSchema = z.object({
  from: z.string(),
  to: z.string(),
  kind: z.string().default('blocks'),
  metadata: z.record(z.string(), z.any()).default({}),
});
export type TrajectoryEdge = z.infer<typeof TrajectoryEdgeSchema>;

export const TrajectoryGraphSchema = z.object({
  version: z.number().default(1),
  repoSlug: z.string(),
  nodes: z.array(TrajectoryNodeSchema).default([]),
  edges: z.array(TrajectoryEdgeSchema).default([]),
  meta: z.object({
    lastActiveNodeId: z.string().optional(),
    revision: z.number().default(0),
    updatedAt: z.string().datetime(),
  }).default({
    revision: 0,
    updatedAt: new Date().toISOString(),
  }),
});
export type TrajectoryGraph = z.infer<typeof TrajectoryGraphSchema>;

export const TrajectoryEventSchema = z.object({
  eventId: z.string(),
  seq: z.number(),
  type: z.string(),
  at: z.string().datetime(),
  actor: z.string().default('system'),
  expectedRevision: z.number().optional(),
  payload: z.record(z.string(), z.any()),
});
export type TrajectoryEvent = z.infer<typeof TrajectoryEventSchema>;
