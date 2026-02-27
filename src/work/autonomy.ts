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
import {
  computeAggregateTrust,
  loadTrustMetrics,
  recordMergeResult,
} from "./trust.js";
import { loadRepoConfigs } from "../config/loader.js";
import type {
  AutonomyConfig,
  AutonomyGlobalDefaults,
  AutonomyRule,
  GlobalAutonomyConfig,
  GlobalAutonomyPolicy,
  MergeImpactRecord,
  Severity,
  TrustMetrics,
  WorkDocument,
} from "../types/work.js";

const execFileAsync = promisify(execFile);

function autonomyPath(slug: string): string {
  return path.resolve(process.cwd(), "data", slug, "autonomy.json");
}

function globalAutonomyPath(): string {
  return path.resolve(process.cwd(), "config", "autonomy-global.json");
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

function defaultGlobalAutonomyConfig(): GlobalAutonomyConfig {
  return {
    policies: [],
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

const VALID_SEVERITIES: Severity[] = ["S0", "S1", "S2", "S3", "S4", "S5"];

function normalizeSeverityArray(value: unknown): Severity[] {
  if (!Array.isArray(value) || value.length === 0) {
    return [...VALID_SEVERITIES];
  }
  const filtered = value.filter(
    (v): v is Severity => typeof v === "string" && (VALID_SEVERITIES as string[]).includes(v),
  );
  return filtered.length > 0 ? filtered : [...VALID_SEVERITIES];
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

function normalizeGlobalConfig(
  input: Partial<GlobalAutonomyConfig>,
): GlobalAutonomyConfig {
  return {
    policies: Array.isArray(input.policies)
      ? input.policies
          .filter(
            (policy): policy is GlobalAutonomyPolicy =>
              typeof policy?.agentName === "string" &&
              typeof policy?.minAggregateScore === "number",
          )
          .map((policy) => ({
            ...policy,
            allowedSeverities: normalizeSeverityArray(policy.allowedSeverities),
            allowedCodes: normalizeStringArray(policy.allowedCodes),
            appliesTo: normalizeStringArray(policy.appliesTo),
            createdAt: policy.createdAt ?? new Date().toISOString(),
            createdBy: "manual",
          }))
      : [],
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

export async function loadGlobalAutonomyConfig(): Promise<GlobalAutonomyConfig> {
  try {
    const raw = await readFile(globalAutonomyPath(), "utf8");
    return normalizeGlobalConfig(
      JSON.parse(raw) as Partial<GlobalAutonomyConfig>,
    );
  } catch (error: unknown) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      return defaultGlobalAutonomyConfig();
    }
    throw error;
  }
}

export async function saveGlobalAutonomyConfig(
  config: GlobalAutonomyConfig,
): Promise<void> {
  const filePath = globalAutonomyPath();
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
  return severityRank(severity) <= severityRank(maxSeverity);
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
  globalPolicies?: GlobalAutonomyPolicy[];
}

function matchesGlobalScope(
  policy: GlobalAutonomyPolicy,
  slug: string,
  findingCode: string,
  severity: Severity,
): boolean {
  const appliesToRepo =
    policy.appliesTo.length === 0 || policy.appliesTo.includes(slug);
  const allowsCode =
    policy.allowedCodes.length === 0 ||
    policy.allowedCodes.includes(findingCode);
  const allowsSeverity = policy.allowedSeverities.includes(severity);
  return appliesToRepo && allowsCode && allowsSeverity;
}

export async function checkAutoMergeEligibility(params: {
  slug: string;
  agentName: string;
  findingCode: string;
  severity: Severity;
  repoSlugs?: string[];
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

  const globalConfig = await loadGlobalAutonomyConfig();
  const applicablePolicies = globalConfig.policies.filter((policy) =>
    policy.agentName === params.agentName
      ? matchesGlobalScope(
          policy,
          params.slug,
          params.findingCode,
          params.severity,
        )
      : false,
  );

  if (applicablePolicies.length > 0) {
    const slugs =
      params.repoSlugs ?? (await loadRepoConfigs()).map((entry) => entry.slug);
    const aggregate = await computeAggregateTrust(params.agentName, slugs);
    const matchedPolicy = applicablePolicies.find(
      (policy) => aggregate.aggregateScore >= policy.minAggregateScore,
    );

    if (!matchedPolicy) {
      return {
        eligible: false,
        reason:
          "Aggregate trust score does not meet global autonomy policy threshold.",
        rule,
        globalPolicies: applicablePolicies,
      };
    }

    if (!aggregate.globalEligible) {
      return {
        eligible: false,
        reason:
          "Agent is not globally eligible because at least one repo trust score is below minimum threshold.",
        rule,
        globalPolicies: applicablePolicies,
      };
    }
  }

  return {
    eligible: true,
    reason: "Eligible for auto-merge.",
    rule,
    globalPolicies: applicablePolicies,
  };
}

function sortedUnique(arr: string[]): string[] {
  return [...new Set(arr)].sort();
}

export async function grantGlobalAutonomyPolicy(params: {
  agentName: string;
  minAggregateScore: number;
  allowedSeverities?: Severity[];
  allowedCodes?: string[];
  appliesTo?: string[];
}): Promise<GlobalAutonomyPolicy> {
  const config = await loadGlobalAutonomyConfig();
  const policy: GlobalAutonomyPolicy = {
    agentName: params.agentName,
    minAggregateScore: params.minAggregateScore,
    allowedSeverities:
      params.allowedSeverities && params.allowedSeverities.length > 0
        ? params.allowedSeverities
        : ["S0", "S1", "S2", "S3", "S4", "S5"],
    allowedCodes: sortedUnique(params.allowedCodes ?? []),
    appliesTo: sortedUnique(params.appliesTo ?? []),
    createdAt: new Date().toISOString(),
    createdBy: "manual",
  };

  const index = config.policies.findIndex(
    (entry) =>
      entry.agentName === policy.agentName &&
      JSON.stringify(sortedUnique(entry.allowedCodes)) ===
        JSON.stringify(policy.allowedCodes) &&
      JSON.stringify(sortedUnique(entry.appliesTo)) ===
        JSON.stringify(policy.appliesTo),
  );

  if (index >= 0) {
    config.policies[index] = policy;
  } else {
    config.policies.push(policy);
  }

  await saveGlobalAutonomyConfig(config);
  return policy;
}

export async function listGlobalAutonomyPolicies(): Promise<
  GlobalAutonomyPolicy[]
> {
  const config = await loadGlobalAutonomyConfig();
  return config.policies;
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
  repoSlugs?: string[];
}): Promise<{ merged: boolean; reason: string }> {
  const decision = await checkAutoMergeEligibility({
    slug: params.slug,
    agentName: params.agentName,
    findingCode: params.doc.code,
    severity: params.doc.severity,
    repoSlugs: params.repoSlugs,
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
