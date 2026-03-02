import type { LoadedSnapshot } from "../snapshots.js";
import type { FindingMetric } from "../types/findings.js";
import type { RepoConfig } from "../types/snapshot.js";
import type { WorkDocument } from "../types/work.js";
import { addNote, saveWorkDocument } from "../work/manager.js";
import { checkAutoMergeEligibility } from "../work/autonomy.js";
import type { AgentResult } from "./base-agent.js";
import { getAgentForCode } from "./registry.js";

export interface SchedulerConfig {
  maxConcurrent: number;
  maxPerRun: number;
  priorityOrder: FindingMetric[];
}

const DEFAULT_SCHEDULER_CONFIG: SchedulerConfig = {
  maxConcurrent: 1,
  maxPerRun: 5,
  priorityOrder: ["M7", "M8", "M6", "M1", "M2", "M3", "M4", "M5", "M9"],
};

const PRIORITY_BY_CODE: Record<string, number> = {
  "WD-M7-002": 0,
  "WD-M7-003": 1,
  "WD-M7-001": 2,
  "WD-M8-002": 3,
  "WD-M8-001": 4,
  "WD-M8-003": 5,
};

function severityRank(input: string): number {
  const value = Number(input.replace("S", ""));
  return Number.isNaN(value) ? 99 : value;
}

function sortCandidates(
  docs: WorkDocument[],
  config: SchedulerConfig,
): WorkDocument[] {
  return [...docs].sort((left, right) => {
    const severityDelta = severityRank(left.severity) - severityRank(right.severity);
    if (severityDelta !== 0) return severityDelta;

    if (right.consecutiveReports !== left.consecutiveReports) {
      return right.consecutiveReports - left.consecutiveReports;
    }

    const codePriorityLeft = PRIORITY_BY_CODE[left.code] ?? 100;
    const codePriorityRight = PRIORITY_BY_CODE[right.code] ?? 100;
    if (codePriorityLeft !== codePriorityRight) {
      return codePriorityLeft - codePriorityRight;
    }

    const metricPriorityLeft = config.priorityOrder.indexOf(left.metric);
    const metricPriorityRight = config.priorityOrder.indexOf(right.metric);
    return metricPriorityLeft - metricPriorityRight;
  });
}

function resolveConfig(repoConfig: RepoConfig): SchedulerConfig {
  return {
    maxConcurrent: repoConfig.scheduler?.maxConcurrent ?? DEFAULT_SCHEDULER_CONFIG.maxConcurrent,
    maxPerRun: repoConfig.scheduler?.maxPerRun ?? DEFAULT_SCHEDULER_CONFIG.maxPerRun,
    priorityOrder: repoConfig.scheduler?.priorityOrder ?? DEFAULT_SCHEDULER_CONFIG.priorityOrder,
  };
}

async function runSequential(
  config: RepoConfig,
  snapshot: LoadedSnapshot,
  workDocs: WorkDocument[],
): Promise<AgentResult[]> {
  const results: AgentResult[] = [];

  for (const doc of workDocs) {
    const agent = getAgentForCode(doc.code);
    if (!agent) {
      continue;
    }

    const eligibility = await checkAutoMergeEligibility({
      slug: config.slug,
      agentName: agent.name,
      findingCode: doc.code,
      severity: doc.severity,
    });
    addNote(
      doc,
      "scheduler",
      eligibility.eligible
        ? `Auto-merge eligible for ${agent.name}.`
        : `Auto-merge not eligible for ${agent.name}: ${eligibility.reason}`,
    );
    await saveWorkDocument(config.slug, doc);

    const result = await agent.run({
      config,
      finding: doc,
      snapshot,
      branchPrefix: `warden/${agent.name.replace(/-agent$/, "")}`,
    });
    results.push(result);
  }

  return results;
}

export async function scheduleAgentWork(
  config: RepoConfig,
  snapshot: LoadedSnapshot,
  workDocs: WorkDocument[],
): Promise<AgentResult[]> {
  const schedulerConfig = resolveConfig(config);
  const candidates = workDocs.filter((doc) => {
    const agent = getAgentForCode(doc.code);
    if (!agent) return false;
    return doc.status === "unassigned" || doc.status === "auto-assigned";
  });

  const prioritized = sortCandidates(candidates, schedulerConfig).slice(
    0,
    schedulerConfig.maxPerRun,
  );

  // Phase default remains sequential; `maxConcurrent` is reserved for future expansion.
  return runSequential(config, snapshot, prioritized);
}
