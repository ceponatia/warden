import type { FindingCodeDef, FindingMetric } from "../types/findings.js";

export const FINDING_CODE_REGISTRY: FindingCodeDef[] = [
  {
    code: "WD-M1-001",
    metric: "M1",
    shortDescription: "File growth exceeds threshold (>Nx repo average)",
    wikiPath: "wiki/WD-M1-001.md",
  },
  {
    code: "WD-M1-002",
    metric: "M1",
    shortDescription: "Directory growth exceeds threshold (>N%)",
    wikiPath: "wiki/WD-M1-002.md",
  },
  {
    code: "WD-M1-003",
    metric: "M1",
    shortDescription: "New file cluster detected",
    wikiPath: "wiki/WD-M1-003.md",
  },
  {
    code: "WD-M2-001",
    metric: "M2",
    shortDescription: "Stale file still imported",
    wikiPath: "wiki/WD-M2-001.md",
  },
  {
    code: "WD-M2-002",
    metric: "M2",
    shortDescription: "Stale file not imported",
    wikiPath: "wiki/WD-M2-002.md",
  },
  {
    code: "WD-M2-003",
    metric: "M2",
    shortDescription: "Stale directory",
    wikiPath: "wiki/WD-M2-003.md",
  },
  {
    code: "WD-M3-001",
    metric: "M3",
    shortDescription: "High churn file (>N edits in window)",
    wikiPath: "wiki/WD-M3-001.md",
  },
  {
    code: "WD-M3-002",
    metric: "M3",
    shortDescription: "High add/delete ratio (rewrite risk)",
    wikiPath: "wiki/WD-M3-002.md",
  },
  {
    code: "WD-M4-001",
    metric: "M4",
    shortDescription: "Function approaching complexity limit",
    wikiPath: "wiki/WD-M4-001.md",
  },
  {
    code: "WD-M4-002",
    metric: "M4",
    shortDescription: "Function approaching line-count limit",
    wikiPath: "wiki/WD-M4-002.md",
  },
  {
    code: "WD-M4-003",
    metric: "M4",
    shortDescription: "File with systemic complexity",
    wikiPath: "wiki/WD-M4-003.md",
  },
  {
    code: "WD-M5-001",
    metric: "M5",
    shortDescription: "Deep import into package internals",
    wikiPath: "wiki/WD-M5-001.md",
  },
  {
    code: "WD-M5-002",
    metric: "M5",
    shortDescription: "Undeclared cross-package dependency",
    wikiPath: "wiki/WD-M5-002.md",
  },
  {
    code: "WD-M5-003",
    metric: "M5",
    shortDescription: "Circular dependency chain",
    wikiPath: "wiki/WD-M5-003.md",
  },
  {
    code: "WD-M6-001",
    metric: "M6",
    shortDescription: "TODO/FIXME density increase",
    wikiPath: "wiki/WD-M6-001.md",
  },
  {
    code: "WD-M6-002",
    metric: "M6",
    shortDescription: "any type usage growth",
    wikiPath: "wiki/WD-M6-002.md",
  },
  {
    code: "WD-M6-003",
    metric: "M6",
    shortDescription: "eslint-disable comment growth",
    wikiPath: "wiki/WD-M6-003.md",
  },
  {
    code: "WD-M6-004",
    metric: "M6",
    shortDescription: "Large file still growing",
    wikiPath: "wiki/WD-M6-004.md",
  },
  {
    code: "WD-M9-001",
    metric: "M9",
    shortDescription: "API route received zero hits",
    wikiPath: "wiki/WD-M9-001.md",
  },
  {
    code: "WD-M9-002",
    metric: "M9",
    shortDescription: "API route with low hit count",
    wikiPath: "wiki/WD-M9-002.md",
  },
  {
    code: "WD-M9-003",
    metric: "M9",
    shortDescription: "Module never loaded at runtime",
    wikiPath: "wiki/WD-M9-003.md",
  },
];

const FINDING_CODE_MAP = new Map(
  FINDING_CODE_REGISTRY.map((definition) => [definition.code, definition]),
);

export function lookupCode(code: string): FindingCodeDef | undefined {
  return FINDING_CODE_MAP.get(code);
}

export function listCodes(): FindingCodeDef[] {
  return [...FINDING_CODE_REGISTRY];
}

export function codesForMetric(metric: FindingMetric): FindingCodeDef[] {
  return FINDING_CODE_REGISTRY.filter(
    (definition) => definition.metric === metric,
  );
}
