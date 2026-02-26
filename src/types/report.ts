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
    totalFiles: number;
    totalLoc: number;
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
  blocked: number;
  resolvedThisReport: number;
}

export interface AgentActivityEntry {
  agentName: string;
  action: string;
  findingCode: string;
  branch?: string;
  validationPassed?: boolean;
  validationAttempts?: number;
}
