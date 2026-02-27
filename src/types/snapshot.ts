import type { RepoSuppression } from "./findings.js";

export interface RepoThresholds {
  staleDays: number;
  highChurnEdits: number;
  growthMultiplier: number;
  directoryGrowthPct: number;
  highRewriteRatio: number;
  complexityHotspotCount: number;
  largeFileGrowthLines: number;
  lowRouteHitCount: number;
  newFileClusterCount: number;
  stalePrDays: number;
  maxOpenPrs: number;
  ciFailureRatePct: number;
  staleBranchDays: number;
}

export interface RepoRetention {
  snapshots: number;
  reports: number;
}

export interface RepoConfig {
  slug: string;
  path: string;
  type: string;
  sourceRoots: string[];
  testPatterns: string[];
  docFiles: string[];
  ignorePatterns: string[];
  scopeFile?: string;
  thresholds: RepoThresholds;
  retention: RepoRetention;
  commitThreshold: number;
  suppressions?: RepoSuppression[];
  githubRepo?: string;
}

export type MetricTag =
  | "size"
  | "staleness"
  | "growth"
  | "churn"
  | "imports"
  | "debt"
  | "complexity"
  | "runtime";

export interface ScopeRule {
  pattern: string;
  action: "ignore" | "scoped";
  metrics?: MetricTag[];
}

export interface FileScope {
  ignored: boolean;
  metrics: MetricTag[];
}

export interface CollectorMetadata {
  collectedAt: string;
  branch: string;
}

export interface FileGrowthEntry {
  path: string;
  linesAdded: number;
  linesRemoved: number;
  netGrowth: number;
  growthRatio: number;
}

export interface DirGrowthEntry {
  path: string;
  totalLinesAdded: number;
  growthPct: number;
  newFiles: number;
}

export interface ChurnEntry {
  path: string;
  editCount: number;
  addDeleteRatio: number;
}

export interface WindowStats {
  totalFilesChanged: number;
  totalLinesAdded: number;
  totalLinesRemoved: number;
  repoAverageGrowth: number;
  files: FileGrowthEntry[];
  directories: DirGrowthEntry[];
  highChurnFiles: ChurnEntry[];
}

export interface GitStatsSnapshot extends CollectorMetadata {
  windows: {
    "7d": WindowStats;
    "30d": WindowStats;
    "90d": WindowStats;
  };
}

export interface StaleFileEntry {
  path: string;
  lastCommitDate: string;
  daysSinceLastCommit: number;
  isImported: boolean;
  importedBy: string[];
  importCheckSkipped?: boolean;
  fileSizeBytes?: number;
}

export interface StaleDirEntry {
  path: string;
  oldestFile: string;
  newestCommitDate: string;
  daysSinceActivity: number;
}

export interface StalenessSnapshot extends CollectorMetadata {
  staleFiles: StaleFileEntry[];
  staleDirectories: StaleDirEntry[];
}

export interface MarkerEntry {
  line: number;
  text: string;
}

export interface DebtFileEntry {
  path: string;
  todos: MarkerEntry[];
  fixmes: MarkerEntry[];
  hacks: MarkerEntry[];
  eslintDisables: MarkerEntry[];
  anyCasts: number;
}

export interface DebtMarkersSnapshot extends CollectorMetadata {
  summary: {
    totalTodos: number;
    totalFixmes: number;
    totalHacks: number;
    totalEslintDisables: number;
    totalAnyCasts: number;
  };
  files: DebtFileEntry[];
}

export interface ComplexityFinding {
  path: string;
  ruleId: string;
  message: string;
  line: number;
  severity: "warning" | "error";
}

export interface ComplexitySnapshot extends CollectorMetadata {
  summary: {
    totalFindings: number;
    complexityWarnings: number;
    maxLinesWarnings: number;
  };
  findings: ComplexityFinding[];
}

export interface ImportDeepImportFinding {
  importer: string;
  target: string;
}

export interface ImportDependencyFinding {
  importer: string;
  dependency: string;
}

export interface ImportsSnapshot extends CollectorMetadata {
  summary: {
    filesScanned: number;
    deepImports: number;
    undeclaredDependencies: number;
    circularChains: number;
  };
  deepImportFindings: ImportDeepImportFinding[];
  undeclaredDependencyFindings: ImportDependencyFinding[];
  circularChains: string[][];
}

export interface RuntimeRouteHit {
  route: string;
  method: string;
  count: number;
}

export interface RuntimeCoverageEntry {
  path: string;
  coveredFunctions: number;
  totalFunctions: number;
}

export interface RuntimeSnapshot extends CollectorMetadata {
  summary: {
    apiHitEvents: number;
    uniqueRoutes: number;
    coverageFiles: number;
  };
  routeHits: RuntimeRouteHit[];
  coverage: RuntimeCoverageEntry[];
}

export interface GitHubPrEntry {
  number: number;
  title: string;
  author: string;
  createdAt: string;
  updatedAt: string;
  daysSinceUpdate: number;
  isDraft: boolean;
}

export interface GitHubBranchEntry {
  name: string;
  lastCommitDate: string;
  daysSinceCommit: number;
  isProtected: boolean;
}

export interface GitHubCiRunEntry {
  workflowName: string;
  conclusion: "success" | "failure" | "cancelled" | "skipped" | string;
  runAt: string;
}

export interface GitHubSnapshot extends CollectorMetadata {
  summary: {
    openPrs: number;
    stalePrs: number;
    staleBranches: number;
    ciRunsAnalyzed: number;
    ciFailureRatePct: number;
  };
  stalePrs: GitHubPrEntry[];
  staleBranches: GitHubBranchEntry[];
  recentCiRuns: GitHubCiRunEntry[];
}

export interface SnapshotBundle {
  gitStats: GitStatsSnapshot;
  staleness: StalenessSnapshot;
  debtMarkers: DebtMarkersSnapshot;
  complexity?: ComplexitySnapshot;
  imports?: ImportsSnapshot;
  runtime?: RuntimeSnapshot;
  github?: GitHubSnapshot;
}
