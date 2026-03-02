import { getRepoConfigBySlug, loadRepoConfigs } from "../../config/loader.js";
import {
  dispatch,
  sendScheduledDigests,
} from "../../notifications/dispatcher.js";
import type { NotificationEvent } from "../../types/notifications.js";

function getFlagValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index < 0) {
    return undefined;
  }
  return args[index + 1];
}

function parseDays(value: string | undefined): number {
  if (!value) {
    return 7;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error("Invalid --days value. Expected a positive integer.");
  }
  return parsed;
}

function printResults(
  prefix: string,
  results: Awaited<ReturnType<typeof dispatch>>,
): void {
  if (results.length === 0) {
    process.stdout.write(`${prefix}: no configured channels matched.\n`);
    return;
  }

  for (const result of results) {
    const status = result.skipped
      ? `skipped (${result.reason ?? "n/a"})`
      : result.success
        ? "ok"
        : `failed (${result.reason ?? "unknown"})`;
    process.stdout.write(
      `${prefix}: ${result.channelId} [${result.channelType}] -> ${status}\n`,
    );
  }
}

async function runNotifyTest(repoSlug?: string): Promise<void> {
  let targetSlug = repoSlug;
  if (!targetSlug) {
    const configs = await loadRepoConfigs();
    const first = configs[0];
    if (!first) {
      throw new Error("No repos configured. Run 'warden init <path>' first.");
    }
    targetSlug = first.slug;
  } else {
    const configs = await loadRepoConfigs();
    getRepoConfigBySlug(configs, targetSlug);
  }

  const testEvent: NotificationEvent = {
    type: "analysis-complete",
    slug: targetSlug,
    timestamp: new Date().toISOString(),
    severity: "S3",
    summary: "Warden notification test event.",
    details: {
      source: "warden notify test",
      intent: "configuration verification",
    },
    dashboardUrl: `http://localhost:3333/repo/${encodeURIComponent(targetSlug)}`,
  };

  const results = await dispatch(testEvent, { force: true });
  printResults("notify test", results);
}

async function runNotifyDigest(rest: string[]): Promise<void> {
  const repoSlug = getFlagValue(rest, "--repo");
  const days = parseDays(getFlagValue(rest, "--days"));
  if (repoSlug) {
    const configs = await loadRepoConfigs();
    getRepoConfigBySlug(configs, repoSlug);
  }

  const results = await sendScheduledDigests({ slug: repoSlug, days });
  if (results.length === 0) {
    process.stdout.write(
      "notify digest: no matching digest channels configured.\n",
    );
    return;
  }

  for (const result of results) {
    const status = result.success
      ? "ok"
      : `failed (${result.reason ?? "unknown"})`;
    process.stdout.write(
      `notify digest: ${result.channelId} [${result.channelType}] -> ${status}\n`,
    );
  }
}

export async function runNotifyCommand(rest: string[]): Promise<void> {
  const action = rest[0];
  if (action === "test") {
    await runNotifyTest(getFlagValue(rest, "--repo"));
    return;
  }
  if (action === "digest") {
    await runNotifyDigest(rest);
    return;
  }

  throw new Error(
    "Unknown notify action. Usage: warden notify <test|digest> [--repo <slug>] [--days <n>]",
  );
}
