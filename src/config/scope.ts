import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import type {
  FileScope,
  MetricTag,
  RepoConfig,
  ScopeRule,
} from "../types/snapshot.js";

export const METRIC_TAGS: MetricTag[] = [
  "size",
  "staleness",
  "growth",
  "churn",
  "imports",
  "debt",
  "complexity",
  "runtime",
  "coverage",
  "doc-staleness",
];

const ALL_METRICS_SET = new Set<MetricTag>(METRIC_TAGS);

function normalizePathForScope(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

function patternToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "::DOUBLE_STAR::")
    .replace(/\*/g, "[^/]*")
    .replace(/::DOUBLE_STAR::/g, ".*");
  return new RegExp(`^${escaped}$`);
}

function normalizePattern(pattern: string): string {
  return normalizePathForScope(
    pattern.trim().replace(/^\.\//, "").replace(/^\//, ""),
  );
}

function patternSpecificity(pattern: string): number {
  return pattern.replace(/[*?]/g, "").length;
}

function parseMetricHeader(line: string): MetricTag[] | null {
  const match = line.match(/^\[metrics:\s*([^\]]+)\]$/i);
  if (!match) {
    return null;
  }

  const rawTags = match[1];
  if (!rawTags) {
    return null;
  }

  const tags = rawTags
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item.length > 0);

  const parsed: MetricTag[] = [];
  for (const tag of tags) {
    if (ALL_METRICS_SET.has(tag as MetricTag)) {
      parsed.push(tag as MetricTag);
    }
  }

  return parsed.length > 0 ? parsed : null;
}

export function parseScopeFile(content: string): ScopeRule[] {
  const rules: ScopeRule[] = [];
  let activeMetrics: MetricTag[] | null = null;

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const metricHeader = parseMetricHeader(line);
    if (metricHeader) {
      activeMetrics = metricHeader;
      continue;
    }

    const pattern = normalizePattern(line);
    if (!pattern) {
      continue;
    }

    if (activeMetrics) {
      rules.push({
        pattern,
        action: "scoped",
        metrics: [...activeMetrics],
      });
      continue;
    }

    rules.push({
      pattern,
      action: "ignore",
    });
  }

  return rules;
}

function matchesRule(filePath: string, rule: ScopeRule): boolean {
  const normalizedPath = normalizePathForScope(filePath);
  const normalizedRule = normalizePattern(rule.pattern);
  const isBasenamePattern = !normalizedRule.includes("/");

  if (normalizedRule.includes("*")) {
    const regex = patternToRegex(normalizedRule);
    if (isBasenamePattern) {
      return regex.test(path.posix.basename(normalizedPath));
    }

    return regex.test(normalizedPath);
  }

  if (isBasenamePattern) {
    return path.posix.basename(normalizedPath) === normalizedRule;
  }

  return (
    normalizedPath === normalizedRule ||
    normalizedPath.startsWith(`${normalizedRule}/`) ||
    normalizedPath.endsWith(`/${normalizedRule}`)
  );
}

export function resolveFileScope(
  filePath: string,
  rules: ScopeRule[],
): FileScope {
  const matches = rules.filter((rule) => matchesRule(filePath, rule));
  if (matches.length === 0) {
    return {
      ignored: false,
      metrics: [...METRIC_TAGS],
    };
  }

  const best = matches.sort(
    (left, right) =>
      patternSpecificity(right.pattern) - patternSpecificity(left.pattern),
  )[0];

  if (!best || best.action === "ignore") {
    return {
      ignored: true,
      metrics: [],
    };
  }

  return {
    ignored: false,
    metrics: [...(best.metrics ?? [])],
  };
}

function defaultScopeContent(extraIgnores: string[]): string {
  const ignores = [
    ".next/**",
    "node_modules/**",
    "dist/**",
    "build/**",
    "out/**",
    "coverage/**",
    "*.tsbuildinfo",
    "pnpm-lock.yaml",
    "yarn.lock",
    "package-lock.json",
    ...extraIgnores,
  ];

  const uniqueIgnores = [
    ...new Set(ignores.map((item) => item.trim()).filter(Boolean)),
  ].sort();
  const filteredIgnores = uniqueIgnores.filter((item) => !item.startsWith("!"));

  return `# Fully ignored -- no metrics at all
${filteredIgnores.join("\n")}

# Doc files -- size and staleness only (no import checks)
[metrics: size, staleness]
AGENTS.md
README.md
*.md

# Config files -- staleness only
[metrics: staleness]
tsconfig.json
tsconfig.*.json
eslint.config.*
package.json
components.json
next.config.*
postcss.config.*
next-env.d.ts

# Coverage analysis targets
[metrics: coverage]
src/**
apps/**
packages/**

# Documentation freshness targets
[metrics: doc-staleness]
AGENTS.md
README.md
docs/**
**/*.md
`;
}

export async function generateDefaultScopeFile(
  scopeFilePath: string,
  gitIgnorePatterns: string[],
): Promise<void> {
  const scopeContent = defaultScopeContent(gitIgnorePatterns);
  await mkdir(path.dirname(scopeFilePath), { recursive: true });
  await writeFile(scopeFilePath, scopeContent, "utf8");
}

async function pathExists(absolutePath: string): Promise<boolean> {
  try {
    await stat(absolutePath);
    return true;
  } catch {
    return false;
  }
}

export async function loadScopeRules(config: RepoConfig): Promise<ScopeRule[]> {
  const repoScopedPath = path.resolve(config.path, ".warden", "scope");
  const defaultScopePath = path.resolve(
    process.cwd(),
    config.scopeFile ?? `config/${config.slug}.scope`,
  );

  const preferredPath = (await pathExists(repoScopedPath))
    ? repoScopedPath
    : defaultScopePath;
  try {
    const content = await readFile(preferredPath, "utf8");
    return parseScopeFile(content);
  } catch {
    return [];
  }
}

export function getDefaultScopeFilePath(slug: string): string {
  return path.resolve(process.cwd(), "config", `${slug}.scope`);
}
