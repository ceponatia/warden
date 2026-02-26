import * as vscode from "vscode";

import { resolveFindingPath } from "./pathing";
import type {
  RepoSettings,
  StructuredFinding,
  StructuredReport,
  Severity,
} from "./types";

function mapSeverity(severity: Severity): vscode.DiagnosticSeverity {
  if (severity === "S0" || severity === "S1") {
    return vscode.DiagnosticSeverity.Error;
  }
  if (severity === "S2" || severity === "S3") {
    return vscode.DiagnosticSeverity.Warning;
  }
  return vscode.DiagnosticSeverity.Information;
}

function toDiagnostic(finding: StructuredFinding): vscode.Diagnostic {
  const message = `[${finding.code}] ${finding.summary}`;
  const diagnostic = new vscode.Diagnostic(
    new vscode.Range(0, 0, 0, 0),
    message,
    mapSeverity(finding.severity),
  );
  diagnostic.source = "Warden";
  diagnostic.code = {
    value: finding.code,
    target: vscode.Uri.parse(`warden://wiki/${finding.code}`),
  };
  return diagnostic;
}

export class WardenDiagnostics {
  private readonly collection =
    vscode.languages.createDiagnosticCollection("warden");

  refresh(report: StructuredReport | null, settings: RepoSettings): void {
    this.collection.clear();
    if (!report) {
      return;
    }

    const perFile = new Map<string, vscode.Diagnostic[]>();
    for (const finding of report.findings) {
      if (!finding.path || !settings.severityFilter.has(finding.severity)) {
        continue;
      }

      const fsPath = resolveFindingPath(
        finding.path,
        settings.workspaceRoot,
        settings.repoRoot,
      );
      const uri = vscode.Uri.file(fsPath);
      const bucket = perFile.get(uri.toString()) ?? [];
      bucket.push(toDiagnostic(finding));
      perFile.set(uri.toString(), bucket);
    }

    for (const [uriText, diagnostics] of perFile.entries()) {
      this.collection.set(vscode.Uri.parse(uriText), diagnostics);
    }
  }

  dispose(): void {
    this.collection.dispose();
  }
}
