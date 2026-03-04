import { createGithubClient } from "./client.js";

const WARDEN_COMMENT_MARKER = "<!-- warden-trajectory -->";

export async function upsertTrajectoryComment(
  owner: string,
  repo: string,
  prNumber: number,
  body: string,
): Promise<{ commentId: number; created: boolean }> {
  const client = await createGithubClient();
  const markedBody = `${WARDEN_COMMENT_MARKER}\n${body}`;

  // Find existing Warden comment
  const { data: comments } = await client.issues.listComments({
    owner, repo, issue_number: prNumber, per_page: 100,
  });
  const existing = comments.find(c => c.body?.includes(WARDEN_COMMENT_MARKER));

  if (existing) {
    await client.issues.updateComment({
      owner, repo, comment_id: existing.id, body: markedBody,
    });
    return { commentId: existing.id, created: false };
  }

  const { data: created } = await client.issues.createComment({
    owner, repo, issue_number: prNumber, body: markedBody,
  });
  return { commentId: created.id, created: true };
}
