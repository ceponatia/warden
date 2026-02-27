import { loadAllowlist } from "../config/allowlist.js";
import { evaluateFindings } from "../findings/evaluate.js";
import type { FindingInstance } from "../types/findings.js";
import type { RepoConfig } from "../types/snapshot.js";
import type { WorkDocument } from "../types/work.js";
import type { LoadedSnapshot } from "../snapshots.js";
import {
  loadLatestSnapshot,
  loadLatestSnapshotForBranch,
  loadPreviousSnapshot,
} from "../snapshots.js";
import {
  createWorkDocument,
  generateFindingId,
  loadWorkDocuments,
  resolveWorkDocument,
  saveWorkDocument,
  addNote,
} from "../work/manager.js";
import {
  assignInitialSeverity,
  computeTrend,
  evaluateDemotion,
  evaluatePromotion,
} from "../work/severity.js";
import { detectEscalations, writeAlert } from "../work/escalation.js";
import { evaluateRevocations, loadAutonomyConfig } from "../work/autonomy.js";
import { assessImpactRecords } from "../work/impact.js";
import { runPlanningAgent } from "./planning-agent.js";
import { updateWikiPageForResolvedFinding } from "./wiki-agent.js";
import { computeDelta } from "./delta.js";
import { assemblePrompt } from "./prompt.js";
import { callProvider } from "./provider.js";

export interface AnalysisResult {
  analysis: string;
  snapshotTimestamp: string;
  snapshot: LoadedSnapshot;
  findings: FindingInstance[];
  improvements: string[];
  workDocumentSummary?: WorkDocumentSummary;
}

export interface WorkDocumentSummary {
  total: number;
  unassigned: number;
  autoAssigned: number;
  agentComplete: number;
  blocked: number;
  resolvedThisRun: number;
  escalations: string[];
}

function renderAutoMergeActivity(params: {
  activeRules: Awaited<ReturnType<typeof loadAutonomyConfig>>["rules"];
  impacts: Awaited<ReturnType<typeof assessImpactRecords>>;
  revoked: Awaited<ReturnType<typeof evaluateRevocations>>;
}): string {
  const lines: string[] = ["## Auto-Merge Activity", ""];

  const active = params.activeRules.filter((rule) => rule.enabled);
  lines.push("### Grants Active");
  if (active.length === 0) {
    lines.push("(none)");
  } else {
    lines.push(
      "| Agent | Allowed Codes | Max Severity | Since |",
      "|-------|--------------|--------------|-------|",
    );
    for (const rule of active) {
      lines.push(
        `| ${rule.agentName} | ${rule.allowedCodes?.join(", ") ?? "all"} | ${rule.maxSeverity ?? "S3"} | ${rule.grantedAt.slice(0, 10)} |`,
      );
    }
  }

  lines.push("", "### Recent Auto-Merges");
  const recent = params.impacts.slice(0, 10);
  if (recent.length === 0) {
    lines.push("(none this period)");
  } else {
    lines.push(
      "| Agent | Code | Branch | Merged | Impact |",
      "|-------|------|--------|--------|--------|",
    );
    for (const impact of recent) {
      const status = impact.impact.revertDetected
        ? "Reverted"
        : impact.impact.newFindingsIntroduced.length > 0
          ? `New findings: ${impact.impact.newFindingsIntroduced.join(", ")}`
          : "Clean";
      lines.push(
        `| ${impact.agentName} | ${impact.findingCode} | ${impact.branch} | ${impact.mergedAt.slice(0, 10)} | ${status} |`,
      );
    }
  }

  lines.push("", "### Revocations");
  if (params.revoked.length === 0) {
    lines.push("(none this period)");
  } else {
    for (const rule of params.revoked) {
      lines.push(`- ${rule.agentName}: ${rule.revocationReason ?? "revoked"}`);
    }
  }

  return lines.join("\n");
}

export interface AnalysisOptions {
  compareBranch?: string;
}

async function updateExistingWorkDoc(
  slug: string,
  existing: WorkDocument,
  finding: FindingInstance,
): Promise<void> {
  existing.lastSeen = new Date().toISOString();
  existing.consecutiveReports++;
  existing.trend = computeTrend(existing, finding);

  const promotion = evaluatePromotion(existing);
  if (promotion) {
    addNote(
      existing,
      "warden",
      `Severity promoted ${existing.severity} → ${promotion}.`,
    );
    existing.severity = promotion;
  }

  const demotion = evaluateDemotion(existing);
  if (demotion) {
    addNote(
      existing,
      "warden",
      `Severity demoted ${existing.severity} → ${demotion}.`,
    );
    existing.severity = demotion;
  }

  addNote(existing, "warden", `Report update: ${finding.summary}`);
  await saveWorkDocument(slug, existing);
}

async function syncWorkDocuments(
  slug: string,
  currentFindings: FindingInstance[],
): Promise<number> {
  const existingDocs = await loadWorkDocuments(slug);
  const existingDocMap = new Map(existingDocs.map((d) => [d.findingId, d]));
  const activeFindingIds = new Set<string>();
  let resolvedThisRun = 0;

  for (const finding of currentFindings) {
    const findingId = generateFindingId(finding);
    activeFindingIds.add(findingId);

    const existing = existingDocMap.get(findingId);
    if (existing) {
      await updateExistingWorkDoc(slug, existing, finding);
    } else {
      const severity = assignInitialSeverity(finding);
      const doc = createWorkDocument(finding, severity);
      await saveWorkDocument(slug, doc);
    }
  }

  for (const doc of existingDocs) {
    const shouldResolve =
      !activeFindingIds.has(doc.findingId) &&
      doc.status !== "resolved" &&
      doc.status !== "wont-fix";
    if (shouldResolve) {
      resolveWorkDocument(doc);
      resolvedThisRun++;
      await saveWorkDocument(slug, doc);
    }
  }

  return resolvedThisRun;
}

async function handleEscalations(slug: string): Promise<string[]> {
  const allDocs = await loadWorkDocuments(slug);
  const escalations = detectEscalations(allDocs);
  const messages: string[] = [];

  for (const doc of escalations) {
    await writeAlert(slug, doc);
    try {
      await runPlanningAgent(slug, doc);
      messages.push(
        `${doc.code} escalated to S1 after ${doc.consecutiveReports} reports. Plan: ${doc.planDocument}`,
      );
    } catch {
      doc.status = "blocked";
      addNote(doc, "warden", "Planning agent dispatch failed.");
      messages.push(
        `${doc.code} escalated but planning agent failed; marking as blocked.`,
      );
    }
    await saveWorkDocument(slug, doc);
  }

  return messages;
}

function buildWorkDocumentSummary(
  docs: WorkDocument[],
  resolvedThisRun: number,
  escalations: string[],
): WorkDocumentSummary {
  return {
    total: docs.filter(
      (d) => d.status !== "resolved" && d.status !== "wont-fix",
    ).length,
    unassigned: docs.filter((d) => d.status === "unassigned").length,
    autoAssigned: docs.filter((d) => d.status === "auto-assigned").length,
    agentComplete: docs.filter((d) => d.status === "agent-complete").length,
    blocked: docs.filter((d) => d.status === "blocked").length,
    resolvedThisRun,
    escalations,
  };
}

function renderWorkDocumentStatus(summary: WorkDocumentSummary): string {
  const lines: string[] = [
    "## Work Document Status",
    "",
    "| Status | Count |",
    "|--------|-------|",
    `| Unassigned | ${summary.unassigned} |`,
    `| Auto-assigned | ${summary.autoAssigned} |`,
    `| Agent complete | ${summary.agentComplete} |`,
    `| Blocked | ${summary.blocked} |`,
    `| Resolved this run | ${summary.resolvedThisRun} |`,
    `| **Active total** | **${summary.total}** |`,
  ];

  if (summary.escalations.length > 0) {
    lines.push("", "### Escalations");
    for (const msg of summary.escalations) {
      lines.push(`- ${msg}`);
    }
  }

  return lines.join("\n");
}

async function updateWikiForResolved(
  baselineFindings: FindingInstance[],
  currentFindings: FindingInstance[],
  deltaContextLabel: string | undefined,
  delta: import("./delta.js").SnapshotDelta | undefined,
): Promise<void> {
  const currentCodes = new Set(currentFindings.map((f) => f.code));
  const resolvedCodes = [...new Set(baselineFindings.map((f) => f.code))]
    .filter((code) => !currentCodes.has(code))
    .slice(0, 5);

  for (const code of resolvedCodes) {
    const baselineCount = baselineFindings.filter(
      (f) => f.code === code,
    ).length;
    const contextLine = [
      `Resolved between snapshots (${deltaContextLabel ?? "current run"}).`,
      `Previously triggered ${baselineCount} time(s); no longer active.`,
      `Current active findings: ${currentFindings.length}.`,
      delta
        ? `Delta — stale files: ${delta.staleFilesDelta}, TODOs: ${delta.totalTodosDelta}, complexity: ${delta.complexityFindingsDelta ?? "n/a"}.`
        : "",
    ]
      .filter(Boolean)
      .join(" ");
    try {
      await updateWikiPageForResolvedFinding(code, contextLine);
    } catch {
      // Non-blocking
    }
  }
}

function findResolvedCodes(
  baselineFindings: FindingInstance[],
  currentFindings: FindingInstance[],
): string[] {
  const currentCodes = new Set(currentFindings.map((f) => f.code));
  return [...new Set(baselineFindings.map((f) => f.code))]
    .filter((code) => !currentCodes.has(code))
    .slice(0, 5);
}

export async function runAnalysis(
  config: RepoConfig,
  options?: AnalysisOptions,
): Promise<AnalysisResult> {
  const allowlist = await loadAllowlist(config);
  const currentSnapshot = await loadLatestSnapshot(config.slug);
  const snapshotTimestamp = currentSnapshot.timestamp;
  const currentFindings = evaluateFindings(
    config,
    currentSnapshot,
    allowlist.rules,
  );

  let delta = undefined;
  let deltaContextLabel = undefined;
  let baselineFindings: FindingInstance[] = [];

  if (options?.compareBranch) {
    const baseline = await loadLatestSnapshotForBranch(
      config.slug,
      options.compareBranch,
    );
    delta = computeDelta(baseline, currentSnapshot);
    deltaContextLabel = `vs branch ${options.compareBranch}`;
    baselineFindings = evaluateFindings(config, baseline, allowlist.rules);
  } else {
    const previous = await loadPreviousSnapshot(config.slug);
    if (previous) {
      delta = computeDelta(previous, currentSnapshot);
      deltaContextLabel = "vs previous snapshot";
      baselineFindings = evaluateFindings(config, previous, allowlist.rules);
    }
  }

  const resolvedThisRun = await syncWorkDocuments(config.slug, currentFindings);
  const escalationMessages = await handleEscalations(config.slug);
  const impacts = await assessImpactRecords(
    config.slug,
    config.path,
    currentFindings,
  );
  const revokedRules = await evaluateRevocations({
    slug: config.slug,
    impacts,
  });
  const autonomyConfig = await loadAutonomyConfig(config.slug);
  const allDocs = await loadWorkDocuments(config.slug);

  if (revokedRules.length > 0) {
    for (const doc of allDocs) {
      const revokedRule = revokedRules.find(
        (rule) => rule.agentName === doc.assignedTo,
      );
      if (!revokedRule) {
        continue;
      }

      addNote(
        doc,
        "autonomy",
        `Auto-merge rights revoked for ${revokedRule.agentName}: ${revokedRule.revocationReason ?? "rule disabled"}`,
      );
      await saveWorkDocument(config.slug, doc);
    }
  }

  const workDocumentSummary = buildWorkDocumentSummary(
    allDocs,
    resolvedThisRun,
    escalationMessages,
  );

  const userPrompt = assemblePrompt(
    config,
    currentSnapshot,
    delta,
    deltaContextLabel,
    currentFindings,
  );
  const analysis = await callProvider({
    systemPrompt:
      "You are Warden, a repository health analyst. Analyze the provided snapshot data and produce a concise, actionable maintenance report with prioritized next steps. Use markdown. Stay under 600 words.",
    userPrompt,
  });

  if (baselineFindings.length > 0) {
    const improvements = findResolvedCodes(baselineFindings, currentFindings);
    await updateWikiForResolved(
      baselineFindings,
      currentFindings,
      deltaContextLabel,
      delta,
    );
    const workStatusSection = renderWorkDocumentStatus(workDocumentSummary);
    const autoMergeSection = renderAutoMergeActivity({
      activeRules: autonomyConfig.rules,
      impacts,
      revoked: revokedRules,
    });
    const fullAnalysis = `${analysis}\n\n${workStatusSection}\n\n${autoMergeSection}`;

    return {
      analysis: fullAnalysis,
      snapshotTimestamp,
      snapshot: currentSnapshot,
      findings: currentFindings,
      improvements,
      workDocumentSummary,
    };
  }

  const workStatusSection = renderWorkDocumentStatus(workDocumentSummary);
  const autoMergeSection = renderAutoMergeActivity({
    activeRules: autonomyConfig.rules,
    impacts,
    revoked: revokedRules,
  });
  const fullAnalysis = `${analysis}\n\n${workStatusSection}\n\n${autoMergeSection}`;

  return {
    analysis: fullAnalysis,
    snapshotTimestamp,
    snapshot: currentSnapshot,
    findings: currentFindings,
    improvements: [],
    workDocumentSummary,
  };
}
