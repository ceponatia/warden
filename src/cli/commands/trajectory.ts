import fs from 'node:fs/promises';
import { TrajectoryStore } from "../../work/trajectory-store.js";
import { parseMermaidTrajectory, exportMermaidTrajectory } from "../../work/trajectory-vizvibe.js";
import { syncTrajectoryWithPullRequest } from "../../work/trajectory-sync.js";

export async function runTrajectoryCommand(args: string[]): Promise<void> {
  const action = args[0];
  const repoSlug = getFlagValue(args, "--repo");

  if (!repoSlug) {
    throw new Error("Missing --repo slug. Usage: warden trajectory <init|validate|import|export|patch|sync-pr> --repo <slug>");
  }

  const store = new TrajectoryStore(repoSlug);

  switch (action) {
    case "init":
      await store.init();
      console.log(`Initialized trajectory for repo "${repoSlug}"`);
      break;
    case "get": {
      const graph = await store.load();
      console.log(`\nTrajectory: ${repoSlug} (Revision: ${graph.meta.revision})\n`);
      console.table(graph.nodes.map(n => ({
        ID: n.id,
        Title: n.title,
        Status: n.status,
        Type: n.type,
        Updated: n.updatedAt.slice(0, 10)
      })));
      break;
    }
    case "validate": {
      const errors = await store.validate();
      if (errors.length > 0) {
        console.error(`Invalid trajectory for repo "${repoSlug}":`);
        errors.forEach(e => console.error(` - ${e}`));
        process.exit(1);
      }
      console.log(`Trajectory for repo "${repoSlug}" is valid.`);
      break;
    }
    case "import": {
      const fromPath = getFlagValue(args, "--from") || 'vizvibe.mmd';
      const mmd = await fs.readFile(fromPath, 'utf-8');
      const graph = parseMermaidTrajectory(mmd, repoSlug);
      await store.save(graph);
      console.log(`Imported trajectory from "${fromPath}" into repo "${repoSlug}"`);
      break;
    }
    case "export": {
      const toPath = getFlagValue(args, "--to") || 'vizvibe.mmd';
      const graph = await store.load();
      const mmd = exportMermaidTrajectory(graph);
      await fs.writeFile(toPath, mmd, 'utf-8');
      console.log(`Exported trajectory from repo "${repoSlug}" to "${toPath}"`);
      break;
    }
    case "patch": {
      const opsPath = getFlagValue(args, "--ops");
      if (!opsPath) throw new Error("Missing --ops <path> to patch operations JSON");
      const revRaw = getFlagValue(args, "--rev");
      let expectedRevision: number | undefined;
      
      if (revRaw !== undefined) {
        expectedRevision = Number(revRaw);
        if (Number.isNaN(expectedRevision)) {
          throw new Error(`Invalid revision: "${revRaw}". Must be a number.`);
        }
      }
      
      const raw = await fs.readFile(opsPath, 'utf-8');
      const ops = JSON.parse(raw);
      await store.patch("cli", ops, expectedRevision);
      console.log(`Applied patch to repo "${repoSlug}"`);
      break;
    }
    case "sync-pr": {
      const prRaw = getFlagValue(args, "--pr");
      const githubOwner = getFlagValue(args, "--owner") || process.env.GITHUB_REPOSITORY_OWNER;
      const githubRepo = getFlagValue(args, "--repo-name") || process.env.GITHUB_REPOSITORY_NAME;

      if (!prRaw || !githubOwner || !githubRepo) {
        throw new Error("Missing arguments. Usage: warden trajectory sync-pr --repo <slug> --pr <number> --owner <owner> --repo-name <name>");
      }

      const prNumber = Number(prRaw);
      if (Number.isNaN(prNumber)) {
        throw new Error("Invalid PR number");
      }

      await syncTrajectoryWithPullRequest(githubOwner, githubRepo, prNumber, repoSlug);
      break;
    }
    default:
      throw new Error(`Unknown trajectory action: ${action}. Usage: warden trajectory <init|validate|import|export|patch|sync-pr> --repo <slug>`);
  }
}

function getFlagValue(args: string[], flag: string): string | undefined {
  const flagIndex = args.indexOf(flag);
  if (flagIndex < 0) {
    return undefined;
  }
  return args[flagIndex + 1];
}
