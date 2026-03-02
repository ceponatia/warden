import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { runCommandSafe } from "../collectors/utils.js";
import { callProvider } from "./provider.js";
import {
  BaseAgent,
  type AgentContext,
  type AgentValidation,
} from "./base-agent.js";

interface DocTargetState {
  docPath: string;
  sourcePath?: string;
  symbol?: string;
  originalContent: string;
}

function hasBalancedCodeFences(markdown: string): boolean {
  const matches = markdown.match(/```/g);
  const count = matches?.length ?? 0;
  return count % 2 === 0;
}

function extractMarkdownLinks(markdown: string): string[] {
  const links: string[] = [];
  const re = /\[[^\]]+\]\(([^)]+)\)/g;
  let match = re.exec(markdown);
  while (match) {
    const target = match[1]?.trim();
    if (target && !target.startsWith("http") && !target.startsWith("#")) {
      links.push(target);
    }
    match = re.exec(markdown);
  }
  return links;
}

async function findDocPath(ctx: AgentContext): Promise<string> {
  if (!ctx.finding.path) {
    throw new Error("Doc-update agent requires finding.path");
  }

  const sourcePath = path.resolve(ctx.config.path, ctx.finding.path);
  if (ctx.finding.code !== "WD-M8-003") {
    return sourcePath;
  }

  const nearReadme = path.resolve(path.dirname(sourcePath), "README.md");
  const maybeReadme = await readFile(nearReadme, "utf8").catch(() => null);
  if (maybeReadme !== null) {
    return nearReadme;
  }

  return sourcePath;
}

export class DocUpdateAgent extends BaseAgent {
  readonly name = "doc-update-agent";
  readonly maxAttempts = 2;
  readonly targetCodes = ["WD-M8-001", "WD-M8-002", "WD-M8-003"];

  private readonly states = new Map<string, DocTargetState>();

  protected commitMessage(ctx: AgentContext): string {
    return `docs: update ${ctx.finding.path ?? ctx.finding.findingId}`;
  }

  protected async generateFix(ctx: AgentContext): Promise<void> {
    const docPath = await findDocPath(ctx);
    const originalContent = await readFile(docPath, "utf8");
    const sourcePath = ctx.finding.path
      ? path.resolve(ctx.config.path, ctx.finding.path)
      : undefined;

    const gitSummary = await runCommandSafe(
      "git",
      ["log", "--oneline", "-n", "10", "--", ctx.finding.path ?? ""],
      ctx.config.path,
    );

    const sourceContent = sourcePath
      ? await readFile(sourcePath, "utf8").catch(() => "")
      : "";

    const updated = await callProvider({
      systemPrompt:
        "You are Warden's doc-update agent. Update documentation to be accurate, concise, and style-consistent. Return markdown only.",
      userPrompt: [
        `Finding code: ${ctx.finding.code}`,
        `Summary: ${ctx.finding.notes.at(-1)?.text ?? ctx.finding.code}`,
        `Target doc path: ${path.relative(ctx.config.path, docPath)}`,
        `Related symbol: ${ctx.finding.symbol ?? "n/a"}`,
        "Recent git log for related file:",
        `${gitSummary.stdout}\n${gitSummary.stderr}`.trim(),
        "Current documentation:",
        originalContent,
        "Related source content:",
        sourceContent,
        "Task: update the documentation to resolve the finding while preserving useful context.",
      ].join("\n\n"),
      maxTokens: 4096,
    });

    await writeFile(docPath, `${updated.trim()}\n`, "utf8");
    this.states.set(ctx.finding.findingId, {
      docPath,
      sourcePath,
      symbol: ctx.finding.symbol,
      originalContent,
    });
  }

  protected async validate(ctx: AgentContext): Promise<AgentValidation> {
    const state = this.states.get(ctx.finding.findingId);
    if (!state) {
      return { passed: false, output: "Missing generated doc context" };
    }

    const current = await readFile(state.docPath, "utf8");
    if (!hasBalancedCodeFences(current)) {
      return { passed: false, output: "Markdown code fences are unbalanced." };
    }

    if (
      current.trim().length <
      Math.floor(state.originalContent.trim().length / 2)
    ) {
      return {
        passed: false,
        output:
          "Updated doc shrank by more than 50%; refusing destructive update.",
      };
    }

    const links = extractMarkdownLinks(current);
    for (const link of links) {
      const absolute = path.resolve(path.dirname(state.docPath), link);
      const exists = await readFile(absolute, "utf8")
        .then(() => true)
        .catch(() => false);
      if (!exists) {
        return {
          passed: false,
          output: `Reference check failed: ${link} does not exist relative to document.`,
        };
      }
    }

    const typecheck = await runCommandSafe(
      "pnpm",
      ["typecheck"],
      ctx.config.path,
    );
    if (typecheck.exitCode !== 0) {
      return {
        passed: false,
        output:
          `Typecheck failed\n${typecheck.stdout}\n${typecheck.stderr}`.trim(),
      };
    }

    return { passed: true, output: "Documentation validation passed." };
  }

  protected async selfRepair(
    ctx: AgentContext,
    validationOutput: string,
  ): Promise<void> {
    const state = this.states.get(ctx.finding.findingId);
    if (!state) {
      throw new Error("Missing generated doc context for repair");
    }

    const current = await readFile(state.docPath, "utf8");
    const repaired = await callProvider({
      systemPrompt:
        "You are Warden's doc repair assistant. Repair markdown/doc issues without deleting substantial context. Return markdown only.",
      userPrompt: [
        "Validation failure:",
        validationOutput,
        "Original document:",
        state.originalContent,
        "Current document:",
        current,
      ].join("\n\n"),
      maxTokens: 4096,
    });

    await writeFile(state.docPath, `${repaired.trim()}\n`, "utf8");
  }
}
