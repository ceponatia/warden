export type Severity = "S0" | "S1" | "S2" | "S3" | "S4" | "S5";

export interface StructuredFinding {
  code: string;
  severity: Severity;
  summary: string;
  path?: string;
  symbol?: string;
  trend: "worsening" | "stable" | "improving" | "new";
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
  validationPassed?: boolean;
}

export interface TrustMetrics {
  agentName: string;
  validationPassRate: number;
}

export interface StructuredReport {
  timestamp: string;
  repoSlug: string;
  findings: StructuredFinding[];
  workDocumentSummary: WorkDocumentSummary;
  agentActivity: AgentActivityEntry[];
  trustScores: TrustMetrics[];
}

export type WorkDocumentStatus =
  | "unassigned"
  | "auto-assigned"
  | "agent-in-progress"
  | "agent-complete"
  | "pm-review"
  | "blocked"
  | "resolved"
  | "wont-fix";

export interface WorkDocument {
  findingId: string;
  code: string;
  status: WorkDocumentStatus;
  notes: Array<{ timestamp: string; author: string; text: string }>;
}

export interface ReportBundle {
  report: StructuredReport | null;
  markdown: string;
  jsonPath?: string;
  markdownPath?: string;
}

export interface RepoSettings {
  workspaceRoot: string;
  dataPath: string;
  repoSlug: string;
  autoRefresh: boolean;
  severityFilter: Set<Severity>;
  repoRoot?: string;
}

export interface WikiEntry {
  code: string;
  description: string;
  wikiPath: string;
}
