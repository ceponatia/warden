import { getRepoConfigBySlug, loadRepoConfigs } from "../../config/loader.js";
import { pruneRepoArtifacts } from "../../retention.js";

function toPositiveInt(
  value: string | undefined,
  flag: string,
): number | undefined {
  if (value == null) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid value for ${flag}: ${value}`);
  }

  return parsed;
}

export async function runPruneCommand(
  repoSlug?: string,
  keepArg?: string,
): Promise<void> {
  const configs = await loadRepoConfigs();
  if (configs.length === 0) {
    throw new Error("No repos configured. Run 'warden init <path>' first.");
  }

  const keepOverride = toPositiveInt(keepArg, "--keep");
  const targets = repoSlug ? [getRepoConfigBySlug(configs, repoSlug)] : configs;

  for (const config of targets) {
    const result = await pruneRepoArtifacts(config, keepOverride);
    process.stdout.write(
      `Pruned ${result.snapshots.length} snapshots and ${result.reports.length} reports for ${config.slug}\n`,
    );
  }
}
