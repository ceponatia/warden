import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { Express, Request, Response } from "express";
import { Marked } from "marked";
import sanitizeHtml from "sanitize-html";
import { loadRepoConfigs } from "../config/loader.js";
import { readJsonIfPresent } from "../snapshots.js";
import type { StructuredReport } from "../types/report.js";
import type { WorkDocumentStatus } from "../types/work.js";
import { VALID_STATUSES } from "../types/work.js";
import {
  addNote,
  loadWorkDocument,
  loadWorkDocuments,
  saveWorkDocument,
} from "../work/manager.js";
import { renderAgentsView } from "./views/agents-view.js";
import { escapeHtml, renderPage, severityBadge } from "./views/render.js";
import {
  renderPortfolioDriftPage,
  renderPortfolioOverviewPage,
  renderPortfolioTrendsPage,
} from "./portfolio-routes.js";
import { registerWikiRoutes } from "./wiki-routes.js";
const rawMarked = new Marked();
async function renderMarkdownSafe(src: string): Promise<string> {
  const raw = await rawMarked.parse(src);
  return sanitizeHtml(raw, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(["h1", "h2", "h3"]),
    allowedAttributes: { ...sanitizeHtml.defaults.allowedAttributes },
    allowedSchemes: ["http", "https", "mailto"],
  });
}
function safeJsonForScript(value: unknown): string {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}
async function listReportFiles(slug: string): Promise<string[]> {
  const reportsDir = path.resolve(process.cwd(), "data", slug, "reports");
  try {
    const entries = await readdir(reportsDir);
    return entries.sort((a, b) => b.localeCompare(a));
  } catch {
    return [];
  }
}
async function loadLatestReportPair(
  slug: string,
): Promise<{ report: StructuredReport | null; markdown: string }> {
  const files = await listReportFiles(slug);
  const latestJson = files.find((file) => file.endsWith(".json"));
  if (!latestJson) {
    return { report: null, markdown: "No markdown report available." };
  }
  const reportsDir = path.resolve(process.cwd(), "data", slug, "reports");
  const report = await readJsonIfPresent<StructuredReport>(
    path.join(reportsDir, latestJson),
  );
  const mdBase = latestJson.replace(/\.json$/, ".md");
  const markdown = await readFile(path.join(reportsDir, mdBase), "utf8").catch(
    () => "No markdown report available.",
  );
  return { report, markdown };
}
function healthStatus(report: StructuredReport | null): string {
  if (!report) return "No Data";
  const criticalCount = report.findings.filter(
    (f) => f.severity === "S0" || f.severity === "S1",
  ).length;
  if (criticalCount > 0 || report.workDocumentSummary.blocked > 0) {
    return "Attention";
  }
  if (report.findings.length > 0) {
    return "Watch";
  }
  return "Healthy";
}
async function renderOverview(): Promise<string> {
  const repos = await loadRepoConfigs();
  const rows = await Promise.all(
    repos.map(async (repo) => {
      const { report } = await loadLatestReportPair(repo.slug);
      const files = await listReportFiles(repo.slug);
      const latest = files[0] ?? "n/a";
      const criticalCount = report
        ? report.findings.filter(
            (f) => f.severity === "S0" || f.severity === "S1",
          ).length
        : 0;
      const mediumCount = report
        ? report.findings.filter(
            (f) => f.severity === "S2" || f.severity === "S3",
          ).length
        : 0;
      const m7Alerts = report
        ? report.findings.filter((f) => f.metric === "M7").length
        : 0;
      const m8Alerts = report
        ? report.findings.filter((f) => f.metric === "M8").length
        : 0;
      return `<tr>
        <td><a href="/repo/${encodeURIComponent(repo.slug)}">${escapeHtml(repo.slug)}</a></td>
        <td>${escapeHtml(latest)}</td>
        <td>${report?.findings.length ?? 0}</td>
        <td>${criticalCount}</td>
        <td>${mediumCount}</td>
        <td>${m7Alerts}</td>
        <td>${m8Alerts}</td>
        <td>${report ? report.workDocumentSummary.totalActive : 0}</td>
        <td>${healthStatus(report)}</td>
      </tr>`;
    }),
  );
  return renderPage(
    "Warden Dashboard",
    `<div class="card"><p>Multi-repo health overview.</p></div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr><th>Repo</th><th>Last Run</th><th>Findings</th><th>S0-S1</th><th>S2-S3</th><th>M7</th><th>M8</th><th>Work Docs</th><th>Status</th></tr>
        </thead>
        <tbody>${rows.join("")}</tbody>
      </table>
    </div>`,
  );
}
function renderFilterGroup(name: string, values: string[]): string {
  return values
    .map(
      (value) =>
        `<label><input type="checkbox" name="${name}" value="${value}" /> ${value}</label>`,
    )
    .join(" ");
}
function renderMetricSection(
  report: StructuredReport,
  metric: "M7" | "M8",
  title: string,
): string {
  const rows = report.findings
    .filter((finding) => finding.metric === metric)
    .map(
      (finding) => `<tr>
      <td>${escapeHtml(finding.code)}</td>
      <td>${severityBadge(finding.severity)}</td>
      <td>${escapeHtml(finding.summary)}</td>
      <td>${escapeHtml(finding.path ?? "-")}</td>
    </tr>`,
    )
    .join("");
  const empty = '<tr><td colspan="4">No findings</td></tr>';
  return `<div class="card"><h2>${escapeHtml(title)}</h2>
    <div class="table-wrap"><table><thead><tr><th>Code</th><th>Severity</th><th>Summary</th><th>Path</th></tr></thead><tbody>${rows || empty}</tbody></table></div>
  </div>`;
}
function repoBody(
  slug: string,
  report: StructuredReport,
  htmlReport: string,
  workStatuses: Record<string, string>,
): string {
  return `<div class="card" id="repo-controls">
    <h2>Operations</h2>
    <button data-command="collect">Collect Now</button>
    <button data-command="analyze">Analyze Now</button>
    <button data-command="report">Generate Report</button>
  </div>
  <div class="kpi-grid">
    <div class="kpi"><div class="label">Findings</div><div class="value">${report.findings.length}</div></div>
    <div class="kpi"><div class="label">Stale Files</div><div class="value">${report.metricSnapshots.staleFileCount}</div></div>
    <div class="kpi"><div class="label">TODOs</div><div class="value">${report.metricSnapshots.todoCount}</div></div>
    <div class="kpi"><div class="label">Complexity</div><div class="value">${report.metricSnapshots.complexityFindings}</div></div>
  </div>
  <div class="card" id="finding-filters">
    <h2>Findings</h2>
    <div class="filter-grid">
      <label>Search <input id="finding-search" placeholder="summary or path" /></label>
      <label>Sort
        <select id="finding-sort">
          <option value="severity">Severity</option>
          <option value="lastSeen">Last seen</option>
          <option value="consecutive">Consecutive reports</option>
          <option value="path">Path</option>
        </select>
      </label>
      <label>Status
        <select id="status-filter">
          <option value="all">all</option>
          ${VALID_STATUSES.map((status) => `<option value="${status}">${status}</option>`).join("")}
        </select>
      </label>
    </div>
    <div class="filter-grid">
      <div><strong>Metric</strong> ${renderFilterGroup("metric-filter", ["M1", "M2", "M3", "M4", "M5", "M6", "M7", "M8", "M9"])}</div>
      <div><strong>Severity</strong> ${renderFilterGroup("severity-filter", ["S0", "S1", "S2", "S3", "S4", "S5"])}</div>
    </div>
    <div class="table-wrap"><table>
      <thead><tr><th>Code</th><th>Severity</th><th>Summary</th><th>Path</th><th>Consecutive</th><th>Trend</th><th>Work Doc</th></tr></thead>
      <tbody id="finding-table-body"></tbody>
    </table></div>
  </div>
  ${renderMetricSection(report, "M7", "M7 Coverage Findings")}
  ${renderMetricSection(report, "M8", "M8 Documentation Staleness Findings")}
  <div class="card"><h2>Latest Markdown Report</h2>${htmlReport}</div>
  <div class="modal" id="command-modal" hidden>
    <div class="modal-content">
      <h3>Command Output</h3>
      <pre id="command-output"></pre>
      <button id="command-close">Close</button>
    </div>
  </div>
  <div class="modal" id="shortcut-help" hidden>
    <div class="modal-content">
      <h3>Keyboard Shortcuts</h3>
      <ul>
        <li>c: focus collect</li>
        <li>a: focus analyze</li>
        <li>f or /: focus search</li>
        <li>j / k: navigate findings</li>
        <li>Enter: open selected finding work doc</li>
        <li>Esc: clear filters / close modal</li>
      </ul>
    </div>
  </div>
  <script id="report-data" type="application/json">${safeJsonForScript(report)}</script>
  <script id="work-status-data" type="application/json">${safeJsonForScript(workStatuses)}</script>
  <input type="hidden" id="repo-slug" value="${escapeHtml(slug)}" />`;
}
function readRangeQuery(value: string | undefined): number {
  if (!value) return 30;
  if (value === "7") return 7;
  if (value === "30") return 30;
  if (value === "90") return 90;
  return 99999;
}
async function renderRepoDetail(slug: string): Promise<string> {
  const { report, markdown } = await loadLatestReportPair(slug);
  if (!report) {
    return renderPage(
      `Repo: ${slug}`,
      `<div class="card">No structured report found. Run <code>warden analyze --repo ${escapeHtml(slug)}</code>.</div>`,
      {
        slug,
        bodyAttrs: { "data-page": "repo", "data-slug": slug },
        scripts: ["/static/dashboard.js"],
      },
    );
  }
  const [workDocs, htmlReport] = await Promise.all([
    loadWorkDocuments(slug),
    renderMarkdownSafe(markdown),
  ]);
  const workStatuses = Object.fromEntries(
    workDocs.map((doc) => [doc.findingId, doc.status]),
  );
  return renderPage(
    `Repo: ${slug}`,
    repoBody(slug, report, htmlReport, workStatuses),
    {
      slug,
      bodyAttrs: { "data-page": "repo", "data-slug": slug },
      scripts: ["/static/dashboard.js"],
    },
  );
}
async function renderRepoTrends(
  slug: string,
  rangeDays: number,
): Promise<string> {
  const allFiles = (await listReportFiles(slug)).filter((f) =>
    f.endsWith(".json"),
  );
  const filesInRange = allFiles.slice(
    0,
    Math.min(allFiles.length, Math.max(1, rangeDays)),
  );
  const reports: StructuredReport[] = [];
  for (const file of filesInRange) {
    const report = await readJsonIfPresent<StructuredReport>(
      path.resolve(process.cwd(), "data", slug, "reports", file),
    );
    if (report) reports.push(report);
  }
  const ordered = [...reports].reverse();
  const labels = ordered.map((r) => r.timestamp);
  const totals = ordered.map((r) => r.findings.length);
  const stale = ordered.map((r) => r.metricSnapshots.staleFileCount);
  const todos = ordered.map((r) => r.metricSnapshots.todoCount);
  const complexity = ordered.map((r) => r.metricSnapshots.complexityFindings);
  const coverage = ordered.map((r) =>
    Number(r.metricSnapshots.coverageAverage ?? 0),
  );
  const staleDocs = ordered.map((r) =>
    Number(r.metricSnapshots.staleDocCount ?? 0),
  );
  return renderPage(
    `Trends: ${slug}`,
    `<div class="card">
      <form class="inline" method="get">
        <label>Range
          <select name="range">
            <option value="7" ${rangeDays === 7 ? "selected" : ""}>7d</option>
            <option value="30" ${rangeDays === 30 ? "selected" : ""}>30d</option>
            <option value="90" ${rangeDays === 90 ? "selected" : ""}>90d</option>
            <option value="all" ${rangeDays > 90 ? "selected" : ""}>all</option>
          </select>
        </label>
        <button type="submit">Apply</button>
      </form>
      <canvas id="trendChart" height="120"></canvas>
    </div>
    <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
    <script>
      const ctx = document.getElementById('trendChart');
      new Chart(ctx, {
        type: 'line',
        data: {
          labels: ${JSON.stringify(labels)},
          datasets: [
            { label: 'Total Findings', data: ${JSON.stringify(totals)} },
            { label: 'Stale Files', data: ${JSON.stringify(stale)} },
            { label: 'TODOs', data: ${JSON.stringify(todos)} },
            { label: 'Complexity', data: ${JSON.stringify(complexity)} },
            { label: 'Coverage %', data: ${JSON.stringify(coverage)} },
            { label: 'Stale Docs', data: ${JSON.stringify(staleDocs)} },
          ]
        },
        options: { responsive: true, maintainAspectRatio: false }
      });
    </script>`,
    { slug },
  );
}
async function updateWorkFromRequest(
  slug: string,
  req: Request,
): Promise<void> {
  const findingId = String(req.body.findingId ?? "");
  const status = String(req.body.status ?? "");
  const note = String(req.body.note ?? "").trim();
  if (!findingId) return;
  const doc = await loadWorkDocument(slug, findingId);
  if (!doc) return;
  if (status && VALID_STATUSES.includes(status as WorkDocumentStatus)) {
    doc.status = status as WorkDocumentStatus;
    if (status === "resolved") doc.resolvedAt = new Date().toISOString();
  }
  if (note.length > 0) addNote(doc, "dashboard", note);
  await saveWorkDocument(slug, doc);
}
function renderNotesBlock(findingId: string, notes: string): string {
  return `<details>
    <summary>Notes</summary>
    <pre>${escapeHtml(notes)}</pre>
    <textarea data-note-for="${escapeHtml(findingId)}" placeholder="Add note"></textarea>
    <button type="button" data-add-note="${escapeHtml(findingId)}">Save note</button>
  </details>`;
}
async function renderWorkView(
  slug: string,
  query: Request["query"],
): Promise<string> {
  const docs = await loadWorkDocuments(slug);
  const statusFilter = typeof query.status === "string" ? query.status : "all";
  const severityFilter =
    typeof query.severity === "string" ? query.severity : "all";
  const filtered = docs.filter((doc) => {
    if (statusFilter !== "all" && doc.status !== statusFilter) return false;
    if (severityFilter !== "all" && doc.severity !== severityFilter)
      return false;
    return true;
  });
  const rows = filtered
    .map((doc) => {
      const renderedNotes = doc.notes
        .map((n) => `[${n.timestamp}] ${n.author}: ${n.text}`)
        .join("\n");
      return `<tr>
      <td><input type="checkbox" name="bulk-finding" value="${escapeHtml(doc.findingId)}" /></td>
      <td>${escapeHtml(doc.findingId)}</td>
      <td>${escapeHtml(doc.code)}</td>
      <td>${severityBadge(doc.severity)}</td>
      <td>
        <form method="post" action="/repo/${encodeURIComponent(slug)}/work" class="inline">
          <input type="hidden" name="findingId" value="${escapeHtml(doc.findingId)}" />
          <select name="status">
            ${VALID_STATUSES.map((s) => `<option value="${s}" ${doc.status === s ? "selected" : ""}>${escapeHtml(s)}</option>`).join("")}
          </select>
          <input name="note" placeholder="optional note" />
          <button type="submit">Update</button>
        </form>
        ${renderNotesBlock(doc.findingId, renderedNotes)}
      </td>
    </tr>`;
    })
    .join("");
  return renderPage(
    `Work Documents: ${slug}`,
    `<div class="card">
      <form class="inline" method="get">
        <label>Status <input name="status" value="${escapeHtml(statusFilter)}" /></label>
        <label>Severity <input name="severity" value="${escapeHtml(severityFilter)}" /></label>
        <button type="submit">Filter</button>
      </form>
    </div>
    <div class="card">
      <label>Bulk status
        <select id="bulk-status">${VALID_STATUSES.map((status) => `<option value="${status}">${status}</option>`).join("")}</select>
      </label>
      <input id="bulk-note" placeholder="bulk note (optional)" />
      <button type="button" id="bulk-update">Bulk Update</button>
    </div>
    <div class="table-wrap">
      <table><thead><tr><th></th><th>Finding ID</th><th>Code</th><th>Severity</th><th>Actions</th></tr></thead><tbody>${rows}</tbody></table>
    </div>`,
    {
      slug,
      bodyAttrs: { "data-page": "work", "data-slug": slug },
      scripts: ["/static/dashboard.js"],
    },
  );
}
function paramValue(value: string | string[] | undefined): string {
  if (!value) return "";
  if (Array.isArray(value)) return value[0] ?? "";
  return value;
}
function getValidatedSlug(req: Request, res: Response): string | null {
  const slug = paramValue(req.params.slug);
  if (!slug || !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(slug)) {
    res.status(400).type("text/plain").send("Invalid repository slug");
    return null;
  }
  return slug;
}
export function registerDashboardRoutes(app: Express): void {
  app.get("/", async (_req, res) => {
    res.type("html").send(await renderOverview());
  });
  app.get("/repo/:slug", async (req, res) => {
    const slug = getValidatedSlug(req, res);
    if (!slug) return;
    res.type("html").send(await renderRepoDetail(slug));
  });
  app.get("/repo/:slug/trends", async (req, res) => {
    const slug = getValidatedSlug(req, res);
    if (!slug) return;
    const range =
      typeof req.query.range === "string" ? req.query.range : undefined;
    res.type("html").send(await renderRepoTrends(slug, readRangeQuery(range)));
  });
  app.get("/repo/:slug/work", async (req, res) => {
    const slug = getValidatedSlug(req, res);
    if (!slug) return;
    res.type("html").send(await renderWorkView(slug, req.query));
  });
  app.post("/repo/:slug/work", async (req, res) => {
    const slug = getValidatedSlug(req, res);
    if (!slug) return;
    await updateWorkFromRequest(slug, req);
    res.redirect(`/repo/${encodeURIComponent(slug)}/work`);
  });
  app.get("/repo/:slug/agents", async (req, res) => {
    const slug = getValidatedSlug(req, res);
    if (!slug) return;
    res.type("html").send(await renderAgentsView(slug));
  });
  app.get("/portfolio", async (_req, res) => {
    res.type("html").send(await renderPortfolioOverviewPage());
  });
  app.get("/portfolio/trends", async (req, res) => {
    const range =
      typeof req.query.range === "string" ? req.query.range : undefined;
    const metric =
      typeof req.query.metric === "string" ? req.query.metric : "M4";
    res.type("html").send(await renderPortfolioTrendsPage(metric, range));
  });
  app.get("/portfolio/drift", async (_req, res) => {
    res.type("html").send(await renderPortfolioDriftPage());
  });
  registerWikiRoutes(app);
}
