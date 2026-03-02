import nodemailer from "nodemailer";

import type {
  EmailChannelConfig,
  NotificationEvent,
  NotificationEventType,
} from "../../types/notifications.js";

interface DigestPeriod {
  start: string;
  end: string;
}

function resolveSmtpConfig(config: EmailChannelConfig): {
  host: string;
  port: number;
  user?: string;
  pass?: string;
} {
  const host = config.smtpHost ?? process.env.WARDEN_SMTP_HOST ?? "";
  const port =
    config.smtpPort ??
    Number.parseInt(process.env.WARDEN_SMTP_PORT ?? "587", 10);
  const user = config.smtpUser ?? process.env.WARDEN_SMTP_USER;
  const pass = config.smtpPass ?? process.env.WARDEN_SMTP_PASS;

  if (!host) {
    throw new Error("SMTP host is not configured.");
  }

  return { host, port, user, pass };
}

function eventLabel(type: NotificationEventType): string {
  switch (type) {
    case "agent-pr-created":
      return "Agent PR Created";
    case "analysis-complete":
      return "Analysis Complete";
    case "auto-merge":
      return "Auto-Merge";
    case "collection-failed":
      return "Collection Failed";
    case "coverage-regression":
      return "Coverage Regression";
    case "escalation":
      return "Escalation";
    case "systemic-pattern":
      return "Systemic Pattern";
    case "trust-revocation":
      return "Trust Revocation";
    default:
      return type;
  }
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function digestCounts(events: NotificationEvent[]): string {
  const counts = new Map<NotificationEventType, number>();
  for (const event of events) {
    counts.set(event.type, (counts.get(event.type) ?? 0) + 1);
  }

  const rows = [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(
      ([type, count]) =>
        `<tr><td>${eventLabel(type)}</td><td style="text-align:right;">${count}</td></tr>`,
    )
    .join("\n");

  return rows || '<tr><td colspan="2">No events</td></tr>';
}

export function renderDigestHtml(
  events: NotificationEvent[],
  period: DigestPeriod,
): string {
  const topEvents = [...events]
    .sort((left, right) => right.timestamp.localeCompare(left.timestamp))
    .slice(0, 15)
    .map(
      (event) =>
        `<tr><td>${escapeHtml(event.timestamp.slice(0, 10))}</td><td>${escapeHtml(event.slug)}</td><td>${eventLabel(event.type)}</td><td>${escapeHtml(event.severity ?? "n/a")}</td><td>${escapeHtml(event.summary)}</td></tr>`,
    )
    .join("\n");

  return `<!doctype html>
<html>
  <body style="font-family: Helvetica, Arial, sans-serif; color: #222;">
    <h2>Warden Notification Digest</h2>
    <p>Period: <strong>${escapeHtml(period.start.slice(0, 10))}</strong> to <strong>${escapeHtml(period.end.slice(0, 10))}</strong></p>

    <h3>Event Totals</h3>
    <table border="1" cellspacing="0" cellpadding="6" style="border-collapse: collapse;">
      <thead><tr><th style="text-align:left;">Event</th><th style="text-align:right;">Count</th></tr></thead>
      <tbody>${digestCounts(events)}</tbody>
    </table>

    <h3>Recent Events</h3>
    <table border="1" cellspacing="0" cellpadding="6" style="border-collapse: collapse; width: 100%;">
      <thead><tr><th>Date</th><th>Repo</th><th>Type</th><th>Severity</th><th>Summary</th></tr></thead>
      <tbody>${topEvents || '<tr><td colspan="5">No events in this period.</td></tr>'}</tbody>
    </table>
  </body>
</html>`;
}

async function createTransport(config: EmailChannelConfig) {
  const smtp = resolveSmtpConfig(config);
  return nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.port === 465,
    auth:
      smtp.user && smtp.pass
        ? {
            user: smtp.user,
            pass: smtp.pass,
          }
        : undefined,
  });
}

function senderAddress(config: EmailChannelConfig): string {
  return config.smtpUser ?? process.env.WARDEN_SMTP_FROM ?? "warden@localhost";
}

export async function sendEmailImmediate(
  config: EmailChannelConfig,
  event: NotificationEvent,
): Promise<void> {
  const transport = await createTransport(config);
  await transport.sendMail({
    from: senderAddress(config),
    to: config.recipients.join(", "),
    subject: `[Warden] ${eventLabel(event.type)} - ${event.slug}`,
    text: [
      `Repo: ${event.slug}`,
      `Type: ${event.type}`,
      `Severity: ${event.severity ?? "n/a"}`,
      `Summary: ${event.summary}`,
      `Timestamp: ${event.timestamp}`,
      event.dashboardUrl ? `Dashboard: ${event.dashboardUrl}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
  });
}

export async function sendEmailDigest(
  config: EmailChannelConfig,
  events: NotificationEvent[],
  period: DigestPeriod,
): Promise<void> {
  const transport = await createTransport(config);
  await transport.sendMail({
    from: senderAddress(config),
    to: config.recipients.join(", "),
    subject: `[Warden] Notification Digest ${period.start.slice(0, 10)} - ${period.end.slice(0, 10)}`,
    html: renderDigestHtml(events, period),
  });
}
