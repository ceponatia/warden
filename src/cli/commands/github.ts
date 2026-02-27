import { runGithubAuth } from "../../github/auth.js";

function getFlagValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index < 0) {
    return undefined;
  }

  return args[index + 1];
}

export async function runGithubCommand(rest: string[]): Promise<void> {
  const subcommand = rest[0];
  if (subcommand !== "auth") {
    throw new Error(
      "Unknown github action. Usage: warden github auth [--token <token>]",
    );
  }

  const token = getFlagValue(rest, "--token");
  await runGithubAuth(token);
  process.stdout.write("GitHub authentication saved to config/github.json\n");
}
