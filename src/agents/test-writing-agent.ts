import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { runCommandSafe } from "../collectors/utils.js";
import { callProvider } from "./provider.js";
import {
  BaseAgent,
  type AgentContext,
  type AgentValidation,
} from "./base-agent.js";

interface TestTargetState {
  sourcePath: string;
  sourceContent: string;
  testPath: string;
  baselineCoverage?: number;
  framework: "vitest" | "jest" | "unknown";
}

function inferFramework(
  packageJsonText: string,
): "vitest" | "jest" | "unknown" {
  const lower = packageJsonText.toLowerCase();
  if (lower.includes("vitest")) return "vitest";
  if (lower.includes("jest")) return "jest";
  return "unknown";
}

function toTestPath(sourcePath: string): string {
  const ext = path.extname(sourcePath);
  const base = sourcePath.slice(0, -ext.length);
  return `${base}.test${ext || ".ts"}`;
}

function parseScripts(packageJsonText: string): Record<string, string> {
  try {
    const parsed = JSON.parse(packageJsonText) as {
      scripts?: Record<string, string>;
    };
    return parsed.scripts ?? {};
  } catch {
    return {};
  }
}

function selectTestCommand(
  scripts: Record<string, string>,
  framework: "vitest" | "jest" | "unknown",
): string[] {
  if (scripts["test:unit"]) return ["test:unit"];
  if (scripts.test) return ["test", "--", "--run"];
  if (framework === "vitest") return ["vitest", "run"];
  if (framework === "jest") return ["jest"];
  return ["test"];
}

export class TestWritingAgent extends BaseAgent {
  readonly name = "test-writing-agent";
  readonly maxAttempts = 3;
  readonly targetCodes = ["WD-M7-001", "WD-M7-002", "WD-M7-003"];

  private readonly states = new Map<string, TestTargetState>();

  protected commitMessage(ctx: AgentContext): string {
    return `test: add coverage for ${ctx.finding.path ?? ctx.finding.findingId}`;
  }

  protected async generateFix(ctx: AgentContext): Promise<void> {
    if (!ctx.finding.path) {
      throw new Error("Test-writing agent requires finding.path");
    }

    const sourcePath = path.resolve(ctx.config.path, ctx.finding.path);
    const sourceContent = await readFile(sourcePath, "utf8");
    const packageJsonPath = path.resolve(ctx.config.path, "package.json");
    const packageJsonText = await readFile(packageJsonPath, "utf8").catch(
      () => "{}",
    );
    const framework = inferFramework(packageJsonText);
    const testPath = path.resolve(
      ctx.config.path,
      toTestPath(ctx.finding.path),
    );
    const baselineCoverage = ctx.snapshot.coverage?.files.find(
      (entry) => entry.path === ctx.finding.path,
    )?.lineCoverage;

    const generated = await callProvider({
      systemPrompt:
        "You are Warden's test-writing agent. Generate practical tests matching the existing project style. Return test file contents only.",
      userPrompt: [
        `Finding code: ${ctx.finding.code}`,
        `Source path: ${ctx.finding.path}`,
        `Framework: ${framework}`,
        "Write tests that focus on exported behavior and avoid brittle implementation details.",
        "Return the full test file content with no markdown fences.",
        "",
        "Source file:",
        sourceContent,
      ].join("\n"),
      maxTokens: 4096,
    });

    await mkdir(path.dirname(testPath), { recursive: true });
    await writeFile(testPath, `${generated.trim()}\n`, "utf8");
    this.states.set(ctx.finding.findingId, {
      sourcePath,
      sourceContent,
      testPath,
      baselineCoverage,
      framework,
    });
  }

  protected async validate(ctx: AgentContext): Promise<AgentValidation> {
    const state = this.states.get(ctx.finding.findingId);
    if (!state) {
      return { passed: false, output: "Missing generated test context" };
    }

    const packageJsonText = await readFile(
      path.resolve(ctx.config.path, "package.json"),
      "utf8",
    ).catch(() => "{}");
    const scripts = parseScripts(packageJsonText);
    const testCommand = selectTestCommand(scripts, state.framework);

    const test = await runCommandSafe("pnpm", testCommand, ctx.config.path);
    if (test.exitCode !== 0) {
      return {
        passed: false,
        output: `Tests failed\n${test.stdout}\n${test.stderr}`.trim(),
      };
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

    if (typeof state.baselineCoverage === "number") {
      const current = ctx.snapshot.coverage?.files.find(
        (entry) => entry.path === ctx.finding.path,
      )?.lineCoverage;
      if (typeof current === "number" && current < state.baselineCoverage) {
        return {
          passed: false,
          output: `Coverage did not improve (${current}% < baseline ${state.baselineCoverage}%).`,
        };
      }
    }

    return { passed: true, output: "Test and typecheck validation passed." };
  }

  protected async selfRepair(
    ctx: AgentContext,
    validationOutput: string,
  ): Promise<void> {
    const state = this.states.get(ctx.finding.findingId);
    if (!state) {
      throw new Error("Missing generated test context for repair");
    }

    const currentTest = await readFile(state.testPath, "utf8");
    const repaired = await callProvider({
      systemPrompt:
        "You are Warden's test repair assistant. Fix failing tests while preserving intent. Return file content only.",
      userPrompt: [
        `Source path: ${ctx.finding.path ?? "unknown"}`,
        "Validation output:",
        validationOutput,
        "Current test content:",
        currentTest,
        "Source content:",
        state.sourceContent,
      ].join("\n\n"),
      maxTokens: 4096,
    });

    await writeFile(state.testPath, `${repaired.trim()}\n`, "utf8");
  }
}
