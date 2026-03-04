import { readFile } from "node:fs/promises";
import path from "node:path";

import type {
  ChannelConfig,
  EmailChannel,
  NotificationConfig,
  NotificationEventType,
  SlackChannel,
} from "../types/notifications.js";
import type { Severity } from "../types/work.js";

const CONFIG_PATH = path.resolve(process.cwd(), "config", "notifications.json");
const VALID_EVENTS: NotificationEventType[] = [
  "escalation",
  "agent-pr-created",
  "auto-merge",
  "trust-revocation",
  "coverage-regression",
  "systemic-pattern",
  "analysis-complete",
  "collection-failed",
];
const VALID_SEVERITIES: Severity[] = ["S0", "S1", "S2", "S3", "S4", "S5"];

function resolveEnvReference(value: string): string {
  if (!value.startsWith("$") || value.length < 2) {
    return value;
  }
  return process.env[value.slice(1)] ?? "";
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === "string");
}

function normalizeEvents(value: unknown): NotificationEventType[] | ["*"] {
  if (!Array.isArray(value) || value.length === 0) {
    return ["*"];
  }
  if (value.length === 1 && value[0] === "*") {
    return ["*"];
  }
  const filtered = value.filter(
    (entry): entry is NotificationEventType =>
      typeof entry === "string" && (VALID_EVENTS as string[]).includes(entry),
  );
  return filtered.length > 0 ? filtered : ["*"];
}

function normalizeMinSeverity(value: unknown): Severity | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  return (VALID_SEVERITIES as string[]).includes(value)
    ? (value as Severity)
    : undefined;
}

function normalizeSlackChannel(value: unknown): SlackChannel | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const raw = value as {
    events?: unknown;
    minSeverity?: unknown;
    config?: {
      webhookUrl?: unknown;
      channel?: unknown;
      username?: unknown;
      mentionOnEscalation?: unknown;
    };
  };

  const webhookUrlRaw =
    typeof raw.config?.webhookUrl === "string"
      ? resolveEnvReference(raw.config.webhookUrl)
      : "";
  if (!webhookUrlRaw) {
    return null;
  }

  return {
    type: "slack",
    events: normalizeEvents(raw.events),
    minSeverity: normalizeMinSeverity(raw.minSeverity),
    config: {
      webhookUrl: webhookUrlRaw,
      channel:
        typeof raw.config?.channel === "string"
          ? resolveEnvReference(raw.config.channel)
          : undefined,
      username:
        typeof raw.config?.username === "string"
          ? resolveEnvReference(raw.config.username)
          : undefined,
      mentionOnEscalation:
        typeof raw.config?.mentionOnEscalation === "string"
          ? resolveEnvReference(raw.config.mentionOnEscalation)
          : undefined,
    },
  };
}

type RawEmailConfig = {
  recipients?: unknown;
  schedule?: unknown;
  smtpHost?: unknown;
  smtpPort?: unknown;
  smtpUser?: unknown;
  smtpPass?: unknown;
};

function normalizeSchedule(value: unknown): "immediate" | "daily" | "weekly" {
  if (value === "immediate" || value === "daily" || value === "weekly") {
    return value;
  }
  return "weekly";
}

function normalizeOptionalEnvString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  return resolveEnvReference(value);
}

function normalizeEmailConfig(
  raw?: RawEmailConfig,
): EmailChannel["config"] | null {
  const recipients = asStringArray(raw?.recipients)
    .map((value) => resolveEnvReference(value))
    .filter((value) => value.length > 0);

  if (recipients.length === 0) {
    return null;
  }

  return {
    recipients,
    schedule: normalizeSchedule(raw?.schedule),
    smtpHost: normalizeOptionalEnvString(raw?.smtpHost),
    smtpPort: typeof raw?.smtpPort === "number" ? raw.smtpPort : undefined,
    smtpUser: normalizeOptionalEnvString(raw?.smtpUser),
    smtpPass: normalizeOptionalEnvString(raw?.smtpPass),
  };
}

function normalizeEmailChannel(value: unknown): EmailChannel | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const raw = value as {
    events?: unknown;
    minSeverity?: unknown;
    config?: {
      recipients?: unknown;
      schedule?: unknown;
      smtpHost?: unknown;
      smtpPort?: unknown;
      smtpUser?: unknown;
      smtpPass?: unknown;
    };
  };

  const config = normalizeEmailConfig(raw.config);
  if (!config) {
    return null;
  }

  return {
    type: "email",
    events: normalizeEvents(raw.events),
    minSeverity: normalizeMinSeverity(raw.minSeverity),
    config,
  };
}

function normalizeChannel(value: unknown): ChannelConfig | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const raw = value as { type?: unknown };
  if (raw.type === "slack") {
    return normalizeSlackChannel(value);
  }
  if (raw.type === "email") {
    return normalizeEmailChannel(value);
  }
  return null;
}

function normalizeChannelList(value: unknown): ChannelConfig[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => normalizeChannel(entry))
    .filter((entry): entry is ChannelConfig => entry !== null);
}

export async function loadNotificationConfig(): Promise<NotificationConfig | null> {
  try {
    const raw = await readFile(CONFIG_PATH, "utf8");
    const parsed = JSON.parse(raw) as {
      global?: unknown;
      repos?: Record<string, unknown>;
    };

    const repos: Record<string, ChannelConfig[]> = {};
    if (parsed.repos && typeof parsed.repos === "object") {
      for (const [slug, value] of Object.entries(parsed.repos)) {
        repos[slug] = normalizeChannelList(value);
      }
    }

    return {
      global: normalizeChannelList(parsed.global),
      repos,
    };
  } catch (error: unknown) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}
