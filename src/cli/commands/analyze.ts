import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { getRepoConfigBySlug, loadRepoConfigs } from "../../config/loader.js";
import { runAnalysis } from "../../agents/runner.js";
import type { RepoConfig } from "../../types/snapshot.js";

function timestampFileName(date: Date): string {
  return date.toISOString().replace(/:/g, "-").replace(/\..+$/, "");
}

async function analyzeRepo(config: RepoConfig): Promise<void> {
  process.stdout.write(`Analyzing ${config.slug}...\n`);
  const result = await runAnalysis(config);

  const fileName = `${timestampFileName(new Date())}.md`;
  const analysisDir = path.resolve(
    process.cwd(),
    "data",
    config.slug,
    "analyses",
  );
  await mkdir(analysisDir, { recursive: true });

  const analysisPath = path.join(analysisDir, fileName);
  await writeFile(analysisPath, `${result.analysis}\n`, "utf8");

  process.stdout.write(result.analysis);
  process.stdout.write("\n");
  process.stdout.write(
    `Analysis written to data/${config.slug}/analyses/${fileName}\n`,
  );
}

export async function runAnalyzeCommand(repoSlug?: string): Promise<void> {
  const configs = await loadRepoConfigs();
  if (configs.length === 0) {
    throw new Error("No repos configured. Run 'warden init <path>' first.");
  }

  if (repoSlug) {
    const config = getRepoConfigBySlug(configs, repoSlug);
    await analyzeRepo(config);
    return;
  }

  for (const config of configs) {
    await analyzeRepo(config);
  }
}
