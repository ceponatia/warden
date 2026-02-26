import path from "node:path";

import * as vscode from "vscode";

import { registerCommands } from "./commands";
import { loadRepoSettings } from "./config";
import { WardenDiagnostics } from "./diagnostics";
import { WardenOutput } from "./output-channel";
import { loadLatestReport } from "./report-store";
import { WardenTreeProvider } from "./tree-view";
import type { RepoSettings, ReportBundle, WikiEntry } from "./types";
import { loadWikiEntries } from "./wiki-index";
import { createWikiHoverProvider } from "./wiki-hover";

let diagnostics: WardenDiagnostics | null = null;
let output: WardenOutput | null = null;
let tree: WardenTreeProvider | null = null;

let currentSettings: RepoSettings | null = null;
let currentBundle: ReportBundle = { report: null, markdown: "" };

let watcher: vscode.FileSystemWatcher | null = null;

async function refreshAll(): Promise<void> {
  const settings = await loadRepoSettings();
  currentSettings = settings;

  if (!settings) {
    currentBundle = { report: null, markdown: "" };
    diagnostics?.refresh(null, {
      workspaceRoot: "",
      dataPath: "data",
      repoSlug: "",
      autoRefresh: false,
      severityFilter: new Set(),
    });
    tree?.update(null, null);
    output?.refresh(currentBundle);
    return;
  }

  currentBundle = await loadLatestReport(settings);
  diagnostics?.refresh(currentBundle.report, settings);
  tree?.update(currentBundle.report, settings);
  output?.refresh(currentBundle);
}

function setupAutoRefresh(
  context: vscode.ExtensionContext,
  settings: RepoSettings,
): void {
  watcher?.dispose();
  watcher = null;

  if (!settings.autoRefresh) {
    return;
  }

  const root = vscode.workspace.workspaceFolders?.[0];
  if (!root) {
    return;
  }

  const pattern = new vscode.RelativePattern(
    root,
    path.posix.join(
      settings.dataPath.replace(/\\/g, "/"),
      settings.repoSlug,
      "reports",
      "*.json",
    ),
  );
  watcher = vscode.workspace.createFileSystemWatcher(pattern);
  watcher.onDidCreate(() => {
    void refreshAll();
  });
  watcher.onDidChange(() => {
    void refreshAll();
  });
  watcher.onDidDelete(() => {
    void refreshAll();
  });
  context.subscriptions.push(watcher);
}

function registerHoverProvider(
  context: vscode.ExtensionContext,
  wikiByCode: Map<string, WikiEntry>,
): void {
  context.subscriptions.push(
    vscode.languages.registerHoverProvider(
      [{ scheme: "file" }, { scheme: "untitled" }],
      createWikiHoverProvider(wikiByCode),
    ),
  );
}

async function loadWikiMap(
  settings: RepoSettings | null,
): Promise<Map<string, WikiEntry>> {
  const map = new Map<string, WikiEntry>();
  if (!settings) {
    return map;
  }

  const entries = await loadWikiEntries(settings.workspaceRoot);
  for (const entry of entries) {
    map.set(entry.code, entry);
  }
  return map;
}

export async function activate(
  context: vscode.ExtensionContext,
): Promise<void> {
  diagnostics = new WardenDiagnostics();
  output = new WardenOutput();
  tree = new WardenTreeProvider();

  context.subscriptions.push(diagnostics, output);
  context.subscriptions.push(
    vscode.window.createTreeView("warden.findings", { treeDataProvider: tree }),
  );

  registerCommands(context, {
    getSettings: () => currentSettings,
    getBundle: () => currentBundle,
    refresh: refreshAll,
  });

  currentSettings = await loadRepoSettings();
  setupAutoRefresh(
    context,
    currentSettings ?? {
      workspaceRoot: "",
      dataPath: "data",
      repoSlug: "",
      autoRefresh: false,
      severityFilter: new Set(),
    },
  );

  const wikiByCode = await loadWikiMap(currentSettings);
  registerHoverProvider(context, wikiByCode);

  await refreshAll();
}

export function deactivate(): void {
  watcher?.dispose();
  diagnostics?.dispose();
  output?.dispose();
}
