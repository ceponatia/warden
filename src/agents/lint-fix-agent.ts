import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";

import type { RepoConfig } from "../types/snapshot.js";
import type { WorkDocument } from "../types/work.js";
import { addNote } from "../work/manager.js";
import { recordValidationResult } from "../work/trust.js";
import { callProvider } from "./provider.js";

const execFileAsync = promisify(execFile);

const MAX_REPAIR_ATTEMPTS = 3;

function buildLintFixPrompt(
  filePath: string,
  fileContent: string,
  finding: WorkDocument,
): string {
  return `You are Warden's lint-fix agent. Your job is to fix a specific lint/debt issue in a file.

## Finding
- **Code**: ${finding.code}
- **File**: ${filePath}
- **Summary**: ${finding.notes[0]?.text ?? "Lint issue detected"}

## Current File Content
\`\`\`typescript
${fileContent}
\`\`\`

## Instructions
- If the finding is WD-M6-003 (eslint-disable), remove unnecessary eslint-disable comments.
- Only make changes related to the lint finding. Do not refactor, do not add features.
- Return the complete corrected file content. Output ONLY the file content with no markdown fences or explanation.`;
}

function buildRepairPrompt(
  filePath: string,
  previousAttempt: string,
  errorOutput: string,
): string {
  return `Your previous fix attempt for ${filePath} failed validation.

## Previous Attempt
\`\`\`typescript
${previousAttempt}
\`\`\`

## Validation Errors
${errorOutput}

## Instructions
Fix the validation errors while keeping the original lint fix intent. Return the complete corrected file content. Output ONLY the file content with no markdown fences or explanation.`;
}

async function runValidation(
  repoPath: string,
): Promise<{ passed: boolean; error: string }> {
  try {
    await execFileAsync("pnpm", ["typecheck"], {
      cwd: repoPath,
      timeout: 60000,
    });
    await execFileAsync("pnpm", ["lint"], {
      cwd: repoPath,
      timeout: 60000,
    });
    return { passed: true, error: "" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { passed: false, error: message };
  }
}

async function createDraftBranch(
  repoPath: string,
  branchName: string,
): Promise<void> {
  await execFileAsync("git", ["checkout", "-b", branchName], {
    cwd: repoPath,
  });
}

async function commitAndReturn(
  repoPath: string,
  filePath: string,
  branchName: string,
  originalBranch: string,
): Promise<void> {
  await execFileAsync("git", ["add", filePath], { cwd: repoPath });
  await execFileAsync(
    "git",
    ["commit", "-m", `fix: warden lint-fix for ${path.basename(filePath)}`],
    { cwd: repoPath },
  );
  await execFileAsync("git", ["checkout", originalBranch], {
    cwd: repoPath,
  });
}

async function getCurrentBranch(repoPath: string): Promise<string> {
  const { stdout } = await execFileAsync("git", ["branch", "--show-current"], {
    cwd: repoPath,
  });
  return stdout.trim();
}

export async function runLintFixAgent(
  config: RepoConfig,
  doc: WorkDocument,
): Promise<boolean> {
  if (!doc.path) {
    addNote(doc, "lint-fix-agent", "No file path on finding. Skipped.");
    return false;
  }

  const absolutePath = path.resolve(config.path, doc.path);
  let fileContent: string;
  try {
    fileContent = await readFile(absolutePath, "utf8");
  } catch {
    addNote(doc, "lint-fix-agent", `Could not read file: ${doc.path}`);
    return false;
  }

  const originalBranch = await getCurrentBranch(config.path);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const branchName = `warden/lint-fix-${timestamp}`;

  let correctedContent = await callProvider({
    systemPrompt:
      "You are a precise lint-fix agent. Only fix the specific lint issue. Return file content only, no markdown fences.",
    userPrompt: buildLintFixPrompt(doc.path, fileContent, doc),
    maxTokens: 4096,
  });

  let passed = false;
  let lastError = "";
  let attempts = 0;

  for (attempts = 1; attempts <= MAX_REPAIR_ATTEMPTS; attempts++) {
    try {
      await createDraftBranch(config.path, branchName);
    } catch {
      // Branch may already exist from a previous attempt
    }

    const { writeFile: writeFileAsync } = await import("node:fs/promises");
    await writeFileAsync(absolutePath, correctedContent, "utf8");

    const result = await runValidation(config.path);
    if (result.passed) {
      passed = true;
      await commitAndReturn(
        config.path,
        absolutePath,
        branchName,
        originalBranch,
      );
      break;
    }

    lastError = result.error;

    // Restore the original file before retry
    await writeFileAsync(absolutePath, fileContent, "utf8");

    if (attempts < MAX_REPAIR_ATTEMPTS) {
      correctedContent = await callProvider({
        systemPrompt:
          "You are a precise lint-fix agent. Fix the validation errors. Return file content only.",
        userPrompt: buildRepairPrompt(doc.path, correctedContent, lastError),
        maxTokens: 4096,
      });
    }

    // Return to original branch for next attempt
    try {
      await execFileAsync("git", ["checkout", originalBranch], {
        cwd: config.path,
      });
      await execFileAsync("git", ["branch", "-D", branchName], {
        cwd: config.path,
      });
    } catch {
      // Best effort cleanup
    }
  }

  doc.validationResult = {
    passed,
    attempts,
    lastError: lastError || undefined,
  };

  if (passed) {
    doc.status = "agent-complete";
    doc.assignedTo = "lint-fix-agent";
    doc.relatedBranch = branchName;
    addNote(
      doc,
      "lint-fix-agent",
      `Fix applied on branch ${branchName}. Validation passed (attempt ${attempts}).`,
    );
  } else {
    doc.status = "blocked";
    addNote(
      doc,
      "lint-fix-agent",
      `Fix failed after ${MAX_REPAIR_ATTEMPTS} attempts. Last error: ${lastError.slice(0, 200)}`,
    );
  }

  await recordValidationResult(config.slug, "lint-fix-agent", passed);
  return passed;
}
