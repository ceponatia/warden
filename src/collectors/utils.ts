import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export async function runCommand(
  command: string,
  args: string[],
  cwd: string,
): Promise<string> {
  const { stdout } = await execFileAsync(command, args, {
    cwd,
    maxBuffer: 20 * 1024 * 1024,
  });
  return stdout;
}

export async function runCommandSafe(
  command: string,
  args: string[],
  cwd: string,
): Promise<CommandResult> {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      cwd,
      maxBuffer: 20 * 1024 * 1024,
    });
    return {
      stdout,
      stderr,
      exitCode: 0,
    };
  } catch (error) {
    const execError = error as {
      stdout?: string;
      stderr?: string;
      code?: number;
    };
    return {
      stdout: execError.stdout ?? "",
      stderr: execError.stderr ?? "",
      exitCode:
        typeof execError.code === "number" ? execError.code : Number.NaN,
    };
  }
}

export function normalizePath(filePath: string): string {
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

export function shouldIgnore(
  relativePath: string,
  ignorePatterns: string[],
): boolean {
  const normalized = normalizePath(relativePath);

  return ignorePatterns.some((pattern) => {
    const trimmed = pattern.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      return false;
    }

    const normalizedPattern = normalizePath(
      trimmed.replace(/^\.\//, "").replace(/^\//, "").replace(/\/$/, ""),
    );
    if (normalizedPattern.includes("*")) {
      return patternToRegex(normalizedPattern).test(normalized);
    }

    if (!normalizedPattern.includes("/")) {
      return (
        normalized === normalizedPattern ||
        normalized.startsWith(`${normalizedPattern}/`) ||
        normalized.includes(`/${normalizedPattern}/`) ||
        normalized.endsWith(`/${normalizedPattern}`)
      );
    }

    return (
      normalized === normalizedPattern ||
      normalized.startsWith(`${normalizedPattern}/`)
    );
  });
}

export async function collectFiles(
  rootPath: string,
  sourceRoots: string[],
  ignorePatterns: string[],
): Promise<string[]> {
  const files: string[] = [];

  for (const sourceRoot of sourceRoots) {
    const absoluteRoot = path.resolve(rootPath, sourceRoot);
    let rootStats: Awaited<ReturnType<typeof stat>>;
    try {
      rootStats = await stat(absoluteRoot);
    } catch {
      continue;
    }

    if (!rootStats.isDirectory()) {
      continue;
    }

    const stack: string[] = [absoluteRoot];
    while (stack.length > 0) {
      const currentDir = stack.pop();
      if (!currentDir) {
        continue;
      }

      const entries = await readdir(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        const absoluteEntryPath = path.join(currentDir, entry.name);
        const relativeEntryPath = normalizePath(
          path.relative(rootPath, absoluteEntryPath),
        );

        if (shouldIgnore(relativeEntryPath, ignorePatterns)) {
          continue;
        }

        if (entry.isDirectory()) {
          stack.push(absoluteEntryPath);
          continue;
        }

        if (!entry.isFile()) {
          continue;
        }

        files.push(relativeEntryPath);
      }
    }
  }

  return files;
}

export async function readGitIgnore(repoPath: string): Promise<string[]> {
  try {
    const gitignorePath = path.resolve(repoPath, ".gitignore");
    const content = await readFile(gitignorePath, "utf8");
    return content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#"));
  } catch {
    return [];
  }
}

export function daysBetween(isoDate: string, now: Date): number {
  const parsed = Date.parse(isoDate);
  if (Number.isNaN(parsed)) {
    return Number.MAX_SAFE_INTEGER;
  }

  return Math.floor((now.getTime() - parsed) / (1000 * 60 * 60 * 24));
}
