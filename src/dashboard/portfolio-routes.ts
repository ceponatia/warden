import { readdir } from "node:fs/promises";
import path from "node:path";

import { loadRepoConfigs } from "../config/loader.js";
import { runCrossRepoAnalysis } from "../github/cross-repo.js";
import { readJsonIfPresent } from "../snapshots.js";
import type { StructuredReport } from "../types/report.js";
import { escapeHtml, renderPage } from "./views/render.js";

function severityClass(severity: string): string {
  return `badge-${severity.toLowerCase()}`;
}

function trendLabel(value: string | undefined): string {
  if (value === "worsening") return "↑ worsening";
  if (value === "improving") return "↓ improving";
  return "→ stable";
}

function readRangeQuery(value: string | undefined): number {
  if (!value) return 30;
  if (value === "7") return 7;
  if (value === "30") return 30;
  if (value === "90") return 90;
  return 99999;
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

async function loadLatestReport(slug: string): Promise<StructuredReport | null> {
  const files = await listReportFiles(slug);
  const latestJson = files.find((file) => file.endsWith(".json"));
  if (!latestJson) {
    return null;
  }
  return readJsonIfPresent<StructuredReport>(
    path.resolve(process.cwd(), "data", slug, "reports", latestJson),
  );
}

export async function renderPortfolioOverviewPage(): Promise<string> {
  const repos = await loadRepoConfigs();
  const crossRepo = await runCrossRepoAnalysis(repos, { persist: false });
  if (!crossRepo) {
    return renderPage(
      "Portfolio Overview",
      '<div class="card">Portfolio view requires at least two configured repos.</div>',
    );
  }

  const metrics = ["M1", "M2", "M3", "M4", "M5", "M6", "M7", "M8", "M9"];
  const latestReports = await Promise.all(
    repos.map(async (repo) => ({ slug: repo.slug, report: await loadLatestReport(repo.slug) })),
  );

  const heatRows = latestReports
    .map(({ slug, report }) => {
      const cells = metrics
        .map((metric) => {
          const matching = (report?.findings ?? []).filter((finding) => finding.metric === metric);
          const severity =
            matching.length === 0
              ? "S5"
              : matching
                  .map((finding) => Number(finding.severity.replace("S", "")))
                  .sort((a, b) => a - b)[0];
          const rendered =
            typeof severity === "number" ? `S${severity}` : (severity ?? "S5");
          return `<td><span class="badge ${severityClass(rendered)}">${rendered}</span></td>`;
        })
        .join("");
      return `<tr><td>${escapeHtml(slug)}</td>${cells}</tr>`;
    })
    .join("");

  const patternCards =
    crossRepo.systemicPatterns.length === 0
      ? "<p>No systemic patterns detected.</p>"
      : crossRepo.systemicPatterns
          .slice(0, 12)
          .map(
            (pattern) =>
              `<div class="card"><strong>${escapeHtml(pattern.patternType)}</strong> <span class="badge ${severityClass(pattern.severity)}">${pattern.severity}</span><p>${escapeHtml(pattern.description)}</p><p>Repos: ${escapeHtml(pattern.affectedRepos.join(", "))}</p></div>`,
          )
          .join("");

  return renderPage(
    "Portfolio Overview",
    `<div class="card">
      <p>Total findings (correlated codes): ${crossRepo.correlatedFindings.length}</p>
      <p>Total systemic patterns: ${crossRepo.systemicPatterns.length}</p>
      <p>Total dependency drift entries: ${crossRepo.sharedDependencyDrift.length}</p>
    </div>
    <div class="card">
      <h2>Health Heatmap</h2>
      <div class="table-wrap"><table>
      <thead><tr><th>Repo</th>${metrics.map((metric) => `<th>${metric}</th>`).join("")}</tr></thead>
      <tbody>${heatRows}</tbody>
      </table></div>
    </div>
    <h2>Systemic Patterns</h2>
    ${patternCards}`,
  );
}

export async function renderPortfolioTrendsPage(
  metric: string | undefined,
  range: string | undefined,
): Promise<string> {
  const repos = await loadRepoConfigs();
  const selectedMetric = (metric ?? "M4").toUpperCase();
  const rangeDays = readRangeQuery(range);

  const labelsByRepo = await Promise.all(
    repos.map(async (repo) => {
      const files = (await listReportFiles(repo.slug)).filter((file) => file.endsWith(".json"));
      const limited = files.slice(0, Math.max(1, Math.min(files.length, rangeDays))).reverse();
      const points: number[] = [];
      const labels: string[] = [];
      for (const file of limited) {
        const report = await readJsonIfPresent<StructuredReport>(
          path.resolve(process.cwd(), "data", repo.slug, "reports", file),
        );
        if (!report) continue;
        labels.push(report.timestamp);
        points.push(report.findings.filter((finding) => finding.metric === selectedMetric).length);
      }
      return { repo: repo.slug, labels, points };
    }),
  );

  const labels = labelsByRepo.reduce<string[]>((acc, entry) =>
    entry.labels.length > acc.length ? entry.labels : acc,
  [],
  );

  const datasets = labelsByRepo.map((entry) => ({
    label: entry.repo,
    data: entry.points,
  }));

  return renderPage(
    "Portfolio Trends",
    `<div class="card">
      <form class="inline" method="get">
        <label>Metric
          <select name="metric">
            ${["M1", "M2", "M3", "M4", "M5", "M6", "M7", "M8", "M9"]
              .map((m) => `<option value="${m}" ${selectedMetric === m ? "selected" : ""}>${m}</option>`)
              .join("")}
          </select>
        </label>
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
      <canvas id="portfolioTrendChart" height="130"></canvas>
    </div>
    <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
    <script>
      const ctx = document.getElementById('portfolioTrendChart');
      new Chart(ctx, {
        type: 'line',
        data: {
          labels: ${JSON.stringify(labels)},
          datasets: ${JSON.stringify(datasets)}
        },
        options: { responsive: true, maintainAspectRatio: false }
      });
    </script>`,
  );
}

export async function renderPortfolioDriftPage(): Promise<string> {
  const repos = await loadRepoConfigs();
  const crossRepo = await runCrossRepoAnalysis(repos, { persist: false });
  if (!crossRepo) {
    return renderPage(
      "Portfolio Drift",
      '<div class="card">Portfolio drift view requires at least two configured repos.</div>',
    );
  }

  const repoSlugs = repos.map((repo) => repo.slug);
  const rows = crossRepo.sharedDependencyDrift
    .slice(0, 200)
    .map((drift) => {
      const versions = repoSlugs
        .map((slug) => `<td>${escapeHtml(drift.versions[slug] ?? "-")}</td>`)
        .join("");
      return `<tr><td>${escapeHtml(drift.dependency)}</td><td>${drift.source}</td><td><span class="badge ${severityClass(drift.severity)}">${drift.severity}</span></td><td>${drift.driftLevel}</td>${versions}</tr>`;
    })
    .join("");

  const trendRows = crossRepo.metricTrends
    .map(
      (trend) =>
        `<tr><td>${trend.metric}</td>${repoSlugs
          .map((slug) => `<td>${trendLabel(trend.repoTrends[slug])}</td>`)
          .join("")}</tr>`,
    )
    .join("");

  return renderPage(
    "Portfolio Drift",
    `<div class="card"><h2>Dependency Drift</h2>
      <div class="table-wrap"><table>
        <thead><tr><th>Package</th><th>Source</th><th>Severity</th><th>Drift</th>${repoSlugs.map((slug) => `<th>${escapeHtml(slug)}</th>`).join("")}</tr></thead>
        <tbody>${rows || `<tr><td colspan="${4 + repoSlugs.length}">No dependency drift detected.</td></tr>`}</tbody>
      </table></div>
    </div>
    <div class="card"><h2>Metric Trend Direction</h2>
      <div class="table-wrap"><table>
        <thead><tr><th>Metric</th>${repoSlugs.map((slug) => `<th>${escapeHtml(slug)}</th>`).join("")}</tr></thead>
        <tbody>${trendRows}</tbody>
      </table></div>
    </div>`,
  );
}
