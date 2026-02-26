import {
  loadWorkDocuments,
  loadWorkDocument,
  saveWorkDocument,
  addNote,
} from "../../work/manager.js";
import { loadRepoConfigs, getRepoConfigBySlug } from "../../config/loader.js";
import type { WorkDocument, WorkDocumentStatus } from "../../types/work.js";

const VALID_STATUSES: WorkDocumentStatus[] = [
  "unassigned",
  "auto-assigned",
  "agent-in-progress",
  "agent-complete",
  "pm-review",
  "blocked",
  "resolved",
  "wont-fix",
];

function padRight(text: string, width: number): string {
  return text.length >= width ? text : text + " ".repeat(width - text.length);
}

function renderTable(docs: WorkDocument[]): void {
  const header = [
    padRight("Finding ID", 50),
    padRight("Code", 12),
    padRight("Severity", 10),
    padRight("Status", 18),
    padRight("Consecutive", 12),
  ].join("");

  process.stdout.write(`${header}\n`);
  process.stdout.write(`${"-".repeat(header.length)}\n`);

  for (const doc of docs) {
    const row = [
      padRight(doc.findingId.slice(0, 48), 50),
      padRight(doc.code, 12),
      padRight(doc.severity, 10),
      padRight(doc.status, 18),
      padRight(String(doc.consecutiveReports), 12),
    ].join("");
    process.stdout.write(`${row}\n`);
  }
}

function renderDetail(doc: WorkDocument): void {
  process.stdout.write(`Finding ID:    ${doc.findingId}\n`);
  process.stdout.write(`Code:          ${doc.code}\n`);
  process.stdout.write(`Metric:        ${doc.metric}\n`);
  process.stdout.write(`Severity:      ${doc.severity}\n`);
  process.stdout.write(`Status:        ${doc.status}\n`);
  process.stdout.write(`Path:          ${doc.path ?? "N/A"}\n`);
  process.stdout.write(`Symbol:        ${doc.symbol ?? "N/A"}\n`);
  process.stdout.write(`First seen:    ${doc.firstSeen}\n`);
  process.stdout.write(`Last seen:     ${doc.lastSeen}\n`);
  process.stdout.write(`Consecutive:   ${doc.consecutiveReports}\n`);
  process.stdout.write(`Trend:         ${doc.trend}\n`);
  if (doc.assignedTo) {
    process.stdout.write(`Assigned to:   ${doc.assignedTo}\n`);
  }
  if (doc.relatedBranch) {
    process.stdout.write(`Branch:        ${doc.relatedBranch}\n`);
  }
  if (doc.planDocument) {
    process.stdout.write(`Plan:          ${doc.planDocument}\n`);
  }
  if (doc.validationResult) {
    process.stdout.write(
      `Validation:    ${doc.validationResult.passed ? "passed" : "failed"} (${doc.validationResult.attempts} attempt(s))\n`,
    );
  }
  if (doc.resolvedAt) {
    process.stdout.write(`Resolved at:   ${doc.resolvedAt}\n`);
  }

  if (doc.notes.length > 0) {
    process.stdout.write(`\nNotes:\n`);
    for (const note of doc.notes.slice(-10)) {
      process.stdout.write(
        `  [${note.timestamp}] ${note.author}: ${note.text}\n`,
      );
    }
  }
}

function getFlagValue(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx < 0) {
    return undefined;
  }
  return args[idx + 1];
}

async function handleUpdate(
  slug: string,
  doc: WorkDocument,
  args: string[],
): Promise<void> {
  const statusUpdate = getFlagValue(args, "--status") as
    | WorkDocumentStatus
    | undefined;
  const noteText = getFlagValue(args, "--note");

  if (statusUpdate) {
    if (!VALID_STATUSES.includes(statusUpdate)) {
      throw new Error(
        `Invalid status: ${statusUpdate}. Valid: ${VALID_STATUSES.join(", ")}`,
      );
    }
    doc.status = statusUpdate;
    if (statusUpdate === "resolved") {
      doc.resolvedAt = new Date().toISOString();
    }
  }

  if (noteText) {
    addNote(doc, "manual", noteText);
  }

  if (statusUpdate || noteText) {
    await saveWorkDocument(slug, doc);
    process.stdout.write(`Updated ${doc.findingId}.\n`);
  }
}

export async function runWorkCommand(args: string[]): Promise<void> {
  const configs = await loadRepoConfigs();
  if (configs.length === 0) {
    throw new Error("No repos configured. Run 'warden init <path>' first.");
  }

  const repoSlug = getFlagValue(args, "--repo") ?? configs[0]?.slug;
  if (!repoSlug) {
    throw new Error("No repo slug specified and no repos configured.");
  }

  const config = getRepoConfigBySlug(configs, repoSlug);

  const valueFlags = new Set(["--repo", "--status", "--note"]);

  function getFindingIdFromArgs(commandArgs: string[]): string | undefined {
    let skipNext = false;
    for (const arg of commandArgs) {
      if (skipNext) {
        skipNext = false;
        continue;
      }
      if (arg.startsWith("--")) {
        if (valueFlags.has(arg)) {
          skipNext = true;
        }
        continue;
      }
      return arg;
    }
    return undefined;
  }

  // Check for findingId as first positional arg (not a flag or flag value)
  const findingId = getFindingIdFromArgs(args);

  if (!findingId) {
    const docs = await loadWorkDocuments(config.slug);
    const active = docs.filter(
      (d) => d.status !== "resolved" && d.status !== "wont-fix",
    );

    if (active.length === 0) {
      process.stdout.write(`No active work documents for ${config.slug}.\n`);
      return;
    }

    process.stdout.write(
      `Active work documents for ${config.slug} (${active.length}):\n\n`,
    );
    renderTable(active);
    return;
  }

  const doc = await loadWorkDocument(config.slug, findingId);
  if (!doc) {
    throw new Error(`Work document not found: ${findingId}`);
  }

  await handleUpdate(config.slug, doc, args);
  renderDetail(doc);
}
