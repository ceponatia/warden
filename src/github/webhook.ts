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

export interface PullRequestContext {
  slug: string;
  owner: string;
  repo: string;
  prNumber: number;
}

export interface WebhookHandlers {
  onPush: (slug: string) => Promise<void>;
  onPullRequestMerged: (ctx: PullRequestContext) => Promise<void>;
  onPullRequestOpened?: (ctx: PullRequestContext) => Promise<void>;
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

const DEFAULT_AGENT_NAME = "lint-fix-agent";

function extractAgentFromBranch(branchName: string): string {
  const match = branchName.match(/^warden\/([^/]+)/);
  const token = match?.[1];
  if (!token) {
    return DEFAULT_AGENT_NAME;
  }

  if (token === "lint" || token === "lint-fix") {
    return "lint-fix-agent";
  }
  if (token === "test" || token === "test-writing") {
    return "test-writing-agent";
  }
  if (token === "doc" || token === "doc-update") {
    return "doc-update-agent";
  }
  if (token.endsWith("-agent")) {
    return token;
  }

  return `${token}-agent`;
}

async function handleEvent(params: {
  event: string;
  payload: Record<string, unknown>;
  handlers: WebhookHandlers;
  config: WebhookConfig;
}): Promise<void> {
  const ctx = await resolveContext(params.payload, params.handlers);
  if (!ctx) {
    return;
  }

  if (params.event === "push") {
    await handlePushEvent(ctx.slug, params.handlers, params.config);
    return;
  }

  if (params.event === "delete") {
    await handleDeleteEvent(ctx.slug, params.payload, params.config);
    return;
  }

  if (params.event === "pull_request") {
    await handlePullRequestEvent(
      ctx,
      params.payload,
      params.handlers,
      params.config,
    );
    return;
  }

  if (params.event === "pull_request_review") {
    await handlePullRequestReviewEvent(ctx.slug, params.payload);
  }
}

async function resolveContext(
  payload: Record<string, unknown>,
  handlers: WebhookHandlers,
): Promise<{ slug: string; owner: string; repo: string } | null> {
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

  const slug = await handlers.resolveSlugByRepo(owner, name);
  if (!slug) return null;

  return { slug, owner, repo: name };
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
    const agentName = extractAgentFromBranch(ref);
    await recordMergeResult(slug, agentName, "modified");
  }
}

// Rationale: PR event handling intentionally branches by action and PR type to keep webhook policy decisions explicit.
// eslint-disable-next-line complexity
async function handlePullRequestEvent(
  ctx: { slug: string; owner: string; repo: string },
  payload: Record<string, unknown>,
  handlers: WebhookHandlers,
  config: WebhookConfig,
): Promise<void> {
  const action = typeof payload.action === "string" ? payload.action : "";
  const pr = extractPullRequest(payload);
  if (!pr) {
    return;
  }
  const prNumber = pr.number;
  const isWardenPr = isWardenPullRequest(pr);
  const merged = pr.merged === true;

  // Handle PR opened (non-Warden PRs only)
  if (
    action === "opened" &&
    !isWardenPr &&
    prNumber &&
    handlers.onPullRequestOpened
  ) {
    try {
      await handlers.onPullRequestOpened({
        slug: ctx.slug,
        owner: ctx.owner,
        repo: ctx.repo,
        prNumber,
      });
    } catch (error) {
      console.error("Failed to post trajectory comment on PR open:", error);
    }
  }

  // Existing: Handle Warden PR closed (trust recording)
  if (isWardenPr && action === "closed") {
    const agentName = extractAgentFromBranch(pr.head?.ref ?? "");
    if (merged) {
      await recordMergeResult(ctx.slug, agentName, "accepted");
    } else {
      await recordMergeResult(ctx.slug, agentName, "rejected");
    }
  }

  // Handle PR merged (collection + trajectory comment)
  const shouldTriggerCollection =
    action === "closed" && merged && config.triggers.onPullRequestMerge;

  if (!isWardenPr && shouldTriggerCollection) {
    if (prNumber) {
      await handlers.onPullRequestMerged({
        slug: ctx.slug,
        owner: ctx.owner,
        repo: ctx.repo,
        prNumber,
      });
    }
    return;
  }

  if (isWardenPr && shouldTriggerCollection) {
    if (prNumber) {
      await handlers.onPullRequestMerged({
        slug: ctx.slug,
        owner: ctx.owner,
        repo: ctx.repo,
        prNumber,
      });
    }
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

  const review = readReviewPayload(payload);
  const approved = isSilentApproval(review);
  const comments = approved ? [] : buildReviewComments(review);
  const agentName = extractAgentFromBranch(pr.head?.ref ?? "");
  await recordPrReviewResult(slug, agentName, approved, comments);
}

interface PullRequestReviewPayload {
  state: string;
  body: string;
}

function readReviewPayload(
  payload: Record<string, unknown>,
): PullRequestReviewPayload {
  const review = payload.review as
    | { state?: string; body?: string }
    | undefined;
  return {
    state: review?.state ?? "",
    body: review?.body?.trim() ?? "",
  };
}

function isSilentApproval(review: PullRequestReviewPayload): boolean {
  return review.state === "APPROVED" && review.body.length === 0;
}

function buildReviewComments(review: PullRequestReviewPayload): string[] {
  return [review.body || review.state || "reviewed"];
}

type WebhookPullRequest = {
  number?: number;
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

const MAX_BODY_BYTES = 1 * 1024 * 1024; // 1 MB

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of req) {
    const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    totalBytes += buf.length;
    if (totalBytes > MAX_BODY_BYTES) {
      throw new Error("Request body too large");
    }
    chunks.push(buf);
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
