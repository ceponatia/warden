export type FindingMetric = "M1" | "M2" | "M3" | "M4" | "M5" | "M6" | "M9";

export interface FindingCodeDef {
  code: string;
  metric: FindingMetric;
  shortDescription: string;
  wikiPath: string;
}

export interface FindingInstance {
  code: string;
  metric: FindingMetric;
  summary: string;
  path?: string;
  symbol?: string;
}

export interface RepoSuppression {
  pattern: string;
  codes: string[];
  reason?: string;
}
