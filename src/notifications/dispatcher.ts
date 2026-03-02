import { loadNotificationConfig } from "./config.js";
import {
  appendNotificationEvent,
  appendNotificationLog,
  readNotificationEvents,
} from "./history.js";
import { sendSlack } from "./channels/slack.js";
import { sendEmailDigest, sendEmailImmediate } from "./channels/email.js";
import { loadRepoConfigs } from "../config/loader.js";
import type {
  ChannelConfig,
  NotificationConfig,
  NotificationDispatchResult,
  NotificationEvent,
  RoutedChannel,
} from "../types/notifications.js";
import type { Severity } from "../types/work.js";

interface DispatchOptions {
  force?: boolean;
}

interface DigestOptions {
  slug?: string;
  days?: number;
}

function severityRank(severity: Severity): number {
  return Number(severity.slice(1));
}

function channelId(channel: RoutedChannel): string {
  return `${channel.scope}:${channel.slug}:${channel.channel.type}:${channel.index}`;
}

function matchesEvent(
  channel: ChannelConfig,
  event: NotificationEvent,
): boolean {
  if (channel.events.length === 1 && channel.events[0] === "*") {
    return true;
  }
  return (channel.events as NotificationEvent["type"][]).includes(event.type);
}

function passesSeverity(
  channel: ChannelConfig,
  event: NotificationEvent,
): boolean {
  if (!channel.minSeverity) {
    return true;
  }
  if (!event.severity) {
    return false;
  }
  return severityRank(event.severity) <= severityRank(channel.minSeverity);
}

function routeChannels(
  config: NotificationConfig,
  slug: string,
): RoutedChannel[] {
  const globalChannels = config.global.map((channel, index) => ({
    scope: "global" as const,
    slug,
    index,
    channel,
  }));
  const repoChannels = (config.repos[slug] ?? []).map((channel, index) => ({
    scope: "repo" as const,
    slug,
    index,
    channel,
  }));
  return [...globalChannels, ...repoChannels];
}

async function dispatchToChannel(
  routed: RoutedChannel,
  event: NotificationEvent,
  options: DispatchOptions,
): Promise<NotificationDispatchResult> {
  const id = channelId(routed);

  if (!matchesEvent(routed.channel, event)) {
    return {
      channelId: id,
      channelType: routed.channel.type,
      success: true,
      skipped: true,
      reason: "event-not-subscribed",
    };
  }

  if (!passesSeverity(routed.channel, event)) {
    return {
      channelId: id,
      channelType: routed.channel.type,
      success: true,
      skipped: true,
      reason: "below-min-severity",
    };
  }

  try {
    if (routed.channel.type === "slack") {
      await sendSlack(routed.channel.config, event);
    } else {
      const shouldSendImmediate =
        options.force || routed.channel.config.schedule === "immediate";
      if (!shouldSendImmediate) {
        return {
          channelId: id,
          channelType: routed.channel.type,
          success: true,
          skipped: true,
          reason: "digest-scheduled",
        };
      }
      await sendEmailImmediate(routed.channel.config, event);
    }

    return {
      channelId: id,
      channelType: routed.channel.type,
      success: true,
    };
  } catch (error: unknown) {
    return {
      channelId: id,
      channelType: routed.channel.type,
      success: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function dispatch(
  event: NotificationEvent,
  options: DispatchOptions = {},
): Promise<NotificationDispatchResult[]> {
  const config = await loadNotificationConfig();

  if (!config) {
    return [];
  }

  await appendNotificationEvent(event);

  const channels = routeChannels(config, event.slug);
  const results = await Promise.all(
    channels.map((channel) => dispatchToChannel(channel, event, options)),
  );

  await Promise.all(
    results.map((result) =>
      appendNotificationLog(event.slug, {
        timestamp: new Date().toISOString(),
        eventType: event.type,
        summary: event.summary,
        severity: event.severity,
        channelId: result.channelId,
        channelType: result.channelType,
        success: result.success,
        skipped: result.skipped,
        reason: result.reason,
      }),
    ),
  );

  for (const result of results) {
    if (!result.success && !result.skipped) {
      process.stderr.write(
        `[notifications] ${result.channelId} failed: ${result.reason ?? "unknown error"}\n`,
      );
    }
  }

  return results;
}

function digestWindow(days: number): { start: string; end: string } {
  const end = new Date();
  const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
  return { start: start.toISOString(), end: end.toISOString() };
}

async function allTargetSlugs(): Promise<string[]> {
  const repoConfigs = await loadRepoConfigs();
  return repoConfigs.map((r) => r.slug).sort();
}

function inRange(timestamp: string, startIso: string, endIso: string): boolean {
  return timestamp >= startIso && timestamp <= endIso;
}

export async function sendScheduledDigests(
  options: DigestOptions = {},
): Promise<NotificationDispatchResult[]> {
  const config = await loadNotificationConfig();
  if (!config) {
    return [];
  }

  const days = options.days && options.days > 0 ? options.days : 7;
  const window = digestWindow(days);
  const targetSlugs = options.slug ? [options.slug] : await allTargetSlugs();

  const results: NotificationDispatchResult[] = [];

  for (const slug of targetSlugs) {
    const channels = routeChannels(config, slug);
    const digestChannels = channels.filter(
      (entry) =>
        entry.channel.type === "email" &&
        entry.channel.config.schedule !== "immediate",
    );

    if (digestChannels.length === 0) {
      continue;
    }

    const events = (await readNotificationEvents(slug)).filter((event) =>
      inRange(event.timestamp, window.start, window.end),
    );

    for (const routed of digestChannels) {
      const id = channelId(routed);
      try {
        if (routed.channel.type !== "email") {
          continue;
        }
        await sendEmailDigest(routed.channel.config, events, window);
        const successResult: NotificationDispatchResult = {
          channelId: id,
          channelType: "email",
          success: true,
        };
        results.push(successResult);
        await appendNotificationLog(slug, {
          timestamp: new Date().toISOString(),
          eventType: "digest-sent",
          summary: `Digest sent for ${days}d window`,
          channelId: id,
          channelType: "email",
          success: true,
        });
      } catch (error: unknown) {
        const failedResult: NotificationDispatchResult = {
          channelId: id,
          channelType: "email",
          success: false,
          reason: error instanceof Error ? error.message : String(error),
        };
        results.push(failedResult);
        await appendNotificationLog(slug, {
          timestamp: new Date().toISOString(),
          eventType: "digest-failed",
          summary: `Digest failed for ${days}d window`,
          channelId: id,
          channelType: "email",
          success: false,
          reason: failedResult.reason,
        });
      }
    }
  }

  return results;
}
