import { TrajectoryStore } from "../../work/trajectory-store.js";

export async function runTrajectoryCommand(args: string[]): Promise<void> {
  const action = args[0];
  const repoSlug = getFlagValue(args, "--repo");

  if (!repoSlug) {
    throw new Error("Missing --repo slug. Usage: warden trajectory <init|validate> --repo <slug>");
  }

  const store = new TrajectoryStore(repoSlug);

  switch (action) {
    case "init":
      await store.init();
      console.log(`Initialized trajectory for repo "${repoSlug}"`);
      break;
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
    default:
      throw new Error(`Unknown trajectory action: ${action}. Usage: warden trajectory <init|validate> --repo <slug>`);
  }
}

function getFlagValue(args: string[], flag: string): string | undefined {
  const flagIndex = args.indexOf(flag);
  if (flagIndex < 0) {
    return undefined;
  }
  return args[flagIndex + 1];
}
