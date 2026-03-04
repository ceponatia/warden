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
  affectsModules: z.array(z.string()).default([]),
  metadata: z.record(z.string(), z.any()).default({}),
});
export type TrajectoryNode = z.infer<typeof TrajectoryNodeSchema>;

export const NewTrajectoryNodeSchema = TrajectoryNodeSchema.omit({
  createdAt: true,
  updatedAt: true,
});
export type NewTrajectoryNode = z.infer<typeof NewTrajectoryNodeSchema>;

export const TrajectoryEdgeSchema = z.object({
  from: z.string(),
  to: z.string(),
  kind: z.enum(['dependsOn', 'relatesTo', 'supersedes', 'blocks', 'planned']).default('blocks'),
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
    archivePolicy: z.object({
      fullFidelityMonths: z.number().default(6),
      maxNodes: z.number().default(500),
    }).optional(),
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

export type PatchOperation =
  | { type: 'addNode'; node: NewTrajectoryNode }
  | { type: 'updateNode'; id: string; updates: Partial<TrajectoryNode> }
  | { type: 'addEdge'; edge: TrajectoryEdge }
  | { type: 'deleteEdge'; from: string; to: string }
  | { type: 'deleteNode'; id: string };

export const PatchOperationSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('addNode'),
    node: NewTrajectoryNodeSchema,
  }),
  z.object({
    type: z.literal('updateNode'),
    id: z.string(),
    updates: TrajectoryNodeSchema.partial().omit({ id: true }),
  }),
  z.object({
    type: z.literal('addEdge'),
    edge: TrajectoryEdgeSchema,
  }),
  z.object({
    type: z.literal('deleteEdge'),
    from: z.string(),
    to: z.string(),
  }),
  z.object({
    type: z.literal('deleteNode'),
    id: z.string(),
  }),
]);

