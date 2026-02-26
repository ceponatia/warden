import { loadAllowlist } from "../config/allowlist.js";
import { evaluateFindings } from "../findings/evaluate.js";
import type { RepoConfig } from "../types/snapshot.js";
import {
  loadLatestSnapshot,
  loadLatestSnapshotForBranch,
  loadPreviousSnapshot,
} from "../snapshots.js";
import { updateWikiPageForResolvedFinding } from "./wiki-agent.js";
import { computeDelta } from "./delta.js";
import { assemblePrompt } from "./prompt.js";
import { callProvider } from "./provider.js";

export interface AnalysisResult {
  analysis: string;
  snapshotTimestamp: string;
}

export interface AnalysisOptions {
  compareBranch?: string;
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
  let baselineFindings: ReturnType<typeof evaluateFindings> = [];

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
    const currentCodes = new Set(
      currentFindings.map((finding) => finding.code),
    );
    const resolvedCodes = [
      ...new Set(baselineFindings.map((finding) => finding.code)),
    ]
      .filter((code) => !currentCodes.has(code))
      .slice(0, 5);

    for (const code of resolvedCodes) {
      const baselineCount = baselineFindings.filter(
        (f) => f.code === code,
      ).length;
      const contextLine = [
        `Resolved between snapshots (${deltaContextLabel ?? "current run"}).`,
        `Previously triggered ${baselineCount} time(s); no longer active in the current snapshot.`,
        `Current active findings: ${currentFindings.length}.`,
        delta
          ? `Delta summary — stale files: ${delta.staleFilesDelta ?? "n/a"}, TODOs: ${delta.totalTodosDelta ?? "n/a"}, complexity: ${delta.complexityFindingsDelta ?? "n/a"}.`
          : "",
      ]
        .filter(Boolean)
        .join(" ");
      try {
        await updateWikiPageForResolvedFinding(code, contextLine);
      } catch {
        // Ignore wiki update failures so analysis remains non-blocking.
      }
    }
  }

  return { analysis, snapshotTimestamp };
}
