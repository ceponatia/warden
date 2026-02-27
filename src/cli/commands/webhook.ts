import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { loadRepoConfigs } from "../../config/loader.js";
import {
  startWebhookServer,
  type WebhookConfig,
} from "../../github/webhook.js";
import { runAnalyzeCommand } from "./analyze.js";
import { runCollectCommand } from "./collect.js";

const PID_PATH = path.resolve(process.cwd(), "data", "webhook", "webhook.pid");

function defaultWebhookConfig(): WebhookConfig {
  return {
    enabled: true,
    port: Number.parseInt(process.env.WARDEN_WEBHOOK_PORT ?? "3334", 10),
    secret: process.env.WARDEN_WEBHOOK_SECRET ?? "",
    triggers: {
      onPush: true,
      onPullRequestMerge: true,
      onBranchDelete: true,
    },
  };
}

async function loadWebhookConfig(): Promise<WebhookConfig> {
  const filePath = path.resolve(process.cwd(), "config", "github-webhook.json");
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<WebhookConfig>;
    const defaults = defaultWebhookConfig();

    return {
      enabled: parsed.enabled ?? defaults.enabled,
      port: parsed.port ?? defaults.port,
      secret: parsed.secret ?? defaults.secret,
      triggers: {
        onPush: parsed.triggers?.onPush ?? defaults.triggers.onPush,
        onPullRequestMerge:
          parsed.triggers?.onPullRequestMerge ??
          defaults.triggers.onPullRequestMerge,
        onBranchDelete:
          parsed.triggers?.onBranchDelete ?? defaults.triggers.onBranchDelete,
      },
    };
  } catch {
    return defaultWebhookConfig();
  }
}

async function resolveSlugByRepo(
  owner: string,
  repo: string,
): Promise<string | null> {
  const configs = await loadRepoConfigs();
  const match = configs.find(
    (config) =>
      config.source === "github" &&
      config.github?.owner === owner &&
      config.github.repo === repo,
  );
  return match?.slug ?? null;
}

async function startWebhook(): Promise<void> {
  const config = await loadWebhookConfig();
  if (!config.secret) {
    throw new Error(
      "Webhook secret is missing. Set WARDEN_WEBHOOK_SECRET or create config/github-webhook.json.",
    );
  }

  const server = startWebhookServer(config, {
    onPush: async (slug: string) => {
      await runCollectCommand(slug);
      await runAnalyzeCommand(slug);
    },
    onPullRequestMerged: async (slug: string) => {
      await runCollectCommand(slug);
      await runAnalyzeCommand(slug);
    },
    resolveSlugByRepo,
  });

  await mkdir(path.dirname(PID_PATH), { recursive: true });
  await writeFile(PID_PATH, `${process.pid}\n`, "utf8");
  process.stdout.write(`Webhook server listening on port ${config.port}\n`);

  process.on("SIGINT", () => {
    server.close();
    void rm(PID_PATH, { force: true });
    process.exit(0);
  });
}

async function stopWebhook(): Promise<void> {
  let pidText: string;
  try {
    pidText = await readFile(PID_PATH, "utf8");
  } catch {
    throw new Error(
      "Webhook pid file not found. Is the webhook server running?",
    );
  }

  const pid = Number.parseInt(pidText.trim(), 10);
  if (!Number.isFinite(pid)) {
    throw new Error("Invalid webhook pid file.");
  }

  try {
    process.kill(pid, "SIGTERM");
  } catch (error: unknown) {
    const err = error as { code?: string };
    if (err.code !== "ESRCH") {
      throw error;
    }
    process.stdout.write(
      `Webhook process ${pid} is not running; cleaning up pid file.\n`,
    );
  }
  await rm(PID_PATH, { force: true });
  process.stdout.write(`Stopped webhook process ${pid}\n`);
}

export async function runWebhookCommand(rest: string[]): Promise<void> {
  const action = rest[0];
  if (action === "start") {
    await startWebhook();
    return;
  }

  if (action === "stop") {
    await stopWebhook();
    return;
  }

  throw new Error("Unknown webhook action. Usage: warden webhook <start|stop>");
}
