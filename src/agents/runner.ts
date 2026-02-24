import type { RepoConfig } from "../types/snapshot.js";
import {
  loadLatestSnapshot,
  loadLatestSnapshotForBranch,
  loadPreviousSnapshot,
} from "../snapshots.js";
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
  const currentSnapshot = await loadLatestSnapshot(config.slug);
  const snapshotTimestamp = currentSnapshot.timestamp;

  let delta = undefined;
  let deltaContextLabel = undefined;

  if (options?.compareBranch) {
    const baseline = await loadLatestSnapshotForBranch(
      config.slug,
      options.compareBranch,
    );
    delta = computeDelta(baseline, currentSnapshot);
    deltaContextLabel = `vs branch ${options.compareBranch}`;
  } else {
    const previous = await loadPreviousSnapshot(config.slug);
    if (previous) {
      delta = computeDelta(previous, currentSnapshot);
      deltaContextLabel = "vs previous snapshot";
    }
  }

  const userPrompt = assemblePrompt(
    config,
    currentSnapshot,
    delta,
    deltaContextLabel,
  );
  const analysis = await callProvider({
    systemPrompt:
      "You are Warden, a repository health analyst. Analyze the provided snapshot data and produce a concise, actionable maintenance report with prioritized next steps. Use markdown. Stay under 600 words.",
    userPrompt,
  });

  return { analysis, snapshotTimestamp };
}
