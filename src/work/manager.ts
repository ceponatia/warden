import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { FindingInstance } from "../types/findings.js";
import type { WorkDocument, WorkDocumentNote } from "../types/work.js";

function slugifyPath(filePath: string): string {
  return filePath.replace(/[/\\]/g, "-").replace(/\./g, "-");
}

export function generateFindingId(finding: FindingInstance): string {
  const pathPart = finding.path ? slugifyPath(finding.path) : "_global";
  const parts = [finding.code, pathPart];
  if (finding.symbol) {
    parts.push(finding.symbol);
  }
  return parts.join("--");
}

function workDir(slug: string): string {
  return path.resolve(process.cwd(), "data", slug, "work");
}

function workDocPath(slug: string, findingId: string): string {
  return path.join(workDir(slug), `${findingId}.json`);
}

export async function loadWorkDocuments(slug: string): Promise<WorkDocument[]> {
  const dir = workDir(slug);
  let entries: string[];
  try {
    const dirEntries = await readdir(dir);
    entries = dirEntries.filter((e) => e.endsWith(".json"));
  } catch {
    return [];
  }

  const docs: WorkDocument[] = [];
  for (const entry of entries) {
    const raw = await readFile(path.join(dir, entry), "utf8");
    docs.push(JSON.parse(raw) as WorkDocument);
  }
  return docs;
}

export async function loadWorkDocument(
  slug: string,
  findingId: string,
): Promise<WorkDocument | null> {
  try {
    const raw = await readFile(workDocPath(slug, findingId), "utf8");
    return JSON.parse(raw) as WorkDocument;
  } catch {
    return null;
  }
}

export async function saveWorkDocument(
  slug: string,
  doc: WorkDocument,
): Promise<void> {
  const dir = workDir(slug);
  await mkdir(dir, { recursive: true });
  await writeFile(
    workDocPath(slug, doc.findingId),
    `${JSON.stringify(doc, null, 2)}\n`,
    "utf8",
  );
}

export function createWorkDocument(
  finding: FindingInstance,
  severity: import("../types/work.js").Severity,
): WorkDocument {
  const now = new Date().toISOString();
  return {
    findingId: generateFindingId(finding),
    code: finding.code,
    metric: finding.metric,
    severity,
    path: finding.path,
    symbol: finding.symbol,
    firstSeen: now,
    lastSeen: now,
    consecutiveReports: 1,
    trend: "new",
    status: "unassigned",
    notes: [
      {
        timestamp: now,
        author: "warden",
        text: `First detected. Severity: ${severity}.`,
      },
    ],
  };
}

export function addNote(doc: WorkDocument, author: string, text: string): void {
  doc.notes.push({ timestamp: new Date().toISOString(), author, text });
}

export function resolveWorkDocument(doc: WorkDocument): void {
  doc.status = "resolved";
  doc.resolvedAt = new Date().toISOString();
  addNote(doc, "warden", "Finding no longer active. Resolved.");
}

export function updateWorkDocument(
  doc: WorkDocument,
  updates: Partial<
    Pick<
      WorkDocument,
      | "severity"
      | "status"
      | "assignedTo"
      | "relatedBranch"
      | "planDocument"
      | "validationResult"
      | "trend"
    >
  >,
  note?: WorkDocumentNote,
): void {
  Object.assign(doc, updates);
  if (note) {
    doc.notes.push(note);
  }
}
