import { Octokit } from "@octokit/rest";

import { resolveGithubToken } from "./auth.js";

let authenticatedLoginPromise: Promise<string | undefined> | undefined;

export async function createGithubClient(): Promise<Octokit> {
  const token = await resolveGithubToken();
  if (!token) {
    throw new Error(
      "GitHub auth is not configured. Run 'warden github auth --token <token>' or set WARDEN_GITHUB_TOKEN.",
    );
  }

  return new Octokit({ auth: token });
}

export async function resolveAuthenticatedGithubLogin(): Promise<
  string | undefined
> {
  if (authenticatedLoginPromise) {
    return authenticatedLoginPromise;
  }

  authenticatedLoginPromise = (async () => {
    const client = await createGithubClient();
    try {
      const { data } = await client.users.getAuthenticated();
      return data.login;
    } catch {
      return undefined;
    }
  })();

  return authenticatedLoginPromise;
}
