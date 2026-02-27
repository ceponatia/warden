import { createHmac, timingSafeEqual } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";

import { recordMergeResult, recordPrReviewResult } from "../work/trust.js";

export interface WebhookConfig {
  enabled: boolean;
  port: number;
  secret: string;
  triggers: {
    onPush: boolean;
    onPullRequestMerge: boolean;
    onBranchDelete: boolean;
  };
}

export interface WebhookHandlers {
  onPush: (slug: string) => Promise<void>;
  onPullRequestMerged: (slug: string) => Promise<void>;
  resolveSlugByRepo: (owner: string, repo: string) => Promise<string | null>;
}

function verifySignature(
  secret: string,
  payload: string,
  signature: string,
): boolean {
  const expected = `sha256=${createHmac("sha256", secret).update(payload).digest("hex")}`;
  const left = Buffer.from(expected);
  const right = Buffer.from(signature);
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
}

function isWardenBranch(branchName: string): boolean {
  return branchName.startsWith("warden/");
}

async function handleEvent(params: {
  event: string;
  payload: Record<string, unknown>;
  handlers: WebhookHandlers;
  config: WebhookConfig;
}): Promise<void> {
  const slug = await resolveSlug(params.payload, params.handlers);
  if (!slug) {
    return;
  }

  if (params.event === "push") {
    await handlePushEvent(slug, params.handlers, params.config);
    return;
  }

  if (params.event === "delete") {
    await handleDeleteEvent(slug, params.payload, params.config);
    return;
  }

  if (params.event === "pull_request") {
    await handlePullRequestEvent(slug, params.payload, params.handlers, params.config);
    return;
  }

  if (params.event === "pull_request_review") {
    await handlePullRequestReviewEvent(slug, params.payload);
  }
}

async function resolveSlug(
  payload: Record<string, unknown>,
  handlers: WebhookHandlers,
): Promise<string | null> {
  const repo = payload.repository as
    | {
        owner?: { login?: string };
        name?: string;
      }
    | undefined;
  const owner = repo?.owner?.login;
  const name = repo?.name;
  if (!owner || !name) {
    return null;
  }

  return handlers.resolveSlugByRepo(owner, name);
}

async function handlePushEvent(
  slug: string,
  handlers: WebhookHandlers,
  config: WebhookConfig,
): Promise<void> {
  if (config.triggers.onPush) {
    await handlers.onPush(slug);
  }
}

async function handleDeleteEvent(
  slug: string,
  payload: Record<string, unknown>,
  config: WebhookConfig,
): Promise<void> {
  if (!config.triggers.onBranchDelete) {
    return;
  }

  const refType = payload.ref_type;
  const ref = payload.ref;
  if (refType === "branch" && typeof ref === "string" && isWardenBranch(ref)) {
    await recordMergeResult(slug, "lint-fix-agent", "modified");
  }
}

async function handlePullRequestEvent(
  slug: string,
  payload: Record<string, unknown>,
  handlers: WebhookHandlers,
  config: WebhookConfig,
): Promise<void> {
  const action = typeof payload.action === "string" ? payload.action : "";
  const pr = extractPullRequest(payload);
  if (!pr) {
    return;
  }
  const isWardenPr = isWardenPullRequest(pr);
  const merged = pr.merged === true;
  const shouldTriggerCollection =
    action === "closed" && merged && config.triggers.onPullRequestMerge;

  if (!isWardenPr) {
    if (shouldTriggerCollection) {
      await handlers.onPullRequestMerged(slug);
    }
    return;
  }

  if (action === "closed") {
    if (merged) {
      await recordMergeResult(slug, "lint-fix-agent", "accepted");
    } else {
      await recordMergeResult(slug, "lint-fix-agent", "rejected");
    }
  }

  if (shouldTriggerCollection) {
    await handlers.onPullRequestMerged(slug);
  }
}

async function handlePullRequestReviewEvent(
  slug: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const pr = extractPullRequest(payload);
  if (!pr || !isWardenPullRequest(pr)) {
    return;
  }

  const review = payload.review as { state?: string; body?: string } | undefined;
  const body = review?.body?.trim() ?? "";
  const approved = review?.state === "APPROVED" && body.length === 0;
  const comments = approved ? [] : [body || review?.state || "reviewed"];
  await recordPrReviewResult(slug, "lint-fix-agent", approved, comments);
}

type WebhookPullRequest = {
  merged?: boolean;
  head?: { ref?: string };
};

function extractPullRequest(
  payload: Record<string, unknown>,
): WebhookPullRequest | null {
  const pr = payload.pull_request as WebhookPullRequest | undefined;
  return pr ?? null;
}

function isWardenPullRequest(pr: WebhookPullRequest): boolean {
  const headRef = pr.head?.ref;
  return typeof headRef === "string" && isWardenBranch(headRef);
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function respond(
  res: ServerResponse,
  statusCode: number,
  message: string,
): void {
  res.statusCode = statusCode;
  res.setHeader("content-type", "text/plain; charset=utf-8");
  res.end(message);
}

export function startWebhookServer(
  config: WebhookConfig,
  handlers: WebhookHandlers,
): Server {
  const server = createServer(async (req, res) => {
    if (req.method !== "POST" || req.url !== "/webhook") {
      respond(res, 404, "Not found");
      return;
    }

    const payload = await readBody(req);
    const signature = req.headers["x-hub-signature-256"];
    const event = req.headers["x-github-event"];

    if (!signature || typeof signature !== "string") {
      respond(res, 401, "Missing signature");
      return;
    }
    if (!event || typeof event !== "string") {
      respond(res, 400, "Missing event");
      return;
    }

    if (!verifySignature(config.secret, payload, signature)) {
      respond(res, 401, "Invalid signature");
      return;
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(payload) as Record<string, unknown>;
    } catch {
      respond(res, 400, "Invalid JSON");
      return;
    }

    try {
      await handleEvent({
        event,
        payload: parsed,
        handlers,
        config,
      });
      respond(res, 202, "Accepted");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      respond(res, 500, message);
    }
  });

  server.listen(config.port);
  return server;
}
