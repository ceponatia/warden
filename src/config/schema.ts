import type {
  RepoConfig,
  RepoRetention,
  RepoThresholds,
} from "../types/snapshot.js";
import type { RepoSuppression } from "../types/findings.js";

export const DEFAULT_THRESHOLDS: RepoThresholds = {
  staleDays: 10,
  highChurnEdits: 5,
  growthMultiplier: 2,
  directoryGrowthPct: 20,
  highRewriteRatio: 3,
  complexityHotspotCount: 5,
  largeFileGrowthLines: 300,
  lowRouteHitCount: 2,
  newFileClusterCount: 6,
};

export const DEFAULT_RETENTION: RepoRetention = {
  snapshots: 10,
  reports: 10,
};

export const DEFAULT_COMMIT_THRESHOLD = 25;

function assertNonEmptyString(
  value: unknown,
  field: string,
): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Invalid repo config field: ${field}`);
  }
}

function asStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`Invalid repo config field: ${field}`);
  }

  return value.filter((item): item is string => typeof item === "string");
}

function resolvePositiveNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && value > 0 ? value : fallback;
}

function normalizeThresholds(
  rawThresholds: Partial<RepoThresholds> | undefined,
): RepoThresholds {
  const source = rawThresholds ?? DEFAULT_THRESHOLDS;

  return {
    staleDays: resolvePositiveNumber(
      source.staleDays,
      DEFAULT_THRESHOLDS.staleDays,
    ),
    highChurnEdits: resolvePositiveNumber(
      source.highChurnEdits,
      DEFAULT_THRESHOLDS.highChurnEdits,
    ),
    growthMultiplier: resolvePositiveNumber(
      source.growthMultiplier,
      DEFAULT_THRESHOLDS.growthMultiplier,
    ),
    directoryGrowthPct: resolvePositiveNumber(
      source.directoryGrowthPct,
      DEFAULT_THRESHOLDS.directoryGrowthPct,
    ),
    highRewriteRatio: resolvePositiveNumber(
      source.highRewriteRatio,
      DEFAULT_THRESHOLDS.highRewriteRatio,
    ),
    complexityHotspotCount: resolvePositiveNumber(
      source.complexityHotspotCount,
      DEFAULT_THRESHOLDS.complexityHotspotCount,
    ),
    largeFileGrowthLines: resolvePositiveNumber(
      source.largeFileGrowthLines,
      DEFAULT_THRESHOLDS.largeFileGrowthLines,
    ),
    lowRouteHitCount: resolvePositiveNumber(
      source.lowRouteHitCount,
      DEFAULT_THRESHOLDS.lowRouteHitCount,
    ),
    newFileClusterCount: resolvePositiveNumber(
      source.newFileClusterCount,
      DEFAULT_THRESHOLDS.newFileClusterCount,
    ),
  };
}

function normalizeSuppressions(value: unknown): RepoSuppression[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter(
      (item): item is RepoSuppression =>
        typeof item === "object" && item !== null,
    )
    .map((item) => ({
      pattern: typeof item.pattern === "string" ? item.pattern : "",
      codes: Array.isArray(item.codes)
        ? item.codes.filter((code): code is string => typeof code === "string")
        : [],
      reason: typeof item.reason === "string" ? item.reason : undefined,
    }))
    .filter((item) => item.pattern.length > 0 && item.codes.length > 0);
}

function normalizeRetention(
  rawRetention: Partial<RepoRetention> | undefined,
): RepoRetention {
  const source = rawRetention ?? DEFAULT_RETENTION;

  return {
    snapshots: resolvePositiveNumber(
      source.snapshots,
      DEFAULT_RETENTION.snapshots,
    ),
    reports: resolvePositiveNumber(source.reports, DEFAULT_RETENTION.reports),
  };
}

export function normalizeRepoConfig(value: unknown): RepoConfig {
  if (typeof value !== "object" || value === null) {
    throw new Error("Invalid repo config entry");
  }

  const raw = value as Partial<RepoConfig>;
  assertNonEmptyString(raw.slug, "slug");
  assertNonEmptyString(raw.path, "path");
  assertNonEmptyString(raw.type, "type");
  const thresholds = normalizeThresholds(raw.thresholds);
  const retention = normalizeRetention(raw.retention);
  const commitThreshold = resolvePositiveNumber(
    raw.commitThreshold,
    DEFAULT_COMMIT_THRESHOLD,
  );

  return {
    slug: raw.slug,
    path: raw.path,
    type: raw.type,
    sourceRoots: asStringArray(raw.sourceRoots ?? [], "sourceRoots"),
    testPatterns: asStringArray(raw.testPatterns ?? [], "testPatterns"),
    docFiles: asStringArray(raw.docFiles ?? [], "docFiles"),
    ignorePatterns: asStringArray(raw.ignorePatterns ?? [], "ignorePatterns"),
    scopeFile: typeof raw.scopeFile === "string" ? raw.scopeFile : undefined,
    thresholds,
    retention,
    commitThreshold,
    suppressions: normalizeSuppressions(raw.suppressions),
  };
}
