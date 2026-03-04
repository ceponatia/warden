import { createGithubClient } from "./client.js";

const WARDEN_COMMENT_MARKER = "<!-- warden-trajectory -->";

function matchesExpectedAuthor(
  login: string | undefined,
  expectedBotLogin: string | undefined,
): boolean {
  if (!expectedBotLogin) {
    return true;
  }

  return login?.toLowerCase() === expectedBotLogin.toLowerCase();
}

function isRecoverableUpdateError(error: unknown): boolean {
  const status = (error as { status?: number })?.status;
  return status === 403 || status === 404;
}

export async function upsertTrajectoryComment(
  owner: string,
  repo: string,
  prNumber: number,
  body: string,
  options?: { expectedBotLogin?: string },
): Promise<{ commentId: number; created: boolean }> {
  const client = await createGithubClient();
  const markedBody = `${WARDEN_COMMENT_MARKER}\n${body}`;

  // Find existing Warden comment
  const { data: comments } = await client.issues.listComments({
    owner,
    repo,
    issue_number: prNumber,
    per_page: 100,
  });
  if (!options?.expectedBotLogin) {
    console.warn(
      "Trajectory comment upsert is using marker-only lookup because expectedBotLogin is not set.",
    );
  }

  const existing = comments.find(
    (comment) =>
      comment.body?.includes(WARDEN_COMMENT_MARKER) &&
      matchesExpectedAuthor(comment.user?.login, options?.expectedBotLogin),
  );

  if (existing) {
    try {
      await client.issues.updateComment({
        owner,
        repo,
        comment_id: existing.id,
        body: markedBody,
      });
      return { commentId: existing.id, created: false };
    } catch (error) {
      if (!isRecoverableUpdateError(error)) {
        throw error;
      }

      console.warn(
        `Could not update existing trajectory comment (id: ${existing.id}), creating new one.`,
      );
    }
  }

  const { data: created } = await client.issues.createComment({
    owner,
    repo,
    issue_number: prNumber,
    body: markedBody,
  });
  return { commentId: created.id, created: true };
}
