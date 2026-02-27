import type { FindingMetric } from "./findings.js";
import type { MergeImpactRecord, Severity, TrustMetrics } from "./work.js";

export interface StructuredReport {
  timestamp: string;
  repoSlug: string;
  branch: string;
  findings: StructuredFinding[];
  workDocumentSummary: WorkDocumentSummary;
  agentActivity: AgentActivityEntry[];
  trustScores: TrustMetrics[];
  autoMergeActivity: AutoMergeActivity;
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
    coverageAverage?: number;
    staleDocCount?: number;
  };
}

export interface AutoMergeActivity {
  activeGrants: AutoMergeGrant[];
  recentAutoMerges: MergeImpactRecord[];
  revocations: AutoMergeRevocation[];
}

export interface AutoMergeGrant {
  agentName: string;
  allowedCodes: string[] | null;
  maxSeverity: Severity;
  grantedAt: string;
}

export interface AutoMergeRevocation {
  agentName: string;
  revokedAt: string;
  reason: string;
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
