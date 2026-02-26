import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { WorkDocument } from "../types/work.js";

const ESCALATION_THRESHOLD = 3;

export function detectEscalations(docs: WorkDocument[]): WorkDocument[] {
  return docs.filter(
    (doc) =>
      doc.severity === "S1" &&
      doc.consecutiveReports >= ESCALATION_THRESHOLD &&
      doc.status === "unassigned",
  );
}

export interface AlertPayload {
  findingId: string;
  code: string;
  severity: string;
  consecutiveReports: number;
  path?: string;
  escalatedAt: string;
}

export async function writeAlert(
  slug: string,
  doc: WorkDocument,
): Promise<string> {
  const alertsDir = path.resolve(process.cwd(), "data", slug, "alerts");
  await mkdir(alertsDir, { recursive: true });

  const payload: AlertPayload = {
    findingId: doc.findingId,
    code: doc.code,
    severity: doc.severity,
    consecutiveReports: doc.consecutiveReports,
    path: doc.path,
    escalatedAt: new Date().toISOString(),
  };

  const alertPath = path.join(alertsDir, `${doc.findingId}-escalated.json`);
  await writeFile(alertPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return alertPath;
}
