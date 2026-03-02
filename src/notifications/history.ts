import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

import type {
  NotificationEvent,
  NotificationLogEntry,
} from "../types/notifications.js";

function notificationsDir(slug: string): string {
  return path.resolve(process.cwd(), "data", slug, "notifications");
}

function eventsPath(slug: string): string {
  return path.join(notificationsDir(slug), "events.jsonl");
}

function logPath(slug: string): string {
  return path.join(notificationsDir(slug), "delivery-log.jsonl");
}

const fileWriteQueues = new Map<string, Promise<void>>();

async function appendJsonLine(
  filePath: string,
  payload: unknown,
): Promise<void> {
  const previous = fileWriteQueues.get(filePath) ?? Promise.resolve();

  const writePromise = previous
    .catch(() => {
      // Ignore errors from earlier writes in the queue.
    })
    .then(async () => {
      await mkdir(path.dirname(filePath), { recursive: true });
      await appendFile(filePath, `${JSON.stringify(payload)}\n`, "utf8");
    })
    .finally(() => {
      if (fileWriteQueues.get(filePath) === writePromise) {
        fileWriteQueues.delete(filePath);
      }
    });

  fileWriteQueues.set(filePath, writePromise);

  return writePromise;
}

export async function appendNotificationEvent(
  event: NotificationEvent,
): Promise<void> {
  await appendJsonLine(eventsPath(event.slug), event);
}

export async function appendNotificationLog(
  slug: string,
  entry: NotificationLogEntry,
): Promise<void> {
  await appendJsonLine(logPath(slug), entry);
}

function parseJsonLines<T>(input: string): T[] {
  const rows = input
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const out: T[] = [];
  for (const row of rows) {
    try {
      out.push(JSON.parse(row) as T);
    } catch {
      // Ignore malformed lines.
    }
  }
  return out;
}

export async function readNotificationEvents(
  slug: string,
): Promise<NotificationEvent[]> {
  try {
    const raw = await readFile(eventsPath(slug), "utf8");
    return parseJsonLines<NotificationEvent>(raw);
  } catch {
    return [];
  }
}

export async function readNotificationLog(
  slug: string,
  limit = 20,
): Promise<NotificationLogEntry[]> {
  try {
    const raw = await readFile(logPath(slug), "utf8");
    const parsed = parseJsonLines<NotificationLogEntry>(raw);
    return parsed.slice(Math.max(0, parsed.length - limit)).reverse();
  } catch {
    return [];
  }
}
