import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { RepoConfig } from "../types/snapshot.js";
import { normalizeRepoConfig } from "./schema.js";

const CONFIG_DIR = path.resolve(process.cwd(), "config");
const REPOS_CONFIG_PATH = path.join(CONFIG_DIR, "repos.json");

export async function loadRepoConfigs(): Promise<RepoConfig[]> {
  try {
    const raw = await readFile(REPOS_CONFIG_PATH, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      throw new Error("Expected repos.json to be an array");
    }

    return parsed.map((entry) => normalizeRepoConfig(entry));
  } catch (error) {
    const errorWithCode = error as NodeJS.ErrnoException;
    if (errorWithCode.code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

export async function saveRepoConfigs(configs: RepoConfig[]): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true });
  const ordered = [...configs].sort((left, right) =>
    left.slug.localeCompare(right.slug),
  );
  await writeFile(
    REPOS_CONFIG_PATH,
    `${JSON.stringify(ordered, null, 2)}\n`,
    "utf8",
  );
}

export async function upsertRepoConfig(config: RepoConfig): Promise<void> {
  const configs = await loadRepoConfigs();
  const existingIndex = configs.findIndex(
    (entry) => entry.slug === config.slug,
  );

  if (existingIndex >= 0) {
    configs[existingIndex] = config;
  } else {
    configs.push(config);
  }

  await saveRepoConfigs(configs);
}

export function getRepoConfigBySlug(
  configs: RepoConfig[],
  slug: string,
): RepoConfig {
  const match = configs.find((entry) => entry.slug === slug);
  if (!match) {
    throw new Error(`Unknown repo slug: ${slug}`);
  }

  return match;
}
