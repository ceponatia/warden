import { escapeHtml, renderPage } from "./render.js";
import { loadAutonomyConfig } from "../../work/autonomy.js";
import { loadImpactRecords } from "../../work/impact.js";
import { loadWorkDocuments } from "../../work/manager.js";
import { loadAllTrustMetrics } from "../../work/trust.js";

export async function renderAgentsView(slug: string): Promise<string> {
  const trust = await loadAllTrustMetrics(slug);
  const docs = await loadWorkDocuments(slug);
  const agentDocs = docs.filter((d) => Boolean(d.assignedTo));
  const autonomyConfig = await loadAutonomyConfig(slug);
  const impacts = await loadImpactRecords(slug);

  const trustRows = trust
    .map(
      (t) =>
        `<tr><td>${escapeHtml(t.agentName)}</td><td>${(t.validationPassRate * 100).toFixed(1)}%</td><td>${t.consecutiveCleanMerges}</td><td>${t.totalRuns}</td></tr>`,
    )
    .join("");

  const activityRows = agentDocs
    .map(
      (d) =>
        `<tr><td>${escapeHtml(d.assignedTo!)}</td><td>${escapeHtml(d.code)}</td><td>${escapeHtml(d.status)}</td><td>${escapeHtml(d.relatedBranch ?? "-")}</td><td>${d.validationResult?.passed ?? "-"}</td><td>${d.validationResult?.attempts ?? "-"}</td></tr>`,
    )
    .join("");

  const grantRows = autonomyConfig.rules
    .map(
      (rule) =>
        `<tr><td>${escapeHtml(rule.agentName)}</td><td>${rule.enabled ? "yes" : "no"}</td><td>${escapeHtml(rule.allowedCodes?.join(", ") ?? "all")}</td><td>${escapeHtml(rule.maxSeverity ?? autonomyConfig.globalDefaults.maxSeverity)}</td><td>${escapeHtml(rule.grantedAt.slice(0, 10))}</td><td>${escapeHtml(rule.revocationReason ?? "-")}</td></tr>`,
    )
    .join("");

  const impactRows = impacts
    .slice(0, 20)
    .map(
      (record) =>
        `<tr><td>${escapeHtml(record.agentName)}</td><td>${escapeHtml(record.findingCode)}</td><td>${escapeHtml(record.branch)}</td><td>${escapeHtml(record.mergedAt.slice(0, 10))}</td><td>${escapeHtml(record.impact.newFindingsIntroduced.join(", ") || "none")}</td><td>${record.impact.revertDetected ? "yes" : "no"}</td><td>${record.impact.subsequentChurn}</td></tr>`,
    )
    .join("");

  return renderPage(
    `Agent Activity: ${slug}`,
    `<div class="card"><h2>Trust Scores</h2><div class="table-wrap"><table><thead><tr><th>Agent</th><th>Pass Rate</th><th>Clean Merges</th><th>Total Runs</th></tr></thead><tbody>${trustRows}</tbody></table></div></div>
    <div class="card"><h2>Activity</h2><div class="table-wrap"><table><thead><tr><th>Agent</th><th>Finding</th><th>Status</th><th>Branch</th><th>Validation</th><th>Attempts</th></tr></thead><tbody>${activityRows}</tbody></table></div></div>
    <div class="card"><h2>Autonomy Grants</h2><div class="table-wrap"><table><thead><tr><th>Agent</th><th>Enabled</th><th>Allowed Codes</th><th>Max Severity</th><th>Granted</th><th>Revocation</th></tr></thead><tbody>${grantRows}</tbody></table></div></div>
    <div class="card"><h2>Auto-Merge Impact</h2><div class="table-wrap"><table><thead><tr><th>Agent</th><th>Code</th><th>Branch</th><th>Merged</th><th>New Findings</th><th>Reverted</th><th>Churn</th></tr></thead><tbody>${impactRows}</tbody></table></div></div>`,
    { slug },
  );
}
