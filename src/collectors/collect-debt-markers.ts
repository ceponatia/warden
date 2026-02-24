import path from "node:path";
import { readFile } from "node:fs/promises";

import { resolveFileScope } from "../config/scope.js";
import type {
  DebtFileEntry,
  DebtMarkersSnapshot,
  MarkerEntry,
  RepoConfig,
  ScopeRule,
} from "../types/snapshot.js";
import { collectFiles, runCommand } from "./utils.js";

interface MarkerPatterns {
  todo: RegExp;
  fixme: RegExp;
  hack: RegExp;
  eslintDisable: RegExp;
}

const PATTERNS: MarkerPatterns = {
  todo: /\bTODO\b/i,
  fixme: /\bFIXME\b/i,
  hack: /\b(?:HACK|XXX)\b/i,
  eslintDisable: /eslint-disable/i,
};

function pushMarker(list: MarkerEntry[], line: number, text: string): void {
  list.push({
    line,
    text: text.trim(),
  });
}

interface DebtScanResult {
  todos: MarkerEntry[];
  fixmes: MarkerEntry[];
  hacks: MarkerEntry[];
  eslintDisables: MarkerEntry[];
  anyCasts: number;
}

function scanDebtMarkers(content: string): DebtScanResult {
  const lines = content.split(/\r?\n/);
  const todos: MarkerEntry[] = [];
  const fixmes: MarkerEntry[] = [];
  const hacks: MarkerEntry[] = [];
  const eslintDisables: MarkerEntry[] = [];
  let anyCasts = 0;

  lines.forEach((lineText, index) => {
    const lineNumber = index + 1;

    if (PATTERNS.todo.test(lineText)) {
      pushMarker(todos, lineNumber, lineText);
    }
    if (PATTERNS.fixme.test(lineText)) {
      pushMarker(fixmes, lineNumber, lineText);
    }
    if (PATTERNS.hack.test(lineText)) {
      pushMarker(hacks, lineNumber, lineText);
    }
    if (PATTERNS.eslintDisable.test(lineText)) {
      pushMarker(eslintDisables, lineNumber, lineText);
    }

    const anyMatches = lineText.match(/:\s*any\b/g);
    if (anyMatches) {
      anyCasts += anyMatches.length;
    }
  });

  return {
    todos,
    fixmes,
    hacks,
    eslintDisables,
    anyCasts,
  };
}

function debtEntryCount(entry: DebtFileEntry): number {
  return (
    entry.todos.length +
    entry.fixmes.length +
    entry.hacks.length +
    entry.eslintDisables.length +
    entry.anyCasts
  );
}

export async function collectDebtMarkers(
  config: RepoConfig,
  scopeRules: ScopeRule[],
): Promise<DebtMarkersSnapshot> {
  const branch = (
    await runCommand("git", ["rev-parse", "--abbrev-ref", "HEAD"], config.path)
  ).trim();
  const files = await collectFiles(
    config.path,
    config.sourceRoots,
    config.ignorePatterns,
  );

  const debtFiles: DebtFileEntry[] = [];
  let totalTodos = 0;
  let totalFixmes = 0;
  let totalHacks = 0;
  let totalEslintDisables = 0;
  let totalAnyCasts = 0;

  for (const relativeFile of files) {
    const scope = resolveFileScope(relativeFile, scopeRules);
    if (scope.ignored || !scope.metrics.includes("debt")) {
      continue;
    }

    const absoluteFile = path.resolve(config.path, relativeFile);
    const content = await readFile(absoluteFile, "utf8");
    const { todos, fixmes, hacks, eslintDisables, anyCasts } =
      scanDebtMarkers(content);

    if (
      todos.length === 0 &&
      fixmes.length === 0 &&
      hacks.length === 0 &&
      eslintDisables.length === 0 &&
      anyCasts === 0
    ) {
      continue;
    }

    totalTodos += todos.length;
    totalFixmes += fixmes.length;
    totalHacks += hacks.length;
    totalEslintDisables += eslintDisables.length;
    totalAnyCasts += anyCasts;

    debtFiles.push({
      path: relativeFile,
      todos,
      fixmes,
      hacks,
      eslintDisables,
      anyCasts,
    });
  }

  debtFiles.sort((left, right) => {
    return debtEntryCount(right) - debtEntryCount(left);
  });

  return {
    collectedAt: new Date().toISOString(),
    branch,
    summary: {
      totalTodos,
      totalFixmes,
      totalHacks,
      totalEslintDisables,
      totalAnyCasts,
    },
    files: debtFiles,
  };
}
