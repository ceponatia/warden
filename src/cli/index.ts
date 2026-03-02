#!/usr/bin/env node

import { runAnalyzeCommand } from "./commands/analyze.js";
import { runAddCommand } from "./commands/add.js";
import { runAutonomyCommand } from "./commands/autonomy.js";
import { runCollectCommand } from "./commands/collect.js";
import { runDashboardCommand } from "./commands/dashboard.js";
import { runGithubCommand } from "./commands/github.js";
import { runHookCommand } from "./commands/hook.js";
import { runInitCommand } from "./commands/init.js";
import { runMcpCommand } from "./commands/mcp.js";
import { runPruneCommand } from "./commands/prune.js";
import { runReportCommand } from "./commands/report.js";
import { runWebhookCommand } from "./commands/webhook.js";
import { runWikiCommand } from "./commands/wiki.js";
import { runWorkCommand } from "./commands/work.js";

function printHelp(): void {
  process.stdout.write(`Warden CLI\n\n`);
  process.stdout.write(`Usage:\n`);
  process.stdout.write(`  warden init <path>\n`);
  process.stdout.write(`  warden add <path|github:owner/repo>\n`);
  process.stdout.write(`  warden collect [--repo <slug>]\n`);
  process.stdout.write(
    `  warden report [--repo <slug>] [--analyze] [--compare <branch>] [--portfolio]\n`,
  );
  process.stdout.write(`  warden analyze [--repo <slug>]\n`);
  process.stdout.write(`  warden autonomy <grant|revoke|list|impact> ...\n`);
  process.stdout.write(`  warden dashboard [--port <n>]\n`);
  process.stdout.write(`  warden prune [--repo <slug>] [--keep <n>]\n`);
  process.stdout.write(`  warden hook install [--repo <slug>]\n`);
  process.stdout.write(`  warden hook uninstall [--repo <slug>]\n`);
  process.stdout.write(`  warden hook tick --repo <slug>\n`);
  process.stdout.write(`  warden github auth [--token <token>]\n`);
  process.stdout.write(`  warden webhook <start|stop>\n`);
  process.stdout.write(`  warden wiki <WD-code>\n`);
  process.stdout.write(
    `  warden work [--repo <slug>] [<findingId>] [--status <status>] [--note <text>]\n`,
  );
  process.stdout.write(`  warden mcp [--transport stdio|sse] [--port <n>]\n`);
}

function getFlagValue(args: string[], flag: string): string | undefined {
  const flagIndex = args.indexOf(flag);
  if (flagIndex < 0) {
    return undefined;
  }

  return args[flagIndex + 1];
}

function parseHookAction(
  value: string | undefined,
): "install" | "uninstall" | "tick" {
  if (value === "install" || value === "uninstall" || value === "tick") {
    return value;
  }

  throw new Error(
    "Unknown hook action. Usage: warden hook <install|uninstall|tick> [--repo <slug>]",
  );
}

type CommandHandler = (rest: string[]) => Promise<void>;

function createCommandHandlers(): Record<string, CommandHandler> {
  return {
    init: async (rest: string[]) => {
      const repoPath = rest[0];
      if (!repoPath) {
        throw new Error("Missing path argument. Usage: warden init <path>");
      }

      await runInitCommand(repoPath);
    },
    add: async (rest: string[]) => {
      const target = rest[0];
      if (!target) {
        throw new Error(
          "Missing target argument. Usage: warden add <path|github:owner/repo>",
        );
      }

      await runAddCommand(target);
    },
    collect: async (rest: string[]) => {
      const repoSlug = getFlagValue(rest, "--repo");
      await runCollectCommand(repoSlug);
    },
    report: async (rest: string[]) => {
      const repoSlug = getFlagValue(rest, "--repo");
      const analyze = rest.includes("--analyze");
      const compareBranch = getFlagValue(rest, "--compare");
      const portfolio = rest.includes("--portfolio");
      await runReportCommand({ repoSlug, analyze, compareBranch, portfolio });
    },
    analyze: async (rest: string[]) => {
      const repoSlug = getFlagValue(rest, "--repo");
      await runAnalyzeCommand(repoSlug);
    },
    autonomy: async (rest: string[]) => {
      await runAutonomyCommand(rest);
    },
    dashboard: async (rest: string[]) => {
      const port = getFlagValue(rest, "--port");
      await runDashboardCommand(port);
    },
    prune: async (rest: string[]) => {
      const repoSlug = getFlagValue(rest, "--repo");
      const keep = getFlagValue(rest, "--keep");
      await runPruneCommand(repoSlug, keep);
    },
    hook: async (rest: string[]) => {
      const action = parseHookAction(rest[0]);
      const repoSlug = getFlagValue(rest, "--repo");
      await runHookCommand(action, repoSlug);
    },
    github: async (rest: string[]) => {
      await runGithubCommand(rest);
    },
    webhook: async (rest: string[]) => {
      await runWebhookCommand(rest);
    },
    wiki: async (rest: string[]) => {
      const code = rest[0];
      if (!code) {
        throw new Error("Missing finding code. Usage: warden wiki <WD-Mx-yyy>");
      }

      await runWikiCommand(code);
    },
    work: async (rest: string[]) => {
      await runWorkCommand(rest);
    },
    mcp: async (rest: string[]) => {
      const transportArg = getFlagValue(rest, "--transport");
      const portArg = getFlagValue(rest, "--port");
      await runMcpCommand(transportArg, portArg);
    },
  };
}

async function main(): Promise<void> {
  const [, , command, ...rest] = process.argv;

  if (!command || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  const handlers = createCommandHandlers();
  const handler = handlers[command];
  if (!handler) {
    throw new Error(`Unknown command: ${command}`);
  }

  await handler(rest);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Error: ${message}\n`);
  process.exitCode = 1;
});
