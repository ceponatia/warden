import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import type { RepoSettings, ReportBundle, StructuredReport } from "./types";

async function latestReportBaseName(
  reportsDir: string,
): Promise<string | null> {
  try {
    const entries = await readdir(reportsDir);
    const latestJson = entries
      .filter((entry) => entry.endsWith(".json"))
      .sort((a, b) => b.localeCompare(a))[0];
    if (!latestJson) {
      return null;
    }
    return latestJson.replace(/\.json$/, "");
  } catch {
    return null;
  }
}

export async function loadLatestReport(
  settings: RepoSettings,
): Promise<ReportBundle> {
  const reportsDir = path.resolve(
    settings.workspaceRoot,
    settings.dataPath,
    settings.repoSlug,
    "reports",
  );

  const base = await latestReportBaseName(reportsDir);
  if (!base) {
    return { report: null, markdown: "" };
  }

  const jsonPath = path.join(reportsDir, `${base}.json`);
  const markdownPath = path.join(reportsDir, `${base}.md`);

  const report = await readFile(jsonPath, "utf8")
    .then((raw) => JSON.parse(raw) as StructuredReport)
    .catch(() => null);

  const markdown = await readFile(markdownPath, "utf8").catch(() => "");
  return { report, markdown, jsonPath, markdownPath };
}
