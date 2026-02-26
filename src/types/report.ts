import type { FindingMetric } from "./findings.js";
import type { Severity, TrustMetrics } from "./work.js";

export interface StructuredReport {
  timestamp: string;
  repoSlug: string;
  branch: string;
  findings: StructuredFinding[];
  workDocumentSummary: WorkDocumentSummary;
  agentActivity: AgentActivityEntry[];
  trustScores: TrustMetrics[];
  improvements: string[];
  metricSnapshots: {
    /** Files changed in the 7-day git window (not a repo-wide total). */
    filesChangedIn7d: number;
    /** Lines added + removed in the 7-day git window (churn, not repo LOC). */
    locChurnIn7d: number;
    staleFileCount: number;
    todoCount: number;
    complexityFindings: number;
    boundaryViolations: number;
  };
}

export interface StructuredFinding {
  code: string;
  metric: FindingMetric;
  severity: Severity;
  summary: string;
  path?: string;
  symbol?: string;
  consecutiveReports: number;
  trend: "worsening" | "stable" | "improving" | "new";
  workDocumentId?: string;
}

export interface WorkDocumentSummary {
  unassigned: number;
  autoAssigned: number;
  agentInProgress: number;
  agentComplete: number;
  pmReview: number;
  blocked: number;
  resolvedThisReport: number;
  totalActive: number;
}

export interface AgentActivityEntry {
  agentName: string;
  action: string;
  findingCode: string;
  branch?: string;
  validationPassed?: boolean;
  validationAttempts?: number;
}
