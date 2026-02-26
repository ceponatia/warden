import type { FindingMetric } from "./findings.js";

export type Severity = "S0" | "S1" | "S2" | "S3" | "S4" | "S5";

export type WorkDocumentStatus =
  | "unassigned"
  | "auto-assigned"
  | "agent-in-progress"
  | "agent-complete"
  | "pm-review"
  | "blocked"
  | "resolved"
  | "wont-fix";

export interface WorkDocumentNote {
  timestamp: string;
  author: string;
  text: string;
}

export interface ValidationResult {
  passed: boolean;
  attempts: number;
  lastError?: string;
}

export interface WorkDocument {
  findingId: string;
  code: string;
  metric: FindingMetric;
  severity: Severity;
  path?: string;
  symbol?: string;
  firstSeen: string;
  lastSeen: string;
  consecutiveReports: number;
  trend: "worsening" | "stable" | "improving" | "new";
  status: WorkDocumentStatus;
  assignedTo?: string;
  relatedBranch?: string;
  planDocument?: string;
  validationResult?: ValidationResult;
  notes: WorkDocumentNote[];
  resolvedAt?: string;
}

export interface TrustMetrics {
  agentName: string;
  mergesAccepted: number;
  mergesModified: number;
  mergesRejected: number;
  validationPassRate: number;
  selfRepairRate: number;
  consecutiveCleanMerges: number;
  totalRuns: number;
  lastRunAt: string;
}
