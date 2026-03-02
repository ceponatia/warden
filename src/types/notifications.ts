import type { Severity } from "./work.js";

export type NotificationEventType =
  | "escalation"
  | "agent-pr-created"
  | "auto-merge"
  | "trust-revocation"
  | "coverage-regression"
  | "systemic-pattern"
  | "analysis-complete"
  | "collection-failed";

export type NotificationLogEventType =
  | NotificationEventType
  | "digest-sent"
  | "digest-failed";

export interface NotificationEvent {
  type: NotificationEventType;
  slug: string;
  timestamp: string;
  severity?: Severity;
  summary: string;
  details: Record<string, unknown>;
  dashboardUrl?: string;
}

export interface SlackChannelConfig {
  webhookUrl: string;
  channel?: string;
  username?: string;
  mentionOnEscalation?: string;
}

export interface EmailChannelConfig {
  recipients: string[];
  schedule: "immediate" | "daily" | "weekly";
  smtpHost?: string;
  smtpPort?: number;
  smtpUser?: string;
  smtpPass?: string;
}

export interface BaseChannelConfig {
  events: NotificationEventType[] | ["*"];
  minSeverity?: Severity;
}

export interface SlackChannel extends BaseChannelConfig {
  type: "slack";
  config: SlackChannelConfig;
}

export interface EmailChannel extends BaseChannelConfig {
  type: "email";
  config: EmailChannelConfig;
}

export type ChannelConfig = SlackChannel | EmailChannel;

export interface NotificationConfig {
  global: ChannelConfig[];
  repos: Record<string, ChannelConfig[]>;
}

export interface RoutedChannel {
  scope: "global" | "repo";
  slug: string;
  index: number;
  channel: ChannelConfig;
}

export interface NotificationDispatchResult {
  channelId: string;
  channelType: "slack" | "email";
  success: boolean;
  skipped?: boolean;
  reason?: string;
}

export interface NotificationLogEntry {
  timestamp: string;
  eventType: NotificationLogEventType;
  summary: string;
  severity?: Severity;
  channelId: string;
  channelType: "slack" | "email";
  success: boolean;
  skipped?: boolean;
  reason?: string;
}
