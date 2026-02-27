import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import { getRepoConfigBySlug, loadRepoConfigs } from "../../config/loader.js";
import { loadImpactRecords } from "../../work/impact.js";
import {
  grantGlobalAutonomyPolicy,
  grantAutonomyRule,
  listGlobalAutonomyPolicies,
  listAutonomyRules,
  revokeAutonomyRule,
} from "../../work/autonomy.js";
import { loadTrustMetrics } from "../../work/trust.js";
import type { Severity } from "../../types/work.js";

function getFlagValue(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx < 0) {
    return undefined;
  }

  return args[idx + 1];
}

function parseSeverity(value: string | undefined): Severity | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.toUpperCase();
  if (!["S0", "S1", "S2", "S3", "S4", "S5"].includes(normalized)) {
    throw new Error(`Invalid severity: ${value}`);
  }

  return normalized as Severity;
}

function parseNumberFlag(
  value: string | undefined,
  label: string,
): number | undefined {
  if (!value) {
    return undefined;
  }
  const num = Number(value);
  if (!Number.isFinite(num)) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
  return num;
}

function parseCodes(value: string | undefined): string[] | undefined {
  if (!value) {
    return undefined;
  }

  const codes = value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  return codes.length > 0 ? codes : undefined;
}

function parseSeverities(value: string | undefined): Severity[] | undefined {
  if (!value) {
    return undefined;
  }

  const severities = value
    .split(",")
    .map((part) => part.trim().toUpperCase())
    .filter((part) => ["S0", "S1", "S2", "S3", "S4", "S5"].includes(part))
    .map((part) => part as Severity);

  return severities.length > 0 ? severities : undefined;
}

async function resolveRepoSlug(args: string[]): Promise<string> {
  const configs = await loadRepoConfigs();
  if (configs.length === 0) {
    throw new Error("No repos configured. Run 'warden init <path>' first.");
  }

  const repoSlug = getFlagValue(args, "--repo") ?? configs[0]?.slug;
  if (!repoSlug) {
    throw new Error("Missing --repo and no default repo is configured.");
  }

  getRepoConfigBySlug(configs, repoSlug);
  return repoSlug;
}

async function runGrant(args: string[]): Promise<void> {
  const agentName = args[0];
  if (!agentName) {
    throw new Error(
      "Missing agent name. Usage: warden autonomy grant <agent> --repo <slug>",
    );
  }

  const slug = await resolveRepoSlug(args);
  const allowedCodes = parseCodes(getFlagValue(args, "--codes"));
  const maxSeverity = parseSeverity(getFlagValue(args, "--max-severity"));
  const minConsecutiveCleanMerges = parseNumberFlag(
    getFlagValue(args, "--min-clean"),
    "--min-clean",
  );
  const minValidationPassRate = parseNumberFlag(
    getFlagValue(args, "--min-pass-rate"),
    "--min-pass-rate",
  );
  const minTotalRuns = parseNumberFlag(
    getFlagValue(args, "--min-runs"),
    "--min-runs",
  );

  const trust = await loadTrustMetrics(slug, agentName);
  process.stdout.write(`Repo: ${slug}\n`);
  process.stdout.write(`Agent: ${agentName}\n`);
  process.stdout.write(`Current trust metrics:\n`);
  process.stdout.write(
    `- validation pass rate: ${(trust.validationPassRate * 100).toFixed(1)}%\n`,
  );
  process.stdout.write(
    `- consecutive clean merges: ${trust.consecutiveCleanMerges}\n`,
  );
  process.stdout.write(`- total runs: ${trust.totalRuns}\n`);
  process.stdout.write(`Requested rule:\n`);
  process.stdout.write(
    `- allowed codes: ${allowedCodes?.join(", ") ?? "all"}\n- max severity: ${maxSeverity ?? "default"}\n`,
  );

  const rl = readline.createInterface({ input, output });
  const confirm = await rl.question("Grant auto-merge rights? (yes/no): ");
  rl.close();
  if (confirm.trim().toLowerCase() !== "yes") {
    process.stdout.write("Grant cancelled.\n");
    return;
  }

  const rule = await grantAutonomyRule({
    slug,
    agentName,
    allowedCodes,
    maxSeverity,
    minConsecutiveCleanMerges,
    minValidationPassRate,
    minTotalRuns,
  });

  process.stdout.write(
    `Granted auto-merge for ${rule.agentName} on ${slug}.\n`,
  );
}

async function runGrantGlobal(args: string[]): Promise<void> {
  const agentName = getFlagValue(args, "--agent");
  if (!agentName) {
    throw new Error(
      "Missing --agent. Usage: warden autonomy grant --global --agent <name> --min-score <0-1>",
    );
  }

  const minScore = parseNumberFlag(
    getFlagValue(args, "--min-score"),
    "--min-score",
  );
  if (minScore === undefined) {
    throw new Error("Missing --min-score for global autonomy grant.");
  }

  const allowedCodes = parseCodes(getFlagValue(args, "--codes"));
  const allowedSeverities = parseSeverities(
    getFlagValue(args, "--allowed-severities"),
  );
  const appliesTo = parseCodes(getFlagValue(args, "--repos"));

  const policy = await grantGlobalAutonomyPolicy({
    agentName,
    minAggregateScore: minScore,
    allowedCodes,
    allowedSeverities,
    appliesTo,
  });

  process.stdout.write(
    `Granted global autonomy policy for ${policy.agentName} (min aggregate score ${policy.minAggregateScore}).\n`,
  );
}

async function runRevoke(args: string[]): Promise<void> {
  const agentName = args[0];
  if (!agentName) {
    throw new Error(
      "Missing agent name. Usage: warden autonomy revoke <agent> --repo <slug>",
    );
  }

  const slug = await resolveRepoSlug(args);
  const reason = getFlagValue(args, "--reason") ?? "Manual revoke";
  const rule = await revokeAutonomyRule(slug, agentName, reason);
  if (!rule) {
    process.stdout.write(`No autonomy rule found for ${agentName}.\n`);
    return;
  }

  process.stdout.write(`Revoked auto-merge for ${agentName}: ${reason}\n`);
}

async function runList(args: string[]): Promise<void> {
  const slug = await resolveRepoSlug(args);
  const rules = await listAutonomyRules(slug);
  if (rules.length === 0) {
    process.stdout.write(`No autonomy rules configured for ${slug}.\n`);
    return;
  }

  process.stdout.write(`Autonomy rules for ${slug}:\n`);
  for (const rule of rules) {
    process.stdout.write(
      `- ${rule.agentName} | enabled=${rule.enabled} | codes=${rule.allowedCodes?.join(",") ?? "all"} | maxSeverity=${rule.maxSeverity ?? "S3"}`,
    );
    if (rule.revocationReason) {
      process.stdout.write(` | revoked: ${rule.revocationReason}`);
    }
    process.stdout.write("\n");
  }
}

async function runListGlobal(): Promise<void> {
  const policies = await listGlobalAutonomyPolicies();
  if (policies.length === 0) {
    process.stdout.write("No global autonomy policies configured.\n");
    return;
  }

  process.stdout.write("Global autonomy policies:\n");
  for (const policy of policies) {
    process.stdout.write(
      `- ${policy.agentName} | minAggregateScore=${policy.minAggregateScore} | severities=${policy.allowedSeverities.join(",")} | codes=${policy.allowedCodes.join(",") || "all"} | appliesTo=${policy.appliesTo.join(",") || "all"}\n`,
    );
  }
}

async function runImpact(args: string[]): Promise<void> {
  const slug = await resolveRepoSlug(args);
  const records = await loadImpactRecords(slug);
  if (records.length === 0) {
    process.stdout.write(`No auto-merge impact records for ${slug}.\n`);
    return;
  }

  process.stdout.write(`Recent auto-merge impact records for ${slug}:\n`);
  for (const record of records.slice(0, 20)) {
    const impactSummary = record.impact.revertDetected
      ? "reverted"
      : record.impact.newFindingsIntroduced.length > 0
        ? `introduced ${record.impact.newFindingsIntroduced.join(", ")}`
        : "clean";
    process.stdout.write(
      `- ${record.mergedAt} | ${record.agentName} | ${record.findingCode} | ${record.branch} | ${impactSummary}\n`,
    );
  }
}

export async function runAutonomyCommand(args: string[]): Promise<void> {
  const action = args[0];
  const rest = args.slice(1);
  const isGlobal = rest.includes("--global");

  if (!action || action === "--help" || action === "-h") {
    process.stdout.write("Usage:\n");
    process.stdout.write("  warden autonomy grant <agent> --repo <slug>\n");
    process.stdout.write(
      "  warden autonomy grant --global --agent <agent> --min-score <n> [--codes A,B] [--allowed-severities S2,S3] [--repos repo1,repo2]\n",
    );
    process.stdout.write("  warden autonomy revoke <agent> --repo <slug>\n");
    process.stdout.write("  warden autonomy list --repo <slug>\n");
    process.stdout.write("  warden autonomy list --global\n");
    process.stdout.write("  warden autonomy impact --repo <slug>\n");
    return;
  }

  if (action === "grant") {
    if (isGlobal) {
      await runGrantGlobal(rest);
      return;
    }
    await runGrant(rest);
    return;
  }
  if (action === "revoke") {
    await runRevoke(rest);
    return;
  }
  if (action === "list") {
    if (isGlobal) {
      await runListGlobal();
      return;
    }
    await runList(rest);
    return;
  }
  if (action === "impact") {
    await runImpact(rest);
    return;
  }

  throw new Error(`Unknown autonomy action: ${action}`);
}
