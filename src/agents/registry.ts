import { runLintFixAgent } from "./lint-fix-agent.js";
import { BaseAgent, type AgentContext, type AgentResult } from "./base-agent.js";
import { DocUpdateAgent } from "./doc-update-agent.js";
import { TestWritingAgent } from "./test-writing-agent.js";

class LegacyLintFixAgent extends BaseAgent {
  readonly name = "lint-fix-agent";
  readonly maxAttempts = 3;
  readonly targetCodes = ["WD-M6-001", "WD-M6-002", "WD-M6-003", "WD-M6-004"];

  protected commitMessage(): string {
    return "fix: apply lint fixes";
  }

  protected async generateFix(): Promise<void> {
    // Legacy implementation handles generation + validation internally.
  }

  protected async validate() {
    return { passed: true, output: "Handled by legacy lint-fix runner." };
  }

  protected async selfRepair(): Promise<void> {
    // Legacy implementation handles self-repair internally.
  }

  override async run(ctx: AgentContext): Promise<AgentResult> {
    const passed = await runLintFixAgent(ctx.config, ctx.finding);
    return {
      agentName: this.name,
      findingId: ctx.finding.findingId,
      findingCode: ctx.finding.code,
      status: passed ? "success" : "validation-failed",
      branch: ctx.finding.relatedBranch,
      attempts: ctx.finding.validationResult?.attempts ?? 0,
      output:
        ctx.finding.validationResult?.lastError ??
        (passed ? "Legacy lint-fix validation passed." : "Legacy lint-fix failed."),
    };
  }
}

const lintFixAgent = new LegacyLintFixAgent();
const testWritingAgent = new TestWritingAgent();
const docUpdateAgent = new DocUpdateAgent();

const CODE_PREFIX_REGISTRY: Array<[RegExp, BaseAgent]> = [
  [/^WD-M6-\d+$/, lintFixAgent],
  [/^WD-M7-\d+$/, testWritingAgent],
  [/^WD-M8-\d+$/, docUpdateAgent],
];

export function getAgentForCode(code: string): BaseAgent | null {
  for (const [pattern, agent] of CODE_PREFIX_REGISTRY) {
    if (pattern.test(code)) {
      return agent;
    }
  }
  return null;
}
