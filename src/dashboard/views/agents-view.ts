import { escapeHtml, renderPage } from "./render.js";
import { loadAutonomyConfig } from "../../work/autonomy.js";
import { loadImpactRecords } from "../../work/impact.js";
import { loadWorkDocuments } from "../../work/manager.js";
import { loadAllTrustMetrics } from "../../work/trust.js";
import { readNotificationLog } from "../../notifications/history.js";

export async function renderAgentsView(
  slug: string,
  agentFilter?: string,
): Promise<string> {
  const trust = await loadAllTrustMetrics(slug);
  const docs = await loadWorkDocuments(slug);
  const agentDocs = docs.filter((d) => Boolean(d.assignedTo));
  const normalizedFilter = (agentFilter ?? "").trim();
  const filteredDocs =
    normalizedFilter.length === 0
      ? agentDocs
      : agentDocs.filter((d) => d.assignedTo === normalizedFilter);
  const autonomyConfig = await loadAutonomyConfig(slug);
  const impacts = await loadImpactRecords(slug);
  const notificationLog = await readNotificationLog(slug, 20);

  const trustRows = trust
    .map(
      (t) =>
        `<tr><td>${escapeHtml(t.agentName)}</td><td>${(t.validationPassRate * 100).toFixed(1)}%</td><td>${t.consecutiveCleanMerges}</td><td>${t.totalRuns}</td></tr>`,
    )
    .join("");

  const activityRows = filteredDocs
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

  const notificationRows = notificationLog
    .map(
      (entry) =>
        `<tr><td>${escapeHtml(entry.timestamp.slice(0, 19))}</td><td>${escapeHtml(entry.eventType)}</td><td>${escapeHtml(entry.channelType)}</td><td>${entry.success ? "ok" : "failed"}${entry.skipped ? ` (skipped: ${escapeHtml(entry.reason ?? "n/a")})` : ""}</td><td>${escapeHtml(entry.reason ?? "-")}</td></tr>`,
    )
    .join("");

  const filterOptions = [
    ...new Set(agentDocs.map((doc) => doc.assignedTo).filter(Boolean)),
  ].sort();
  const optionRows = [
    `<option value=""${normalizedFilter.length === 0 ? " selected" : ""}>all agents</option>`,
    ...filterOptions.map(
      (name) =>
        `<option value="${escapeHtml(name!)}"${normalizedFilter === name ? " selected" : ""}>${escapeHtml(name!)}</option>`,
    ),
  ].join("");

  return renderPage(
    `Agent Activity: ${slug}`,
    `<div class="card"><h2>Agent Filter</h2><form method="get" action="/repo/${encodeURIComponent(slug)}/agents"><label for="agent-filter">Agent</label> <select id="agent-filter" name="agent">${optionRows}</select> <button type="submit">Apply</button></form></div>
    <div class="card"><h2>Trust Scores</h2><div class="table-wrap"><table><thead><tr><th>Agent</th><th>Pass Rate</th><th>Clean Merges</th><th>Total Runs</th></tr></thead><tbody>${trustRows}</tbody></table></div></div>
    <div class="card"><h2>Activity</h2><div class="table-wrap"><table><thead><tr><th>Agent</th><th>Finding</th><th>Status</th><th>Branch</th><th>Validation</th><th>Attempts</th></tr></thead><tbody>${activityRows}</tbody></table></div></div>
    <div class="card"><h2>Autonomy Grants</h2><div class="table-wrap"><table><thead><tr><th>Agent</th><th>Enabled</th><th>Allowed Codes</th><th>Max Severity</th><th>Granted</th><th>Revocation</th></tr></thead><tbody>${grantRows}</tbody></table></div></div>
    <div class="card"><h2>Auto-Merge Impact</h2><div class="table-wrap"><table><thead><tr><th>Agent</th><th>Code</th><th>Branch</th><th>Merged</th><th>New Findings</th><th>Reverted</th><th>Churn</th></tr></thead><tbody>${impactRows}</tbody></table></div></div>
    <div class="card" id="notification-controls"><h2>Notifications</h2><button id="test-notifications">Test Notifications</button><div class="table-wrap"><table><thead><tr><th>Timestamp</th><th>Type</th><th>Channel</th><th>Status</th><th>Reason</th></tr></thead><tbody>${notificationRows}</tbody></table></div></div>`,
    {
      slug,
      bodyAttrs: { "data-page": "agents", "data-slug": slug },
      scripts: ["/static/dashboard.js"],
    },
  );
}
