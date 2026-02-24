#!/usr/bin/env node

import { runAnalyzeCommand } from "./commands/analyze.js";
import { runCollectCommand } from "./commands/collect.js";
import { runHookCommand } from "./commands/hook.js";
import { runInitCommand } from "./commands/init.js";
import { runPruneCommand } from "./commands/prune.js";
import { runReportCommand } from "./commands/report.js";

function printHelp(): void {
  process.stdout.write(`Warden CLI\n\n`);
  process.stdout.write(`Usage:\n`);
  process.stdout.write(`  warden init <path>\n`);
  process.stdout.write(`  warden collect [--repo <slug>]\n`);
  process.stdout.write(
    `  warden report [--repo <slug>] [--analyze] [--compare <branch>]\n`,
  );
  process.stdout.write(`  warden analyze [--repo <slug>]\n`);
  process.stdout.write(`  warden prune [--repo <slug>] [--keep <n>]\n`);
  process.stdout.write(`  warden hook install [--repo <slug>]\n`);
  process.stdout.write(`  warden hook uninstall [--repo <slug>]\n`);
  process.stdout.write(`  warden hook tick --repo <slug>\n`);
}

function getFlagValue(args: string[], flag: string): string | undefined {
  const flagIndex = args.indexOf(flag);
  if (flagIndex < 0) {
    return undefined;
  }

  return args[flagIndex + 1];
}

function parseHookAction(value: string | undefined):
  | "install"
  | "uninstall"
  | "tick" {
  if (value === "install" || value === "uninstall" || value === "tick") {
    return value;
  }

  throw new Error(
    "Unknown hook action. Usage: warden hook <install|uninstall|tick> [--repo <slug>]",
  );
}

async function main(): Promise<void> {
  const [, , command, ...rest] = process.argv;

  if (!command || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  switch (command) {
    case "init": {
      const repoPath = rest[0];
      if (!repoPath) {
        throw new Error("Missing path argument. Usage: warden init <path>");
      }

      await runInitCommand(repoPath);
      return;
    }
    case "collect": {
      const repoSlug = getFlagValue(rest, "--repo");
      await runCollectCommand(repoSlug);
      return;
    }
    case "report": {
      const repoSlug = getFlagValue(rest, "--repo");
      const analyze = rest.includes("--analyze");
      const compareBranch = getFlagValue(rest, "--compare");
      await runReportCommand(repoSlug, analyze, compareBranch);
      return;
    }
    case "analyze": {
      const repoSlug = getFlagValue(rest, "--repo");
      await runAnalyzeCommand(repoSlug);
      return;
    }
    case "prune": {
      const repoSlug = getFlagValue(rest, "--repo");
      const keep = getFlagValue(rest, "--keep");
      await runPruneCommand(repoSlug, keep);
      return;
    }
    case "hook": {
      const action = parseHookAction(rest[0]);
      const repoSlug = getFlagValue(rest, "--repo");
      await runHookCommand(action, repoSlug);
      return;
    }
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Error: ${message}\n`);
  process.exitCode = 1;
});
