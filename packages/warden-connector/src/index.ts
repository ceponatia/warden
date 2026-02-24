import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

export interface TrackingEvent {
  route: string;
  method: string;
  timestamp: string;
}

export interface TrackingOptions {
  outputPath?: string;
  routeResolver?: (request: Request) => string;
}

const DEFAULT_OUTPUT_PATH = ".warden/runtime/api-hits.jsonl";

async function appendTrackingEvent(
  event: TrackingEvent,
  outputPath: string,
): Promise<void> {
  const absolutePath = path.resolve(process.cwd(), outputPath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await appendFile(absolutePath, `${JSON.stringify(event)}\n`, "utf8");
}

export function withTracking<Args extends unknown[], ResponseValue>(
  handler: (...args: Args) => Promise<ResponseValue>,
  options?: TrackingOptions,
): (...args: Args) => Promise<ResponseValue> {
  const outputPath = options?.outputPath ?? DEFAULT_OUTPUT_PATH;

  return async (...args: Args): Promise<ResponseValue> => {
    const request = args[0] as Request | undefined;
    if (request) {
      const route =
        options?.routeResolver?.(request) ?? new URL(request.url).pathname;
      const method = request.method;
      const timestamp = new Date().toISOString();
      await appendTrackingEvent({ route, method, timestamp }, outputPath);
    }

    return handler(...args);
  };
}
