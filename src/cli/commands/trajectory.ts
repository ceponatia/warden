import fs from "node:fs/promises";
import { TrajectoryStore } from "../../work/trajectory-store.js";
import {
  parseMermaidTrajectory,
  exportMermaidTrajectory,
} from "../../work/trajectory-vizvibe.js";
import { syncTrajectoryWithPullRequest } from "../../work/trajectory-sync.js";
import { loadRepoConfigs, getRepoConfigBySlug } from "../../config/loader.js";
import { postTrajectoryCommentOnPr } from "../../work/trajectory-comment.js";

interface TrajectoryContext {
  store: TrajectoryStore;
  args: string[];
  repoSlug: string;
}

const handlers: Record<string, (ctx: TrajectoryContext) => Promise<void>> = {
  async init({ store, repoSlug }) {
    await store.init();
    console.log(`Initialized trajectory for repo "${repoSlug}"`);
  },

  async get({ store, repoSlug }) {
    const graph = await store.load();
    console.log(
      `\nTrajectory: ${repoSlug} (Revision: ${graph.meta.revision})\n`,
    );
    console.table(
      graph.nodes.map((n) => ({
        ID: n.id,
        Title: n.title,
        Status: n.status,
        Type: n.type,
        Updated: n.updatedAt.slice(0, 10),
      })),
    );
  },

  async validate({ store, repoSlug }) {
    const errors = await store.validate();
    if (errors.length > 0) {
      console.error(`Invalid trajectory for repo "${repoSlug}":`);
      errors.forEach((e) => console.error(` - ${e}`));
      process.exit(1);
    }
    console.log(`Trajectory for repo "${repoSlug}" is valid.`);
  },

  async import({ store, args, repoSlug }) {
    const fromPath = getFlagValue(args, "--from") || "vizvibe.mmd";
    const mmd = await fs.readFile(fromPath, "utf-8");
    const graph = parseMermaidTrajectory(mmd, repoSlug);
    await store.save(graph);
    console.log(
      `Imported trajectory from "${fromPath}" into repo "${repoSlug}"`,
    );
  },

  async export({ store, args, repoSlug }) {
    const toPath = getFlagValue(args, "--to") || "vizvibe.mmd";
    const graph = await store.load();
    const mmd = exportMermaidTrajectory(graph);
    await fs.writeFile(toPath, mmd, "utf-8");
    console.log(`Exported trajectory from repo "${repoSlug}" to "${toPath}"`);
  },

  async patch({ store, args, repoSlug }) {
    const opsPath = getFlagValue(args, "--ops");
    if (!opsPath)
      throw new Error("Missing --ops <path> to patch operations JSON");
    const revRaw = getFlagValue(args, "--rev");
    let expectedRevision: number | undefined;

    if (revRaw !== undefined) {
      expectedRevision = Number(revRaw);
      if (Number.isNaN(expectedRevision)) {
        throw new Error(`Invalid revision: "${revRaw}". Must be a number.`);
      }
    }

    const raw = await fs.readFile(opsPath, "utf-8");
    const ops = JSON.parse(raw);
    await store.patch("cli", ops, expectedRevision);
    console.log(`Applied patch to repo "${repoSlug}"`);
  },

  "sync-pr": async ({ args, repoSlug }) => {
    const prRaw = getFlagValue(args, "--pr");
    const githubOwner =
      getFlagValue(args, "--owner") || process.env.GITHUB_REPOSITORY_OWNER;
    const githubRepo =
      getFlagValue(args, "--repo-name") || process.env.GITHUB_REPOSITORY_NAME;

    if (!prRaw || !githubOwner || !githubRepo) {
      throw new Error(
        "Missing arguments. Usage: warden trajectory sync-pr --repo <slug> --pr <number> --owner <owner> --repo-name <name>",
      );
    }

    const prNumber = Number(prRaw);
    if (Number.isNaN(prNumber)) {
      throw new Error("Invalid PR number");
    }

    await syncTrajectoryWithPullRequest(
      githubOwner,
      githubRepo,
      prNumber,
      repoSlug,
    );
  },

  async comment({ args, repoSlug }) {
    const prStr = getFlagValue(args, "--pr");
    if (!prStr) {
      throw new Error(
        "Missing --pr number. Usage: warden trajectory comment --repo <slug> --pr <number>",
      );
    }
    const prNumber = parseInt(prStr, 10);
    if (Number.isNaN(prNumber)) {
      throw new Error(`Invalid PR number: ${prStr}`);
    }
    const configs = await loadRepoConfigs();
    const config = getRepoConfigBySlug(configs, repoSlug);
    if (!config.github) {
      throw new Error(
        `Repo "${repoSlug}" has no GitHub config. Only GitHub repos support trajectory comments.`,
      );
    }
    await postTrajectoryCommentOnPr(
      config.github.owner,
      config.github.repo,
      prNumber,
      repoSlug,
      {
        includeLocalImpact: true,
        triggeredBy: "manual",
      },
    );
    console.log(
      `Posted trajectory comment on PR #${prNumber} for repo "${repoSlug}"`,
    );
  },
};

export async function runTrajectoryCommand(args: string[]): Promise<void> {
  const action = args[0];
  const repoSlug = getFlagValue(args, "--repo");

  if (!repoSlug) {
    throw new Error(
      "Missing --repo slug. Usage: warden trajectory <init|validate|import|export|patch|sync-pr> --repo <slug>",
    );
  }

  const handler = action ? handlers[action] : undefined;
  if (!handler) {
    throw new Error(
      `Unknown trajectory action: ${action}. Usage: warden trajectory <init|validate|import|export|patch|sync-pr|comment> --repo <slug>`,
    );
  }

  const store = new TrajectoryStore(repoSlug);
  await handler({ store, args, repoSlug });
}

function getFlagValue(args: string[], flag: string): string | undefined {
  const flagIndex = args.indexOf(flag);
  if (flagIndex < 0) {
    return undefined;
  }
  return args[flagIndex + 1];
}
