import fs from "node:fs/promises";
import path from "node:path";
import type { TrajectoryGraph } from "../types/trajectory.js";
import { callProvider, resolveProviderConfig } from "../agents/provider.js";

export interface ProjectStateLensOptions {
  maxNodes: number;
  hideClosedOlderThanDays: number;
  collapseByTag: boolean;
}

type LensKind = "project-state" | "local-impact";
type LensTrigger = "webhook" | "manual";

interface LensContextOptions {
  triggeredBy?: LensTrigger;
  prNumber?: number;
}

interface LocalImpactLensContextOptions extends LensContextOptions {
  denyPatterns?: string[];
}

interface AiAuditEntry {
  timestamp: string;
  repoSlug: string;
  lens: LensKind;
  provider: string;
  triggered: LensTrigger;
  prNumber?: number;
}

const DEFAULT_DENY_PATTERNS = [
  "*.env",
  "*.env.*",
  "*.pem",
  "*.key",
  "*.cert",
  "config/github.json",
  "config/github-webhook.json",
] as const;

const SECRET_PATTERNS = [
  /^[+-]\s*\w*(API_KEY|SECRET|TOKEN|PASSWORD|PRIVATE_KEY)\w*\s*[:=]/i,
];

function normalizeTrigger(triggeredBy: LensTrigger | undefined): LensTrigger {
  return triggeredBy === "webhook" ? "webhook" : "manual";
}

function toPosixPath(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

function globToRegExp(pattern: string): RegExp {
  const normalized = toPosixPath(pattern).trim();
  const escaped = normalized
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "::DOUBLE_STAR::")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]")
    .replace(/::DOUBLE_STAR::/g, ".*");
  return new RegExp(`^${escaped}$`);
}

function matchesGlob(filePath: string, pattern: string): boolean {
  const normalizedPath = toPosixPath(filePath);
  const normalizedPattern = toPosixPath(pattern);
  const candidate = normalizedPattern.includes("/")
    ? normalizedPath
    : path.posix.basename(normalizedPath);
  return globToRegExp(normalizedPattern).test(candidate);
}

function shouldFilterFile(filePath: string, denyPatterns: string[]): boolean {
  return denyPatterns.some((pattern) => matchesGlob(filePath, pattern));
}

export function filterDiffByPolicy(
  rawDiff: string,
  denyPatterns: string[] = [...DEFAULT_DENY_PATTERNS],
): string {
  const lines = rawDiff.split("\n");
  const output: string[] = [];
  let skipCurrentFile = false;

  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      const match = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
      const filePath = match?.[2] ?? match?.[1] ?? "";
      skipCurrentFile = shouldFilterFile(filePath, denyPatterns);
      output.push(line);
      if (skipCurrentFile) {
        output.push("[Content filtered by Warden diff policy]");
      }
      continue;
    }

    if (!skipCurrentFile) {
      output.push(line);
    }
  }

  return output.join("\n");
}

export function redactSecretAssignments(diff: string): string {
  return diff
    .split("\n")
    .map((line) => {
      if (SECRET_PATTERNS.some((pattern) => pattern.test(line))) {
        return line.replace(/[:=].*$/, "= [REDACTED]");
      }
      return line;
    })
    .join("\n");
}

async function logAiAudit(entry: AiAuditEntry): Promise<void> {
  const baseDataDir = path.resolve(process.cwd(), "data");
  const repoDir = path.resolve(baseDataDir, entry.repoSlug);
  const relative = path.relative(baseDataDir, repoDir);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Invalid repoSlug for AI audit logging: ${entry.repoSlug}`);
  }

  const auditPath = path.join(repoDir, "trajectory", "ai-audit.jsonl");
  await fs.mkdir(path.dirname(auditPath), { recursive: true });
  await fs.appendFile(auditPath, `${JSON.stringify(entry)}\n`, "utf-8");
}

async function callLensProvider(
  lens: LensKind,
  graph: TrajectoryGraph,
  call: { systemPrompt: string; userPrompt: string; maxTokens: number },
  options: LensContextOptions | undefined,
): Promise<string> {
  const providerConfig = resolveProviderConfig();
  const output = await callProvider(call);
  await logAiAudit({
    timestamp: new Date().toISOString(),
    repoSlug: graph.repoSlug,
    lens,
    provider: providerConfig.provider,
    triggered: normalizeTrigger(options?.triggeredBy),
    prNumber: options?.prNumber,
  });
  return output;
}

export async function generateProjectStateLens(
  graph: TrajectoryGraph,
  options?: LensContextOptions,
): Promise<string> {
  const agentPromptPath = path.join(
    process.cwd(),
    ".github",
    "agents",
    "trajectory-telescope.agent.md",
  );
  const systemPrompt = await fs.readFile(agentPromptPath, "utf-8");

  const userPrompt = `
FULL PROJECT TRAJECTORY (JSON):
${JSON.stringify(graph, null, 2)}

Generate the Macro Visionary (Telescope) view in Mermaid syntax.`;

  return callLensProvider(
    "project-state",
    graph,
    {
      systemPrompt,
      userPrompt,
      maxTokens: 2048,
    },
    options,
  );
}

export async function generateLocalImpactLens(
  graph: TrajectoryGraph,
  prDiff: string,
  prTitle: string,
  prBody: string,
  options?: LocalImpactLensContextOptions,
): Promise<string> {
  const agentPromptPath = path.join(
    process.cwd(),
    ".github",
    "agents",
    "trajectory-microscope.agent.md",
  );
  const systemPrompt = await fs.readFile(agentPromptPath, "utf-8");

  const denyPatterns = options?.denyPatterns ?? [...DEFAULT_DENY_PATTERNS];
  const filteredDiff = redactSecretAssignments(
    filterDiffByPolicy(prDiff, denyPatterns),
  );

  const userPrompt = `
PR Title: ${prTitle}
PR Body: ${prBody || "None"}
PR Diff: ${filteredDiff.slice(0, 8000)}

FULL PROJECT TRAJECTORY (JSON):
${JSON.stringify(graph, null, 2)}

Generate the Contextual Neighborhood (Microscope) view in Mermaid syntax.`;

  return callLensProvider(
    "local-impact",
    graph,
    {
      systemPrompt,
      userPrompt,
      maxTokens: 2048,
    },
    options,
  );
}

export function pruneArchive(
  graph: TrajectoryGraph,
  policy: { fullFidelityMonths: number; maxNodes: number },
): { pruned: TrajectoryGraph; removedCount: number } {
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - policy.fullFidelityMonths);
  const cutoffIso = cutoff.toISOString();

  // Remove closed nodes older than fullFidelityMonths
  let nodes = graph.nodes.filter(
    (n) => n.status !== "closed" || n.updatedAt >= cutoffIso,
  );

  // Hard cap at maxNodes (keep newest by updatedAt)
  if (nodes.length > policy.maxNodes) {
    nodes.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    nodes = nodes.slice(0, policy.maxNodes);
  }

  const nodeIds = new Set(nodes.map((n) => n.id));
  const edges = graph.edges.filter(
    (e) => nodeIds.has(e.from) && nodeIds.has(e.to),
  );

  return {
    pruned: { ...graph, nodes, edges },
    removedCount: graph.nodes.length - nodes.length,
  };
}
