import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import * as vscode from "vscode";

import { loadWikiEntries } from "./wiki-index";
import type {
  RepoSettings,
  ReportBundle,
  WorkDocument,
  WorkDocumentStatus,
} from "./types";

const STATUS_OPTIONS: WorkDocumentStatus[] = [
  "unassigned",
  "auto-assigned",
  "agent-in-progress",
  "agent-complete",
  "pm-review",
  "blocked",
  "resolved",
  "wont-fix",
];

function workDir(settings: RepoSettings): string {
  return path.resolve(
    settings.workspaceRoot,
    settings.dataPath,
    settings.repoSlug,
    "work",
  );
}

async function loadWorkDocuments(
  settings: RepoSettings,
): Promise<WorkDocument[]> {
  const dir = workDir(settings);
  try {
    const entries = await readdir(dir);
    const docs: WorkDocument[] = [];
    for (const file of entries.filter((entry) => entry.endsWith(".json"))) {
      const raw = await readFile(path.join(dir, file), "utf8").catch(() => "");
      if (!raw) {
        continue;
      }
      try {
        docs.push(JSON.parse(raw) as WorkDocument);
      } catch {
        // Skip malformed docs
      }
    }
    return docs;
  } catch {
    return [];
  }
}

async function saveWorkDocument(
  settings: RepoSettings,
  doc: WorkDocument,
): Promise<void> {
  const filePath = path.join(workDir(settings), `${doc.findingId}.json`);
  await writeFile(filePath, `${JSON.stringify(doc, null, 2)}\n`, "utf8");
}

async function pickWorkDocument(
  settings: RepoSettings,
): Promise<WorkDocument | null> {
  const docs = await loadWorkDocuments(settings);
  if (docs.length === 0) {
    vscode.window.showInformationMessage("No work documents found.");
    return null;
  }

  const choice = await vscode.window.showQuickPick(
    docs.map((doc) => ({
      label: `${doc.code} - ${doc.findingId}`,
      description: doc.status,
      detail: doc.notes.at(-1)?.text,
      doc,
    })),
    { title: "Select work document" },
  );

  return choice?.doc ?? null;
}

function runWardenCommand(args: string[]): void {
  const terminal = vscode.window.createTerminal({ name: "Warden" });
  terminal.show(true);
  terminal.sendText(`pnpm warden ${args.join(" ")}`);
}

export interface CommandContext {
  getSettings: () => RepoSettings | null;
  getBundle: () => ReportBundle;
  refresh: () => Promise<void>;
}

async function handleOpenReport(ctx: CommandContext): Promise<void> {
  const bundle = ctx.getBundle();
  if (!bundle.markdownPath) {
    vscode.window.showWarningMessage("No markdown report found.");
    return;
  }
  const doc = await vscode.workspace.openTextDocument(bundle.markdownPath);
  await vscode.window.showTextDocument(doc, { preview: false });
}

function normalizeProvidedCode(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

async function handleOpenWiki(
  ctx: CommandContext,
  providedCode: unknown,
): Promise<void> {
  const settings = ctx.getSettings();
  if (!settings) {
    vscode.window.showWarningMessage("Warden settings unavailable.");
    return;
  }

  const entries = await loadWikiEntries(settings.workspaceRoot);
  if (entries.length === 0) {
    vscode.window.showWarningMessage("No wiki entries found.");
    return;
  }

  const selectedCode =
    normalizeProvidedCode(providedCode) ??
    (
      await vscode.window.showQuickPick(
        entries.map((entry) => ({
          label: entry.code,
          description: entry.description,
        })),
        { title: "Open wiki page" },
      )
    )?.label;

  if (!selectedCode) {
    return;
  }

  const selected = entries.find((entry) => entry.code === selectedCode);
  if (!selected) {
    vscode.window.showWarningMessage(
      `Wiki page not found for ${selectedCode}.`,
    );
    return;
  }

  const fullPath = path.resolve(settings.workspaceRoot, selected.wikiPath);
  const doc = await vscode.workspace.openTextDocument(fullPath);
  await vscode.window.showTextDocument(doc, { preview: false });
}

async function handleWorkStatus(ctx: CommandContext): Promise<void> {
  const settings = ctx.getSettings();
  if (!settings) {
    return;
  }

  const doc = await pickWorkDocument(settings);
  if (!doc) {
    return;
  }

  const statusChoice = await vscode.window.showQuickPick(
    STATUS_OPTIONS.map((value) => ({ label: value, status: value })),
    {
      title: `Set status for ${doc.code}`,
    },
  );
  if (!statusChoice) {
    return;
  }

  doc.status = statusChoice.status;
  await saveWorkDocument(settings, doc);
  await ctx.refresh();
}

async function handleWorkNote(ctx: CommandContext): Promise<void> {
  const settings = ctx.getSettings();
  if (!settings) {
    return;
  }

  const doc = await pickWorkDocument(settings);
  if (!doc) {
    return;
  }

  const note = await vscode.window.showInputBox({
    title: `Add note for ${doc.code}`,
    prompt: "Note text",
    ignoreFocusOut: true,
  });
  if (!note) {
    return;
  }

  doc.notes.push({
    timestamp: new Date().toISOString(),
    author: "vscode",
    text: note,
  });
  await saveWorkDocument(settings, doc);
  await ctx.refresh();
}

function register(
  extensionContext: vscode.ExtensionContext,
  command: string,
  handler: (...args: unknown[]) => unknown,
): void {
  extensionContext.subscriptions.push(
    vscode.commands.registerCommand(command, handler),
  );
}

export function registerCommands(
  extensionContext: vscode.ExtensionContext,
  ctx: CommandContext,
): void {
  register(extensionContext, "warden.refresh", async () => {
    await ctx.refresh();
    vscode.window.showInformationMessage("Warden refreshed.");
  });

  register(extensionContext, "warden.openReport", async () => {
    await handleOpenReport(ctx);
  });

  register(extensionContext, "warden.openWiki", async (...args: unknown[]) => {
    await handleOpenWiki(ctx, args[0]);
  });

  register(extensionContext, "warden.workStatus", async () => {
    await handleWorkStatus(ctx);
  });

  register(extensionContext, "warden.workNote", async () => {
    await handleWorkNote(ctx);
  });

  register(extensionContext, "warden.runCollect", () => {
    const slug = ctx.getSettings()?.repoSlug;
    runWardenCommand(slug ? ["collect", "--repo", slug] : ["collect"]);
  });

  register(extensionContext, "warden.runAnalyze", () => {
    const slug = ctx.getSettings()?.repoSlug;
    runWardenCommand(slug ? ["analyze", "--repo", slug] : ["analyze"]);
  });
}
