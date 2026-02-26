import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { lookupCode } from "../findings/registry.js";
import type { WorkDocument } from "../types/work.js";
import { addNote } from "../work/manager.js";
import { callProvider } from "./provider.js";

function buildPlanningPrompt(doc: WorkDocument, wikiContent: string): string {
  const historyLines = doc.notes
    .slice(-5)
    .map((n) => `- [${n.timestamp}] ${n.author}: ${n.text}`)
    .join("\n");

  return `You are Warden's planning agent. Your task is to analyze a persistent finding and produce a concrete remediation plan.

## Finding Details
- **Code**: ${doc.code}
- **Finding ID**: ${doc.findingId}
- **Severity**: ${doc.severity}
- **File**: ${doc.path ?? "N/A"}
- **Symbol**: ${doc.symbol ?? "N/A"}
- **First seen**: ${doc.firstSeen}
- **Consecutive reports**: ${doc.consecutiveReports}
- **Trend**: ${doc.trend}

## Recent History
${historyLines}

## Wiki Reference
${wikiContent}

## Instructions
Produce a plan document with:
1. **Problem statement** — what the finding means and why it persists.
2. **Root cause analysis** — likely causes based on the file/symbol context.
3. **Resolution options** — 1–3 options ranked by effort and impact.
4. **Risk factors** — dependencies or side effects to watch.

Reference actual file paths and function names from the finding. Keep the plan under 400 words. Output markdown only.`;
}

export async function runPlanningAgent(
  slug: string,
  doc: WorkDocument,
): Promise<string> {
  const definition = lookupCode(doc.code);
  let wikiContent = "No wiki page available.";

  if (definition) {
    try {
      const wikiPath = path.resolve(process.cwd(), definition.wikiPath);
      wikiContent = await readFile(wikiPath, "utf8");
    } catch {
      // Wiki page may not exist yet
    }
  }

  const prompt = buildPlanningPrompt(doc, wikiContent);
  const plan = await callProvider({
    systemPrompt:
      "You are a precise engineering planner. Produce actionable remediation plans. Be specific to the codebase. Output markdown only.",
    userPrompt: prompt,
    maxTokens: 1024,
  });

  const plansDir = path.resolve(process.cwd(), "data", slug, "plans");
  await mkdir(plansDir, { recursive: true });

  const planPath = path.join(plansDir, `${doc.findingId}.md`);
  await writeFile(planPath, `${plan.trim()}\n`, "utf8");

  doc.status = "agent-complete";
  doc.assignedTo = "planning-agent";
  doc.planDocument = `data/${slug}/plans/${doc.findingId}.md`;
  addNote(doc, "planning-agent", `Plan generated at ${doc.planDocument}.`);

  return planPath;
}
