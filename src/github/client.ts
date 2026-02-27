import { Octokit } from "@octokit/rest";

import { resolveGithubToken } from "./auth.js";

export async function createGithubClient(): Promise<Octokit> {
  const token = await resolveGithubToken();
  if (!token) {
    throw new Error(
      "GitHub auth is not configured. Run 'warden github auth --token <token>' or set WARDEN_GITHUB_TOKEN.",
    );
  }

  return new Octokit({ auth: token });
}
