import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { runCommandSafe } from "../collectors/utils.js";
import { pushBranchAndCreatePullRequest } from "../github/pr.js";
import type { LoadedSnapshot } from "../snapshots.js";
import type { RepoConfig } from "../types/snapshot.js";
import type { WorkDocument } from "../types/work.js";
import { tryAutoMergeForWorkDocument } from "../work/autonomy.js";
import { addNote, saveWorkDocument } from "../work/manager.js";
import { recordValidationResult } from "../work/trust.js";

const execFileAsync = promisify(execFile);

export interface AgentContext {
  config: RepoConfig;
  finding: WorkDocument;
  snapshot: LoadedSnapshot;
  branchPrefix: string;
}

export interface AgentValidation {
  passed: boolean;
  output: string;
}

export interface AgentResult {
  agentName: string;
  findingId: string;
  findingCode: string;
  status: "success" | "validation-failed" | "error";
  branch?: string;
  prUrl?: string;
  attempts: number;
  output: string;
}

function sanitizePart(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

async function currentBranch(repoPath: string): Promise<string> {
  const { stdout } = await execFileAsync("git", ["branch", "--show-current"], {
    cwd: repoPath,
  });
  return stdout.trim();
}

export abstract class BaseAgent {
  abstract readonly name: string;
  abstract readonly maxAttempts: number;
  abstract readonly targetCodes: string[];

  protected abstract generateFix(ctx: AgentContext): Promise<void>;
  protected abstract validate(ctx: AgentContext): Promise<AgentValidation>;
  protected abstract selfRepair(
    ctx: AgentContext,
    validationOutput: string,
  ): Promise<void>;
  protected abstract commitMessage(ctx: AgentContext): string;

  protected buildBranchName(ctx: AgentContext): string {
    const findingPart = sanitizePart(ctx.finding.findingId);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    return `${ctx.branchPrefix}/${findingPart}-${stamp}`;
  }

  protected async commitIfNeeded(
    repoPath: string,
    message: string,
  ): Promise<boolean> {
    await execFileAsync("git", ["add", "-A"], { cwd: repoPath });
    const diff = await runCommandSafe(
      "git",
      ["diff", "--cached", "--name-only"],
      repoPath,
    );
    if (diff.exitCode !== 0 || diff.stdout.trim().length === 0) {
      return false;
    }
    await execFileAsync("git", ["commit", "-m", message], { cwd: repoPath });
    return true;
  }

  private async beginRun(ctx: AgentContext, branchName: string): Promise<void> {
    const finding = ctx.finding;
    finding.assignedTo = this.name;
    finding.status = "agent-in-progress";
    addNote(finding, this.name, `Starting agent run on ${branchName}.`);
    await saveWorkDocument(ctx.config.slug, finding);
  }

  private async runValidationLoop(ctx: AgentContext): Promise<{
    attempts: number;
    output: string;
    success: boolean;
  }> {
    let attempts = 0;
    let output = "Validation did not run";

    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      attempts = attempt;
      const validation = await this.validate(ctx);
      output = validation.output;
      if (validation.passed) {
        return { attempts, output, success: true };
      }
      if (attempt < this.maxAttempts) {
        await this.selfRepair(ctx, validation.output);
      }
    }

    return { attempts, output, success: false };
  }

  private async finalizeSuccess(params: {
    ctx: AgentContext;
    branchName: string;
    originalBranch: string;
    attempts: number;
    output: string;
  }): Promise<AgentResult> {
    const { ctx, branchName, originalBranch, attempts, output } = params;
    const finding = ctx.finding;

    const committed = await this.commitIfNeeded(
      ctx.config.path,
      this.commitMessage(ctx),
    );
    if (!committed) {
      finding.status = "blocked";
      addNote(finding, this.name, "No changes detected after generation.");
      return {
        agentName: this.name,
        findingId: finding.findingId,
        findingCode: finding.code,
        status: "error",
        attempts,
        output: "No changes to commit",
        branch: branchName,
      };
    }

    finding.status = "agent-complete";
    finding.relatedBranch = branchName;
    addNote(
      finding,
      this.name,
      `Changes committed on ${branchName}. Validation passed in ${attempts} attempt(s).`,
    );

    const autoMerge = await tryAutoMergeForWorkDocument({
      slug: ctx.config.slug,
      repoPath: ctx.config.path,
      doc: finding,
      agentName: this.name,
      sourceBranch: branchName,
      targetBranch: originalBranch,
    });

    let prUrl: string | undefined;
    if (!autoMerge.merged && ctx.config.source === "github") {
      const created = await pushBranchAndCreatePullRequest({
        config: ctx.config,
        doc: finding,
        sourceBranch: branchName,
        targetBranch: originalBranch,
      });
      if (created) {
        prUrl = created.prUrl;
        addNote(
          finding,
          this.name,
          `Draft PR created: ${created.prUrl} (#${created.number}).`,
        );
      }
    }

    return {
      agentName: this.name,
      findingId: finding.findingId,
      findingCode: finding.code,
      status: "success",
      attempts,
      output,
      branch: branchName,
      prUrl,
    };
  }

  async run(ctx: AgentContext): Promise<AgentResult> {
    const finding = ctx.finding;
    const originalBranch = await currentBranch(ctx.config.path);
    const branchName = this.buildBranchName(ctx);

    let attempts = 0;
    let output = "";
    let status: AgentResult["status"] = "error";
    await this.beginRun(ctx, branchName);

    try {
      await execFileAsync("git", ["checkout", "-b", branchName], {
        cwd: ctx.config.path,
      });

      await this.generateFix(ctx);

      const validation = await this.runValidationLoop(ctx);
      attempts = validation.attempts;
      output = validation.output;
      status = validation.success ? "success" : "validation-failed";

      finding.validationResult = {
        passed: validation.success,
        attempts,
        lastError: validation.success ? undefined : output.slice(0, 1000),
      };

      if (!validation.success) {
        finding.status = "blocked";
        addNote(
          finding,
          this.name,
          `Validation failed after ${attempts} attempts.`,
        );
        return {
          agentName: this.name,
          findingId: finding.findingId,
          findingCode: finding.code,
          status: "validation-failed",
          attempts,
          output,
          branch: branchName,
        };
      }

      return this.finalizeSuccess({
        ctx,
        branchName,
        originalBranch,
        attempts,
        output,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      finding.status = "blocked";
      addNote(finding, this.name, `Agent run failed: ${message}`);
      return {
        agentName: this.name,
        findingId: finding.findingId,
        findingCode: finding.code,
        status: "error",
        attempts,
        output: message,
        branch: branchName,
      };
    } finally {
      await recordValidationResult(
        ctx.config.slug,
        this.name,
        status === "success",
      );
      await saveWorkDocument(ctx.config.slug, finding);
      await execFileAsync("git", ["checkout", originalBranch], {
        cwd: ctx.config.path,
      }).catch(() => undefined);
    }
  }
}
