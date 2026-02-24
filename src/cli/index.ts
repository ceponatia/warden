#!/usr/bin/env node

import { runAnalyzeCommand } from "./commands/analyze.js";
import { runCollectCommand } from "./commands/collect.js";
import { runInitCommand } from "./commands/init.js";
import { runReportCommand } from "./commands/report.js";

function printHelp(): void {
  process.stdout.write(`Warden CLI\n\n`);
  process.stdout.write(`Usage:\n`);
  process.stdout.write(`  warden init <path>\n`);
  process.stdout.write(`  warden collect [--repo <slug>]\n`);
  process.stdout.write(`  warden report [--repo <slug>] [--analyze]\n`);
  process.stdout.write(`  warden analyze [--repo <slug>]\n`);
}

function getFlagValue(args: string[], flag: string): string | undefined {
  const flagIndex = args.indexOf(flag);
  if (flagIndex < 0) {
    return undefined;
  }

  return args[flagIndex + 1];
}

async function main(): Promise<void> {
  const [, , command, ...rest] = process.argv;

  if (!command || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  if (command === "init") {
    const repoPath = rest[0];
    if (!repoPath) {
      throw new Error("Missing path argument. Usage: warden init <path>");
    }

    await runInitCommand(repoPath);
    return;
  }

  if (command === "collect") {
    const repoSlug = getFlagValue(rest, "--repo");
    await runCollectCommand(repoSlug);
    return;
  }

  if (command === "report") {
    const repoSlug = getFlagValue(rest, "--repo");
    const analyze = rest.includes("--analyze");
    await runReportCommand(repoSlug, analyze);
    return;
  }

  if (command === "analyze") {
    const repoSlug = getFlagValue(rest, "--repo");
    await runAnalyzeCommand(repoSlug);
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Error: ${message}\n`);
  process.exitCode = 1;
});
