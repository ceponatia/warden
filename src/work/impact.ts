import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";

import { assignInitialSeverity } from "./severity.js";
import { generateFindingId, loadWorkDocuments } from "./manager.js";
import type { FindingInstance } from "../types/findings.js";
import type { MergeImpactRecord, Severity } from "../types/work.js";

const execFileAsync = promisify(execFile);

function impactDir(slug: string): string {
  return path.resolve(process.cwd(), "data", slug, "impact");
}

function impactPath(slug: string, mergeId: string): string {
  if (
    mergeId.includes("..") ||
    mergeId.includes("/") ||
    mergeId.includes("\\")
  ) {
    throw new Error("Invalid mergeId");
  }

  return path.join(impactDir(slug), `${mergeId}.json`);
}

async function countSubsequentChurn(
  repoPath: string,
  mergedAtIso: string,
  files: string[],
): Promise<number> {
  if (files.length === 0) {
    return 0;
  }

  let churn = 0;
  for (const file of files) {
    try {
      const { stdout } = await execFileAsync(
        "git",
        ["log", `--since=${mergedAtIso}`, "--oneline", "--", file],
        { cwd: repoPath },
      );
      const lines = stdout
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      churn += lines.length;
    } catch {
      // Best effort, ignore per-file failures
    }
  }

  return churn;
}

async function detectRevert(
  repoPath: string,
  mergedAtIso: string,
  branch: string,
): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      [
        "log",
        `--since=${mergedAtIso}`,
        "--oneline",
        "--grep",
        `Revert.*${branch}`,
      ],
      { cwd: repoPath },
    );
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

export function createImpactRecord(params: {
  mergeId: string;
  agentName: string;
  findingCode: string;
  branch: string;
  files: string[];
  mergedAt?: string;
  autoMerged?: boolean;
}): MergeImpactRecord {
  const mergedAt = params.mergedAt ?? new Date().toISOString();
  return {
    mergeId: params.mergeId,
    agentName: params.agentName,
    findingCode: params.findingCode,
    branch: params.branch,
    files: params.files,
    mergedAt,
    autoMerged: params.autoMerged ?? true,
    impact: {
      newFindingsIntroduced: [],
      findingsResolved: [],
      revertDetected: false,
      subsequentChurn: 0,
    },
    assessedAt: mergedAt,
  };
}

export async function saveImpactRecord(
  slug: string,
  record: MergeImpactRecord,
): Promise<void> {
  const filePath = impactPath(slug, record.mergeId);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
}

export async function loadImpactRecords(
  slug: string,
): Promise<MergeImpactRecord[]> {
  const dir = impactDir(slug);
  let entries: string[];
  try {
    entries = (await readdir(dir)).filter((entry) => entry.endsWith(".json"));
  } catch {
    return [];
  }

  const records: MergeImpactRecord[] = [];
  for (const entry of entries) {
    try {
      const raw = await readFile(path.join(dir, entry), "utf8");
      records.push(JSON.parse(raw) as MergeImpactRecord);
    } catch {
      // Skip bad record files
    }
  }

  return records.sort((left, right) =>
    right.mergedAt.localeCompare(left.mergedAt),
  );
}

export async function recordAutoMerge(
  slug: string,
  params: {
    agentName: string;
    findingCode: string;
    branch: string;
    files: string[];
    mergedAt?: string;
  },
): Promise<MergeImpactRecord> {
  const mergedAt = params.mergedAt ?? new Date().toISOString();
  const mergeId = `${mergedAt.replace(/[:.]/g, "-")}-${params.agentName}-${params.findingCode}`;
  const record = createImpactRecord({
    mergeId,
    agentName: params.agentName,
    findingCode: params.findingCode,
    branch: params.branch,
    files: params.files,
    mergedAt,
    autoMerged: true,
  });
  await saveImpactRecord(slug, record);
  return record;
}

export async function assessImpactRecords(
  slug: string,
  repoPath: string,
  findings: FindingInstance[],
): Promise<MergeImpactRecord[]> {
  const records = await loadImpactRecords(slug);
  if (records.length === 0) {
    return [];
  }

  const docs = await loadWorkDocuments(slug);
  const severityByFindingId = new Map<string, Severity>();
  for (const finding of findings) {
    const findingId = generateFindingId(finding);
    const doc = docs.find((candidate) => candidate.findingId === findingId);
    severityByFindingId.set(
      findingId,
      doc?.severity ?? assignInitialSeverity(finding),
    );
  }

  for (const record of records) {
    const matchingFindings = findings.filter((finding) => {
      if (!finding.path) {
        return false;
      }

      return record.files.includes(finding.path);
    });

    const introduced = matchingFindings
      .filter((finding) => finding.code !== record.findingCode)
      .map((finding) => {
        const findingId = generateFindingId(finding);
        const severity =
          severityByFindingId.get(findingId) ?? assignInitialSeverity(finding);
        return `${finding.code}:${severity}`;
      });

    const isOriginalResolved = !findings.some(
      (finding) =>
        finding.code === record.findingCode &&
        finding.path &&
        record.files.includes(finding.path),
    );

    const findingsResolved = isOriginalResolved ? [record.findingCode] : [];
    const revertDetected = await detectRevert(
      repoPath,
      record.mergedAt,
      record.branch,
    );
    const subsequentChurn = await countSubsequentChurn(
      repoPath,
      record.mergedAt,
      record.files,
    );

    record.impact = {
      newFindingsIntroduced: introduced,
      findingsResolved,
      revertDetected,
      subsequentChurn,
    };
    record.assessedAt = new Date().toISOString();
    await saveImpactRecord(slug, record);
  }

  return records;
}

export function hasSevereAutomergeRegression(
  records: MergeImpactRecord[],
): boolean {
  for (const record of records) {
    for (const item of record.impact.newFindingsIntroduced) {
      const [, severityText] = item.split(":");
      if (
        severityText &&
        (severityText === "S0" ||
          severityText === "S1" ||
          severityText === "S2")
      ) {
        return true;
      }
    }
  }

  return false;
}

export function hasRevertedAutomerge(records: MergeImpactRecord[]): boolean {
  return records.some((record) => record.impact.revertDetected);
}

export function hasHighChurnAutomerge(
  records: MergeImpactRecord[],
  threshold = 10,
): boolean {
  return records.some((record) => record.impact.subsequentChurn >= threshold);
}
