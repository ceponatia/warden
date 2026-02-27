import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export interface GithubAuthConfig {
  provider: "pat" | "app";
  token: string;
  installedAt: string;
}

const CONFIG_PATH = path.resolve(process.cwd(), "config", "github.json");

export async function loadGithubAuthConfig(): Promise<GithubAuthConfig | null> {
  try {
    const raw = await readFile(CONFIG_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<GithubAuthConfig>;
    if (!parsed.token || typeof parsed.token !== "string") {
      return null;
    }

    return {
      provider: parsed.provider === "app" ? "app" : "pat",
      token: parsed.token,
      installedAt:
        typeof parsed.installedAt === "string"
          ? parsed.installedAt
          : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export async function saveGithubAuthConfig(
  config: GithubAuthConfig,
): Promise<void> {
  await mkdir(path.dirname(CONFIG_PATH), { recursive: true });
  await writeFile(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

export async function resolveGithubToken(): Promise<string | null> {
  const envToken = process.env.WARDEN_GITHUB_TOKEN?.trim();
  if (envToken) {
    return envToken;
  }

  const config = await loadGithubAuthConfig();
  return config?.token ?? null;
}

export async function runGithubAuth(token?: string): Promise<void> {
  const resolvedToken = token?.trim() || (await resolveGithubToken());
  if (!resolvedToken) {
    throw new Error(
      "Missing GitHub token. Set WARDEN_GITHUB_TOKEN or run 'warden github auth --token <token>'.",
    );
  }

  await saveGithubAuthConfig({
    provider: "pat",
    token: resolvedToken,
    installedAt: new Date().toISOString(),
  });
}
