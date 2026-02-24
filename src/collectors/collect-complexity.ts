import path from "node:path";

import { resolveFileScope } from "../config/scope.js";
import type {
  ComplexityFinding,
  ComplexitySnapshot,
  RepoConfig,
  ScopeRule,
} from "../types/snapshot.js";
import { runCommand, runCommandSafe } from "./utils.js";

interface EslintMessage {
  ruleId: string | null;
  severity: number;
  message: string;
  line?: number;
}

interface EslintResult {
  filePath: string;
  messages: EslintMessage[];
}

function getSeverity(value: number): "warning" | "error" {
  return value >= 2 ? "error" : "warning";
}

function parseEslintJson(stdout: string): EslintResult[] {
  if (!stdout.trim()) {
    return [];
  }

  try {
    const parsed = JSON.parse(stdout) as unknown;
    return Array.isArray(parsed) ? (parsed as EslintResult[]) : [];
  } catch {
    return [];
  }
}

export async function collectComplexity(
  config: RepoConfig,
  scopeRules: ScopeRule[],
): Promise<ComplexitySnapshot> {
  const branch = (
    await runCommand("git", ["rev-parse", "--abbrev-ref", "HEAD"], config.path)
  ).trim();
  const args = ["exec", "eslint", "-f", "json", ...config.sourceRoots];
  const commandResult = await runCommandSafe("pnpm", args, config.path);

  const parsed = parseEslintJson(commandResult.stdout);
  const findings: ComplexityFinding[] = [];

  for (const result of parsed) {
    const relativePath = result.filePath.startsWith(config.path)
      ? path.relative(config.path, result.filePath)
      : result.filePath;
    const normalizedPath = relativePath.split(path.sep).join("/");
    const scope = resolveFileScope(normalizedPath, scopeRules);
    if (scope.ignored || !scope.metrics.includes("complexity")) {
      continue;
    }

    for (const message of result.messages) {
      if (
        message.ruleId !== "complexity" &&
        message.ruleId !== "max-lines-per-function"
      ) {
        continue;
      }

      findings.push({
        path: normalizedPath,
        ruleId: message.ruleId ?? "unknown",
        message: message.message,
        line: message.line ?? 1,
        severity: getSeverity(message.severity),
      });
    }
  }

  const complexityWarnings = findings.filter(
    (entry) => entry.ruleId === "complexity",
  ).length;
  const maxLinesWarnings = findings.filter(
    (entry) => entry.ruleId === "max-lines-per-function",
  ).length;

  return {
    collectedAt: new Date().toISOString(),
    branch,
    summary: {
      totalFindings: findings.length,
      complexityWarnings,
      maxLinesWarnings,
    },
    findings: findings.sort((left, right) =>
      left.path.localeCompare(right.path),
    ),
  };
}
