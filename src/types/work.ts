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

export const VALID_STATUSES: WorkDocumentStatus[] = [
  "unassigned",
  "auto-assigned",
  "agent-in-progress",
  "agent-complete",
  "pm-review",
  "blocked",
  "resolved",
  "wont-fix",
];

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
  prReviewScore: number;
  validationPassRate: number;
  selfRepairRate: number;
  consecutiveCleanMerges: number;
  totalRuns: number;
  lastRunAt: string;
}

export interface PrReviewRecord {
  reviewedAt: string;
  passed: boolean;
  comments: string[];
}

export interface AutonomyGlobalDefaults {
  minConsecutiveCleanMerges: number;
  minValidationPassRate: number;
  minTotalRuns: number;
  maxSeverity: Severity;
}

export interface AutonomyRuleConditions {
  minConsecutiveCleanMerges?: number;
  minValidationPassRate?: number;
  minTotalRuns?: number;
}

export interface AutonomyRule {
  agentName: string;
  enabled: boolean;
  grantedAt: string;
  grantedBy: "manual";
  allowedCodes?: string[];
  maxSeverity?: Severity;
  conditions: AutonomyRuleConditions;
  revokedAt?: string;
  revocationReason?: string;
}

export interface AutonomyConfig {
  rules: AutonomyRule[];
  globalDefaults: AutonomyGlobalDefaults;
}

export interface GlobalAutonomyPolicy {
  agentName: string;
  minAggregateScore: number;
  allowedSeverities: Severity[];
  allowedCodes: string[];
  appliesTo: string[];
  createdAt: string;
  createdBy: "manual";
}

export interface GlobalAutonomyConfig {
  policies: GlobalAutonomyPolicy[];
}

export interface MergeImpactAssessment {
  newFindingsIntroduced: string[];
  findingsResolved: string[];
  revertDetected: boolean;
  subsequentChurn: number;
}

export interface MergeImpactRecord {
  mergeId: string;
  agentName: string;
  findingCode: string;
  branch: string;
  files: string[];
  mergedAt: string;
  autoMerged: boolean;
  impact: MergeImpactAssessment;
  assessedAt: string;
}
