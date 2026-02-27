import type { FindingInstance } from "../types/findings.js";
import type { Severity, WorkDocument } from "../types/work.js";

const DEFAULT_SEVERITY: Record<string, Severity> = {
  "WD-M1-001": "S3",
  "WD-M1-002": "S3",
  "WD-M1-003": "S3",
  "WD-M2-001": "S4",
  "WD-M2-002": "S3",
  "WD-M2-003": "S4",
  "WD-M3-001": "S3",
  "WD-M3-002": "S3",
  "WD-M4-001": "S2",
  "WD-M4-002": "S2",
  "WD-M4-003": "S1",
  "WD-M5-001": "S1",
  "WD-M5-002": "S2",
  "WD-M5-003": "S1",
  "WD-M6-001": "S4",
  "WD-M6-002": "S3",
  "WD-M6-003": "S3",
  "WD-M6-004": "S3",
  "WD-M7-001": "S3",
  "WD-M7-002": "S2",
  "WD-M7-003": "S2",
  "WD-M8-001": "S4",
  "WD-M8-002": "S3",
  "WD-M8-003": "S4",
  "WD-M9-001": "S5",
  "WD-M9-002": "S5",
  "WD-M9-003": "S4",
};

export function assignInitialSeverity(finding: FindingInstance): Severity {
  return DEFAULT_SEVERITY[finding.code] ?? "S3";
}

function severityLevel(s: Severity): number {
  return Number(s[1]);
}

function severityFromLevel(level: number): Severity {
  const clamped = Math.min(5, Math.max(0, level));
  return `S${clamped}` as Severity;
}

export function evaluatePromotion(doc: WorkDocument): Severity | null {
  if (doc.trend !== "worsening") {
    return null;
  }
  if (doc.consecutiveReports < 2) {
    return null;
  }
  const current = severityLevel(doc.severity);
  if (current <= 1) {
    return null; // S0 reserved for manual, S1 is cap
  }
  return severityFromLevel(current - 1);
}

export function evaluateDemotion(doc: WorkDocument): Severity | null {
  if (doc.trend !== "improving") {
    return null;
  }
  if (doc.consecutiveReports < 2) {
    return null;
  }
  const current = severityLevel(doc.severity);
  if (current >= 4) {
    return null; // S4 floor for auto-demotion
  }
  return severityFromLevel(current + 1);
}

export function computeTrend(
  doc: WorkDocument,
  currentFinding: FindingInstance,
): "worsening" | "stable" | "improving" | "new" {
  if (doc.consecutiveReports === 0) {
    return "new";
  }

  // Only compare against the last "Report update:" note to avoid using
  // the initial severity note text as a metric value.
  const reportNotes = doc.notes.filter((n) => n.text.startsWith("Report update:"));
  const lastReportNote = reportNotes[reportNotes.length - 1];
  const prevNumbers = extractNumbers(lastReportNote?.text ?? "");
  const currNumbers = extractNumbers(currentFinding.summary);

  if (prevNumbers.length === 0 || currNumbers.length === 0) {
    return "stable";
  }

  const prevVal = prevNumbers[0] ?? 0;
  const currVal = currNumbers[0] ?? 0;

  if (currVal > prevVal) {
    return "worsening";
  }
  if (currVal < prevVal) {
    return "improving";
  }
  return "stable";
}

function extractNumbers(text: string): number[] {
  const matches = text.match(/[\d.]+/g);
  if (!matches) {
    return [];
  }
  return matches.map(Number).filter((n) => !Number.isNaN(n));
}
