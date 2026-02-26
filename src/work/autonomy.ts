import { mkdir, readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";

import { addNote } from "./manager.js";
import {
  hasRevertedAutomerge,
  hasSevereAutomergeRegression,
  recordAutoMerge,
} from "./impact.js";
import { loadTrustMetrics, recordMergeResult } from "./trust.js";
import type {
  AutonomyConfig,
  AutonomyGlobalDefaults,
  AutonomyRule,
  MergeImpactRecord,
  Severity,
  TrustMetrics,
  WorkDocument,
} from "../types/work.js";

const execFileAsync = promisify(execFile);

function autonomyPath(slug: string): string {
  return path.resolve(process.cwd(), "data", slug, "autonomy.json");
}

function severityRank(severity: Severity): number {
  return Number(severity.replace("S", ""));
}

function defaultGlobalDefaults(): AutonomyGlobalDefaults {
  return {
    minConsecutiveCleanMerges: 10,
    minValidationPassRate: 0.95,
    minTotalRuns: 5,
    maxSeverity: "S3",
  };
}

function defaultConfig(): AutonomyConfig {
  return {
    rules: [],
    globalDefaults: defaultGlobalDefaults(),
  };
}

function normalizeConfig(input: Partial<AutonomyConfig>): AutonomyConfig {
  return {
    rules: input.rules ?? [],
    globalDefaults: {
      ...defaultGlobalDefaults(),
      ...(input.globalDefaults ?? {}),
    },
  };
}

export async function loadAutonomyConfig(
  slug: string,
): Promise<AutonomyConfig> {
  try {
    const raw = await readFile(autonomyPath(slug), "utf8");
    return normalizeConfig(JSON.parse(raw) as Partial<AutonomyConfig>);
  } catch (error: unknown) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      return defaultConfig();
    }
    throw error;
  }
}

export async function saveAutonomyConfig(
  slug: string,
  config: AutonomyConfig,
): Promise<void> {
  const filePath = autonomyPath(slug);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

function effectiveRuleThresholds(
  rule: AutonomyRule,
  globalDefaults: AutonomyGlobalDefaults,
): AutonomyGlobalDefaults {
  return {
    minConsecutiveCleanMerges:
      rule.conditions.minConsecutiveCleanMerges ??
      globalDefaults.minConsecutiveCleanMerges,
    minValidationPassRate:
      rule.conditions.minValidationPassRate ??
      globalDefaults.minValidationPassRate,
    minTotalRuns: rule.conditions.minTotalRuns ?? globalDefaults.minTotalRuns,
    maxSeverity: rule.maxSeverity ?? globalDefaults.maxSeverity,
  };
}

function ruleMatchesScope(
  rule: AutonomyRule,
  findingCode: string,
  severity: Severity,
  globalDefaults: AutonomyGlobalDefaults,
): boolean {
  if (!rule.enabled) {
    return false;
  }

  if (rule.allowedCodes && rule.allowedCodes.length > 0) {
    if (!rule.allowedCodes.includes(findingCode)) {
      return false;
    }
  }

  const maxSeverity = rule.maxSeverity ?? globalDefaults.maxSeverity;
  return severityRank(severity) >= severityRank(maxSeverity);
}

function metricsMeetThresholds(
  metrics: TrustMetrics,
  thresholds: AutonomyGlobalDefaults,
): boolean {
  return (
    metrics.consecutiveCleanMerges >= thresholds.minConsecutiveCleanMerges &&
    metrics.validationPassRate >= thresholds.minValidationPassRate &&
    metrics.totalRuns >= thresholds.minTotalRuns
  );
}

export interface AutonomyDecision {
  eligible: boolean;
  reason: string;
  rule?: AutonomyRule;
}

export async function checkAutoMergeEligibility(params: {
  slug: string;
  agentName: string;
  findingCode: string;
  severity: Severity;
}): Promise<AutonomyDecision> {
  const config = await loadAutonomyConfig(params.slug);
  const rule = config.rules.find(
    (candidate) => candidate.agentName === params.agentName,
  );

  if (!rule) {
    return { eligible: false, reason: "No autonomy rule found." };
  }

  if (!rule.enabled) {
    return { eligible: false, reason: "Autonomy rule is disabled.", rule };
  }

  if (
    !ruleMatchesScope(
      rule,
      params.findingCode,
      params.severity,
      config.globalDefaults,
    )
  ) {
    return {
      eligible: false,
      reason: "Finding code or severity is outside allowed scope.",
      rule,
    };
  }

  const metrics = await loadTrustMetrics(params.slug, params.agentName);
  const thresholds = effectiveRuleThresholds(rule, config.globalDefaults);
  if (!metricsMeetThresholds(metrics, thresholds)) {
    return {
      eligible: false,
      reason:
        "Trust metrics below threshold (consecutive clean merges, pass rate, or total runs).",
      rule,
    };
  }

  return { eligible: true, reason: "Eligible for auto-merge.", rule };
}

export async function grantAutonomyRule(params: {
  slug: string;
  agentName: string;
  allowedCodes?: string[];
  maxSeverity?: Severity;
  minConsecutiveCleanMerges?: number;
  minValidationPassRate?: number;
  minTotalRuns?: number;
}): Promise<AutonomyRule> {
  const config = await loadAutonomyConfig(params.slug);
  const now = new Date().toISOString();
  const rule: AutonomyRule = {
    agentName: params.agentName,
    enabled: true,
    grantedAt: now,
    grantedBy: "manual",
    allowedCodes: params.allowedCodes,
    maxSeverity: params.maxSeverity,
    conditions: {
      minConsecutiveCleanMerges: params.minConsecutiveCleanMerges,
      minValidationPassRate: params.minValidationPassRate,
      minTotalRuns: params.minTotalRuns,
    },
  };

  const existingIndex = config.rules.findIndex(
    (candidate) => candidate.agentName === params.agentName,
  );
  if (existingIndex >= 0) {
    config.rules[existingIndex] = rule;
  } else {
    config.rules.push(rule);
  }

  await saveAutonomyConfig(params.slug, config);
  return rule;
}

export async function revokeAutonomyRule(
  slug: string,
  agentName: string,
  reason: string,
): Promise<AutonomyRule | null> {
  const config = await loadAutonomyConfig(slug);
  const rule = config.rules.find(
    (candidate) => candidate.agentName === agentName,
  );
  if (!rule) {
    return null;
  }

  rule.enabled = false;
  rule.revokedAt = new Date().toISOString();
  rule.revocationReason = reason;
  await saveAutonomyConfig(slug, config);
  return rule;
}

export async function listAutonomyRules(slug: string): Promise<AutonomyRule[]> {
  const config = await loadAutonomyConfig(slug);
  return config.rules;
}

async function mergeBranch(
  repoPath: string,
  sourceBranch: string,
  targetBranch: string,
): Promise<void> {
  await execFileAsync("git", ["checkout", targetBranch], { cwd: repoPath });
  await execFileAsync("git", ["merge", "--no-ff", "--no-edit", sourceBranch], {
    cwd: repoPath,
  });
}

export async function tryAutoMergeForWorkDocument(params: {
  slug: string;
  repoPath: string;
  doc: WorkDocument;
  agentName: string;
  sourceBranch: string;
  targetBranch: string;
}): Promise<{ merged: boolean; reason: string }> {
  const decision = await checkAutoMergeEligibility({
    slug: params.slug,
    agentName: params.agentName,
    findingCode: params.doc.code,
    severity: params.doc.severity,
  });

  if (!decision.eligible) {
    addNote(params.doc, "autonomy", `Auto-merge skipped: ${decision.reason}`);
    return { merged: false, reason: decision.reason };
  }

  try {
    await mergeBranch(
      params.repoPath,
      params.sourceBranch,
      params.targetBranch,
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    addNote(params.doc, "autonomy", `Auto-merge failed: ${message}`);
    return { merged: false, reason: message };
  }

  await recordMergeResult(params.slug, params.agentName, "accepted");
  const mergedAt = new Date().toISOString();
  await recordAutoMerge(params.slug, {
    agentName: params.agentName,
    findingCode: params.doc.code,
    branch: params.sourceBranch,
    files: params.doc.path ? [params.doc.path] : [],
    mergedAt,
  });

  addNote(
    params.doc,
    "autonomy",
    `Auto-merged ${params.sourceBranch} into ${params.targetBranch} at ${mergedAt}.`,
  );

  return { merged: true, reason: "Merged" };
}

export async function evaluateRevocations(params: {
  slug: string;
  impacts: MergeImpactRecord[];
}): Promise<AutonomyRule[]> {
  const config = await loadAutonomyConfig(params.slug);
  const revoked: AutonomyRule[] = [];

  for (const rule of config.rules) {
    if (!rule.enabled) {
      continue;
    }

    const agentImpacts = params.impacts.filter(
      (impact) => impact.agentName === rule.agentName && impact.autoMerged,
    );
    const thresholds = effectiveRuleThresholds(rule, config.globalDefaults);
    const metrics = await loadTrustMetrics(params.slug, rule.agentName);

    let revocationReason: string | null = null;
    if (hasSevereAutomergeRegression(agentImpacts)) {
      revocationReason =
        "Auto-merged change introduced a new S0/S1/S2 finding.";
    } else if (hasRevertedAutomerge(agentImpacts)) {
      revocationReason = "Auto-merged change was reverted.";
    } else if (metrics.validationPassRate < thresholds.minValidationPassRate) {
      revocationReason = "Validation pass rate dropped below threshold.";
    } else if (
      metrics.consecutiveCleanMerges < thresholds.minConsecutiveCleanMerges
    ) {
      revocationReason =
        "Consecutive clean merge count dropped below threshold.";
    }

    if (revocationReason) {
      rule.enabled = false;
      rule.revokedAt = new Date().toISOString();
      rule.revocationReason = revocationReason;
      revoked.push(rule);
    }
  }

  if (revoked.length > 0) {
    await saveAutonomyConfig(params.slug, config);
  }

  return revoked;
}
