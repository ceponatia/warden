import * as vscode from "vscode";

import { resolveFindingPath } from "./pathing";
import type {
  RepoSettings,
  StructuredFinding,
  StructuredReport,
} from "./types";

type NodeKind =
  | "root"
  | "section"
  | "value"
  | "severity"
  | "finding"
  | "status"
  | "agent"
  | "trust";

interface Node {
  kind: NodeKind;
  label: string;
  description?: string;
  finding?: StructuredFinding;
  children?: Node[];
}

const SEVERITY_ORDER = ["S0", "S1", "S2", "S3", "S4", "S5"];

function severityNodes(findings: StructuredFinding[]): Node[] {
  return SEVERITY_ORDER.map((level): Node => {
    const hits = findings.filter((finding) => finding.severity === level);
    return {
      kind: "severity" as const,
      label: `${level} (${hits.length})`,
      children: hits.map((finding) => ({
        kind: "finding" as const,
        label: `[${finding.code}] ${finding.summary}`,
        description: finding.path,
        finding,
      })),
    };
  }).filter((node) => (node.children?.length ?? 0) > 0);
}

function rootNodes(report: StructuredReport): Node[] {
  return [
    {
      kind: "section",
      label: "Overview",
      children: [
        { kind: "value", label: `Last run: ${report.timestamp}` },
        { kind: "value", label: `Total findings: ${report.findings.length}` },
        {
          kind: "value",
          label: `Active work docs: ${report.workDocumentSummary.totalActive}`,
        },
      ],
    },
    {
      kind: "section",
      label: "By Severity",
      children: severityNodes(report.findings),
    },
    {
      kind: "section",
      label: "Work Documents",
      children: [
        {
          kind: "status",
          label: `Unassigned (${report.workDocumentSummary.unassigned})`,
        },
        {
          kind: "status",
          label: `Agent Complete (${report.workDocumentSummary.agentComplete})`,
        },
        {
          kind: "status",
          label: `Blocked (${report.workDocumentSummary.blocked})`,
        },
      ],
    },
    {
      kind: "section",
      label: "Agent Activity",
      children: report.agentActivity.slice(0, 20).map((entry) => ({
        kind: "agent",
        label: `${entry.agentName}: ${entry.action}`,
        description: entry.findingCode,
      })),
    },
    {
      kind: "section",
      label: "Trust Scores",
      children: report.trustScores.map((trust) => ({
        kind: "trust",
        label: `${trust.agentName}: ${Math.round(trust.validationPassRate * 100)}% pass rate`,
      })),
    },
  ];
}

export class WardenTreeProvider implements vscode.TreeDataProvider<Node> {
  private readonly changed = new vscode.EventEmitter<Node | void>();
  readonly onDidChangeTreeData = this.changed.event;

  private report: StructuredReport | null = null;
  private settings: RepoSettings | null = null;

  update(report: StructuredReport | null, settings: RepoSettings | null): void {
    this.report = report;
    this.settings = settings;
    this.changed.fire();
  }

  getTreeItem(element: Node): vscode.TreeItem {
    const collapsible = element.children?.length
      ? vscode.TreeItemCollapsibleState.Collapsed
      : vscode.TreeItemCollapsibleState.None;
    const item = new vscode.TreeItem(element.label, collapsible);
    item.description = element.description;

    if (element.kind === "finding" && element.finding?.path && this.settings) {
      const fsPath = resolveFindingPath(
        element.finding.path,
        this.settings.workspaceRoot,
        this.settings.repoRoot,
      );
      item.command = {
        command: "vscode.open",
        title: "Open finding file",
        arguments: [vscode.Uri.file(fsPath)],
      };
      item.tooltip = fsPath;
    }

    return item;
  }

  getChildren(element?: Node): Node[] {
    if (element?.children) {
      return element.children;
    }
    if (!this.report) {
      return [{ kind: "root", label: "No report found. Run Warden analyze." }];
    }
    return rootNodes(this.report);
  }
}
