import type {
  NotificationEvent,
  SlackChannelConfig,
} from "../../types/notifications.js";

interface SlackText {
  type: "plain_text" | "mrkdwn";
  text: string;
}

interface SlackBlock {
  type: "header" | "section" | "actions";
  text?: SlackText;
  fields?: SlackText[];
  elements?: Array<{
    type: "button";
    text: SlackText;
    url: string;
  }>;
}

interface SlackPayload {
  blocks: SlackBlock[];
  channel?: string;
  username?: string;
}

function headerForEvent(type: NotificationEvent["type"]): string {
  switch (type) {
    case "escalation":
      return "Warden: Escalation Alert";
    case "agent-pr-created":
      return "Warden: Agent PR Created";
    case "auto-merge":
      return "Warden: Auto-Merge Completed";
    case "trust-revocation":
      return "Warden: Trust Revocation";
    case "coverage-regression":
      return "Warden: Coverage Regression";
    case "systemic-pattern":
      return "Warden: Systemic Pattern";
    case "analysis-complete":
      return "Warden: Analysis Complete";
    case "collection-failed":
      return "Warden: Collection Failed";
    default:
      return "Warden Notification";
  }
}

function detailsToMarkdown(details: Record<string, unknown>): string {
  const entries = Object.entries(details).slice(0, 6);
  if (entries.length === 0) {
    return "(no additional details)";
  }
  return entries.map(([key, value]) => `*${key}:* ${String(value)}`).join("\n");
}

function buildPayload(
  config: SlackChannelConfig,
  event: NotificationEvent,
): SlackPayload {
  const mentionPrefix =
    event.type === "escalation" && config.mentionOnEscalation
      ? `${config.mentionOnEscalation}\n`
      : "";
  const blocks: SlackBlock[] = [
    {
      type: "header",
      text: { type: "plain_text", text: headerForEvent(event.type) },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Repo:* ${event.slug}` },
        {
          type: "mrkdwn",
          text: `*Severity:* ${event.severity ?? "n/a"}`,
        },
      ],
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `${mentionPrefix}${event.summary}`,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: detailsToMarkdown(event.details),
      },
    },
  ];

  if (event.dashboardUrl) {
    blocks.push({
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "View in Dashboard" },
          url: event.dashboardUrl,
        },
      ],
    });
  }

  return {
    blocks,
    channel: config.channel,
    username: config.username,
  };
}

export async function sendSlack(
  config: SlackChannelConfig,
  event: NotificationEvent,
): Promise<void> {
  const payload = buildPayload(config, event);
  const response = await fetch(config.webhookUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Slack webhook failed (${response.status}): ${body.slice(0, 200)}`,
    );
  }
}
