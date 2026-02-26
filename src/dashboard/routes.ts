import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import type { Express, Request, Response } from "express";
import { marked } from "marked";

import { loadRepoConfigs } from "../config/loader.js";
import { listCodes, lookupCode } from "../findings/registry.js";
import type { StructuredReport } from "../types/report.js";
import type { WorkDocumentStatus } from "../types/work.js";
import { loadAllTrustMetrics } from "../work/trust.js";
import {
  addNote,
  loadWorkDocument,
  loadWorkDocuments,
  saveWorkDocument,
} from "../work/manager.js";
import { renderPage, severityBadge, escapeHtml } from "./views/render.js";

async function readJsonFileIfExists<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
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

async function loadLatestStructuredReport(
  slug: string,
): Promise<StructuredReport | null> {
  const files = await listReportFiles(slug);
  const latestJson = files.find((file) => file.endsWith(".json"));
  if (!latestJson) {
    return null;
  }
  return readJsonFileIfExists<StructuredReport>(
    path.resolve(process.cwd(), "data", slug, "reports", latestJson),
  );
}

async function loadLatestMarkdownReport(slug: string): Promise<string> {
  const files = await listReportFiles(slug);
  const latestMarkdown = files.find((file) => file.endsWith(".md"));
  if (!latestMarkdown) {
    return "No markdown report available.";
  }

  const reportPath = path.resolve(
    process.cwd(),
    "data",
    slug,
    "reports",
    latestMarkdown,
  );
  return readFile(reportPath, "utf8");
}

function healthStatus(report: StructuredReport | null): string {
  if (!report) {
    return "No Data";
  }

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
      const report = await loadLatestStructuredReport(repo.slug);
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

      return `<tr>
        <td><a href="/repo/${repo.slug}">${repo.slug}</a></td>
        <td>${escapeHtml(latest)}</td>
        <td>${report?.findings.length ?? 0}</td>
        <td>${criticalCount}</td>
        <td>${mediumCount}</td>
        <td>${report ? report.workDocumentSummary.unassigned + report.workDocumentSummary.autoAssigned + report.workDocumentSummary.agentInProgress + report.workDocumentSummary.agentComplete + report.workDocumentSummary.blocked : 0}</td>
        <td>${healthStatus(report)}</td>
      </tr>`;
    }),
  );

  return renderPage(
    "Warden Dashboard",
    `<div class="card">
      <p>Multi-repo health overview.</p>
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr><th>Repo</th><th>Last Run</th><th>Findings</th><th>S0-S1</th><th>S2-S3</th><th>Work Docs</th><th>Status</th></tr>
        </thead>
        <tbody>${rows.join("")}</tbody>
      </table>
    </div>`,
  );
}

async function renderRepoDetail(slug: string): Promise<string> {
  const report = await loadLatestStructuredReport(slug);
  const markdown = await loadLatestMarkdownReport(slug);

  if (!report) {
    return renderPage(
      `Repo: ${slug}`,
      `<div class="card">No structured report found. Run <code>warden analyze --repo ${slug}</code>.</div>`,
      slug,
    );
  }

  const findingRows = report.findings
    .map(
      (f) => `<tr>
      <td>${f.code}</td>
      <td>${severityBadge(f.severity)}</td>
      <td>${escapeHtml(f.summary)}</td>
      <td>${escapeHtml(f.path ?? "-")}</td>
      <td>${f.consecutiveReports}</td>
      <td>${f.trend}</td>
      <td>${f.workDocumentId ? `<a href="/repo/${slug}/work?findingId=${encodeURIComponent(f.workDocumentId)}">${f.workDocumentId}</a>` : "-"}</td>
    </tr>`,
    )
    .join("");

  const htmlReport = await marked.parse(markdown);

  return renderPage(
    `Repo: ${slug}`,
    `<div class="kpi-grid">
      <div class="kpi"><div class="label">Findings</div><div class="value">${report.findings.length}</div></div>
      <div class="kpi"><div class="label">Stale Files</div><div class="value">${report.metricSnapshots.staleFileCount}</div></div>
      <div class="kpi"><div class="label">TODOs</div><div class="value">${report.metricSnapshots.todoCount}</div></div>
      <div class="kpi"><div class="label">Complexity</div><div class="value">${report.metricSnapshots.complexityFindings}</div></div>
    </div>
    <div class="card"><h2>Findings</h2><div class="table-wrap"><table><thead><tr><th>Code</th><th>Severity</th><th>Summary</th><th>Path</th><th>Consecutive</th><th>Trend</th><th>Work Doc</th></tr></thead><tbody>${findingRows}</tbody></table></div></div>
    <div class="card"><h2>Latest Markdown Report</h2>${htmlReport}</div>`,
    slug,
  );
}

function readRangeQuery(value: string | undefined): number {
  if (!value) {
    return 30;
  }
  if (value === "7") {
    return 7;
  }
  if (value === "30") {
    return 30;
  }
  if (value === "90") {
    return 90;
  }
  return 99999;
}

async function renderRepoTrends(
  slug: string,
  rangeDays: number,
): Promise<string> {
  const files = (await listReportFiles(slug)).filter((f) =>
    f.endsWith(".json"),
  );
  const reports: StructuredReport[] = [];

  for (const file of files) {
    const report = await readJsonFileIfExists<StructuredReport>(
      path.resolve(process.cwd(), "data", slug, "reports", file),
    );
    if (report) {
      reports.push(report);
    }
  }

  const sliced = reports.slice(0, Math.max(1, rangeDays));
  const labels = sliced.map((r) => r.timestamp);

  const totals = sliced.map((r) => r.findings.length);
  const stale = sliced.map((r) => r.metricSnapshots.staleFileCount);
  const todos = sliced.map((r) => r.metricSnapshots.todoCount);
  const complexity = sliced.map((r) => r.metricSnapshots.complexityFindings);

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
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <script>
      const ctx = document.getElementById('trendChart');
      new Chart(ctx, {
        type: 'line',
        data: {
          labels: ${JSON.stringify(labels.reverse())},
          datasets: [
            { label: 'Total Findings', data: ${JSON.stringify(totals.reverse())} },
            { label: 'Stale Files', data: ${JSON.stringify(stale.reverse())} },
            { label: 'TODOs', data: ${JSON.stringify(todos.reverse())} },
            { label: 'Complexity', data: ${JSON.stringify(complexity.reverse())} },
          ]
        },
        options: { responsive: true, maintainAspectRatio: false }
      });
    </script>`,
    slug,
  );
}

const VALID_STATUSES: WorkDocumentStatus[] = [
  "unassigned",
  "auto-assigned",
  "agent-in-progress",
  "agent-complete",
  "pm-review",
  "blocked",
  "resolved",
  "wont-fix",
];

async function updateWorkFromRequest(
  slug: string,
  req: Request,
): Promise<void> {
  const findingId = String(req.body.findingId ?? "");
  const status = String(req.body.status ?? "");
  const note = String(req.body.note ?? "").trim();

  if (!findingId) {
    return;
  }

  const doc = await loadWorkDocument(slug, findingId);
  if (!doc) {
    return;
  }

  if (status && VALID_STATUSES.includes(status as WorkDocumentStatus)) {
    doc.status = status as WorkDocumentStatus;
    if (status === "resolved") {
      doc.resolvedAt = new Date().toISOString();
    }
  }

  if (note.length > 0) {
    addNote(doc, "dashboard", note);
  }

  await saveWorkDocument(slug, doc);
}

async function renderWorkView(
  slug: string,
  query: Request["query"],
): Promise<string> {
  const docs = await loadWorkDocuments(slug);
  const statusFilter = typeof query.status === "string" ? query.status : "all";
  const severityFilter =
    typeof query.severity === "string" ? query.severity : "all";
  const findingId = typeof query.findingId === "string" ? query.findingId : "";

  const filtered = docs.filter((doc) => {
    if (statusFilter !== "all" && doc.status !== statusFilter) {
      return false;
    }
    if (severityFilter !== "all" && doc.severity !== severityFilter) {
      return false;
    }
    return true;
  });

  const rows = filtered
    .map(
      (doc) => `<tr>
      <td>${doc.findingId}</td>
      <td>${doc.code}</td>
      <td>${severityBadge(doc.severity)}</td>
      <td>${doc.status}</td>
      <td>${doc.consecutiveReports}</td>
      <td>${doc.trend}</td>
      <td>${doc.assignedTo ?? "-"}</td>
      <td>
        <form method="post" action="/repo/${slug}/work" class="inline">
          <input type="hidden" name="findingId" value="${doc.findingId}" />
          <select name="status">
            ${VALID_STATUSES.map((s) => `<option value="${s}" ${doc.status === s ? "selected" : ""}>${s}</option>`).join("")}
          </select>
          <input name="note" placeholder="optional note" />
          <button type="submit">Update</button>
        </form>
      </td>
    </tr>`,
    )
    .join("");

  const selectedDoc = findingId
    ? docs.find((doc) => doc.findingId === findingId)
    : undefined;
  const notes = selectedDoc
    ? `<div class="card"><h3>Notes: ${selectedDoc.findingId}</h3><pre>${escapeHtml(selectedDoc.notes.map((n) => `[${n.timestamp}] ${n.author}: ${n.text}`).join("\n"))}</pre></div>`
    : "";

  return renderPage(
    `Work Documents: ${slug}`,
    `<div class="card">
      <form class="inline" method="get">
        <label>Status <input name="status" value="${statusFilter}" /></label>
        <label>Severity <input name="severity" value="${severityFilter}" /></label>
        <button type="submit">Filter</button>
      </form>
    </div>
    <div class="table-wrap">
      <table><thead><tr><th>Finding ID</th><th>Code</th><th>Severity</th><th>Status</th><th>Consecutive</th><th>Trend</th><th>Agent</th><th>Actions</th></tr></thead><tbody>${rows}</tbody></table>
    </div>
    ${notes}`,
    slug,
  );
}

async function renderAgentsView(slug: string): Promise<string> {
  const trust = await loadAllTrustMetrics(slug);
  const docs = await loadWorkDocuments(slug);
  const agentDocs = docs.filter((d) => Boolean(d.assignedTo));

  const trustRows = trust
    .map(
      (t) =>
        `<tr><td>${t.agentName}</td><td>${(t.validationPassRate * 100).toFixed(1)}%</td><td>${t.consecutiveCleanMerges}</td><td>${t.totalRuns}</td></tr>`,
    )
    .join("");

  const activityRows = agentDocs
    .map(
      (d) =>
        `<tr><td>${d.assignedTo}</td><td>${d.code}</td><td>${d.status}</td><td>${d.relatedBranch ?? "-"}</td><td>${d.validationResult?.passed ?? "-"}</td><td>${d.validationResult?.attempts ?? "-"}</td></tr>`,
    )
    .join("");

  return renderPage(
    `Agent Activity: ${slug}`,
    `<div class="card"><h2>Trust Scores</h2><div class="table-wrap"><table><thead><tr><th>Agent</th><th>Pass Rate</th><th>Clean Merges</th><th>Total Runs</th></tr></thead><tbody>${trustRows}</tbody></table></div></div>
    <div class="card"><h2>Activity</h2><div class="table-wrap"><table><thead><tr><th>Agent</th><th>Finding</th><th>Status</th><th>Branch</th><th>Validation</th><th>Attempts</th></tr></thead><tbody>${activityRows}</tbody></table></div></div>`,
    slug,
  );
}

async function renderWikiIndex(search: string): Promise<string> {
  const codes = listCodes().filter(
    (code) =>
      code.code.toLowerCase().includes(search.toLowerCase()) ||
      code.shortDescription.toLowerCase().includes(search.toLowerCase()),
  );

  const rows = codes
    .map(
      (code) =>
        `<tr><td><a href="/wiki/${code.code}">${code.code}</a></td><td>${code.metric}</td><td>${escapeHtml(code.shortDescription)}</td></tr>`,
    )
    .join("");

  return renderPage(
    "Wiki",
    `<div class="card"><form class="inline"><input name="q" value="${escapeHtml(search)}" placeholder="search code or keyword"/><button type="submit">Search</button></form></div>
    <div class="table-wrap"><table><thead><tr><th>Code</th><th>Metric</th><th>Description</th></tr></thead><tbody>${rows}</tbody></table></div>`,
  );
}

async function renderWikiPage(code: string): Promise<string> {
  const definition = lookupCode(code.toUpperCase());
  if (!definition) {
    return renderPage(
      "Wiki",
      `<div class="card">Unknown code: ${escapeHtml(code)}</div>`,
    );
  }

  const wikiPath = path.resolve(process.cwd(), definition.wikiPath);
  const raw = await readFile(wikiPath, "utf8").catch(
    () => "Wiki page not found.",
  );
  const html = await marked.parse(raw);

  return renderPage(
    `Wiki: ${definition.code}`,
    `<div class="card"><p>${escapeHtml(definition.shortDescription)}</p></div><div class="card">${html}</div>`,
  );
}

export function registerDashboardRoutes(app: Express): void {
  function paramValue(value: string | string[] | undefined): string {
    if (!value) {
      return "";
    }
    if (Array.isArray(value)) {
      return value[0] ?? "";
    }
    return value;
  }

  app.get("/", async (_req: Request, res: Response) => {
    res.type("html").send(await renderOverview());
  });

  app.get("/repo/:slug", async (req: Request, res: Response) => {
    res.type("html").send(await renderRepoDetail(paramValue(req.params.slug)));
  });

  app.get("/repo/:slug/trends", async (req: Request, res: Response) => {
    const range =
      typeof req.query.range === "string" ? req.query.range : undefined;
    res
      .type("html")
      .send(
        await renderRepoTrends(
          paramValue(req.params.slug),
          readRangeQuery(range),
        ),
      );
  });

  app.get("/repo/:slug/work", async (req: Request, res: Response) => {
    res
      .type("html")
      .send(await renderWorkView(paramValue(req.params.slug), req.query));
  });

  app.post("/repo/:slug/work", async (req: Request, res: Response) => {
    const slug = paramValue(req.params.slug);
    await updateWorkFromRequest(slug, req);
    res.redirect(`/repo/${slug}/work`);
  });

  app.get("/repo/:slug/agents", async (req: Request, res: Response) => {
    res.type("html").send(await renderAgentsView(paramValue(req.params.slug)));
  });

  app.get("/wiki", async (req: Request, res: Response) => {
    const search = typeof req.query.q === "string" ? req.query.q : "";
    res.type("html").send(await renderWikiIndex(search));
  });

  app.get("/wiki/:code", async (req: Request, res: Response) => {
    res.type("html").send(await renderWikiPage(paramValue(req.params.code)));
  });
}
