import { readdir } from "node:fs/promises";
import path from "node:path";

import { Router, type Request, type Response } from "express";
import { z } from "zod";

import { loadRepoConfigs } from "../config/loader.js";
import { readJsonIfPresent } from "../snapshots.js";
import type { StructuredReport } from "../types/report.js";
import type { Severity, WorkDocumentStatus } from "../types/work.js";
import { VALID_STATUSES } from "../types/work.js";
import {
  addNote,
  loadWorkDocument,
  loadWorkDocuments,
  saveWorkDocument,
} from "../work/manager.js";
import type { CommandRunner } from "./command-runner.js";
import type { DashboardWebSocketHub } from "./websocket.js";

const COMMANDS = ["collect", "analyze", "report"] as const;

const statusSchema = z.object({
  status: z.enum(VALID_STATUSES),
  note: z.string().trim().max(5000).optional(),
});
const noteSchema = z.object({ text: z.string().trim().min(1).max(5000) });
const bulkSchema = z.object({
  findingIds: z.array(z.string().min(1)).min(1),
  status: z.enum(VALID_STATUSES),
  note: z.string().trim().max(5000).optional(),
});

const SEVERITY_ORDER: Record<Severity, number> = {
  S0: 0,
  S1: 1,
  S2: 2,
  S3: 3,
  S4: 4,
  S5: 5,
};

function normalizeSlug(input: string | string[] | undefined): string {
  if (!input) return "";
  if (Array.isArray(input)) return input[0]?.trim() ?? "";
  return input.trim();
}

function sanitizeNote(text: string): string {
  return text.replace(/\p{C}+/gu, " ").trim();
}

async function ensureValidSlug(
  req: Request,
  res: Response,
): Promise<string | null> {
  const slug = normalizeSlug(req.params.slug);
  if (!slug) {
    res.status(400).json({ error: "Missing repository slug" });
    return null;
  }

  const repos = await loadRepoConfigs();
  if (!repos.some((repo) => repo.slug === slug)) {
    res.status(404).json({ error: `Unknown repository slug: ${slug}` });
    return null;
  }

  return slug;
}

async function loadLatestReport(
  slug: string,
): Promise<StructuredReport | null> {
  const reportsDir = path.resolve(process.cwd(), "data", slug, "reports");
  const entries = await readdir(reportsDir).catch(() => []);
  const latestJson = entries
    .sort((a, b) => b.localeCompare(a))
    .find((file) => file.endsWith(".json"));
  if (!latestJson) return null;
  return readJsonIfPresent<StructuredReport>(path.join(reportsDir, latestJson));
}

function registerCommandRoutes(
  router: Router,
  commandRunner: CommandRunner,
): void {
  for (const command of COMMANDS) {
    router.post(`/repo/:slug/${command}`, async (req, res) => {
      const slug = await ensureValidSlug(req, res);
      if (!slug) return;
      if (commandRunner.isRunning(slug)) {
        res
          .status(409)
          .json({ error: "A command is already running for this repository." });
        return;
      }

      const job = commandRunner.spawnCommand(slug, command);
      res
        .status(202)
        .json({ jobId: job.id, status: job.status, startedAt: job.startedAt });
    });
  }

  router.get("/repo/:slug/command-status", async (req, res) => {
    const slug = await ensureValidSlug(req, res);
    if (!slug) return;

    const queryJobId =
      typeof req.query.jobId === "string" ? req.query.jobId : "";
    const job = queryJobId
      ? commandRunner.getJob(queryJobId)
      : commandRunner.getLatestJobForSlug(slug);

    if (!job || job.slug !== slug) {
      res
        .status(404)
        .json({ error: "No command job found for this repository." });
      return;
    }
    res.json(job);
  });
}

async function applyStatusUpdate(
  slug: string,
  findingId: string,
  status: WorkDocumentStatus,
  note: string | undefined,
  wsHub: DashboardWebSocketHub,
): Promise<boolean> {
  const doc = await loadWorkDocument(slug, findingId);
  if (!doc) return false;

  doc.status = status;
  if (status === "resolved") doc.resolvedAt = new Date().toISOString();
  if (note && note.length > 0) addNote(doc, "dashboard", sanitizeNote(note));

  await saveWorkDocument(slug, doc);
  wsHub.broadcast({
    type: "work-update",
    slug,
    payload: { findingId: doc.findingId, status: doc.status },
  });
  return true;
}

function registerWorkRoutes(
  router: Router,
  wsHub: DashboardWebSocketHub,
): void {
  router.post("/repo/:slug/work/:findingId/status", async (req, res) => {
    const slug = await ensureValidSlug(req, res);
    if (!slug) return;

    const parsed = statusSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request body" });
      return;
    }

    const updated = await applyStatusUpdate(
      slug,
      String(req.params.findingId ?? ""),
      parsed.data.status,
      parsed.data.note,
      wsHub,
    );

    if (!updated) {
      res.status(404).json({ error: "Unknown work document" });
      return;
    }
    res.json({ ok: true });
  });

  router.post("/repo/:slug/work/:findingId/note", async (req, res) => {
    const slug = await ensureValidSlug(req, res);
    if (!slug) return;

    const parsed = noteSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request body" });
      return;
    }

    const doc = await loadWorkDocument(
      slug,
      String(req.params.findingId ?? ""),
    );
    if (!doc) {
      res.status(404).json({ error: "Unknown work document" });
      return;
    }

    addNote(doc, "dashboard", sanitizeNote(parsed.data.text));
    await saveWorkDocument(slug, doc);
    res.json({ ok: true, notes: doc.notes });
  });

  router.post("/repo/:slug/work/bulk-status", async (req, res) => {
    const slug = await ensureValidSlug(req, res);
    if (!slug) return;

    const parsed = bulkSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request body" });
      return;
    }

    const updated: string[] = [];
    for (const findingId of parsed.data.findingIds) {
      const ok = await applyStatusUpdate(
        slug,
        findingId,
        parsed.data.status,
        parsed.data.note,
        wsHub,
      );
      if (ok) updated.push(findingId);
    }

    res.json({ ok: true, updatedCount: updated.length, findingIds: updated });
  });
}

function registerFindingsRoute(router: Router): void {
  router.get("/repo/:slug/findings", async (req, res) => {
    const slug = await ensureValidSlug(req, res);
    if (!slug) return;

    const report = await loadLatestReport(slug);
    if (!report) {
      res.json({ findings: [] });
      return;
    }

    const workDocs = await loadWorkDocuments(slug);
    const statusByWorkId = new Map(
      workDocs.map((doc) => [doc.findingId, doc.status]),
    );
    const metricFilter =
      typeof req.query.metric === "string" ? req.query.metric : "";
    const severityFilter =
      typeof req.query.severity === "string" ? req.query.severity : "";
    const statusFilter =
      typeof req.query.status === "string" ? req.query.status : "";
    const searchText =
      typeof req.query.q === "string" ? req.query.q.trim().toLowerCase() : "";
    const sortBy =
      typeof req.query.sort === "string" ? req.query.sort : "severity";

    const findings = report.findings
      .filter((finding) => {
        const status = finding.workDocumentId
          ? (statusByWorkId.get(finding.workDocumentId) ?? "unassigned")
          : "unassigned";
        if (metricFilter && finding.metric !== metricFilter) return false;
        if (severityFilter && finding.severity !== severityFilter) return false;
        if (statusFilter && status !== statusFilter) return false;
        if (searchText.length === 0) return true;
        return `${finding.summary} ${finding.path ?? ""}`
          .toLowerCase()
          .includes(searchText);
      })
      .sort((left, right) => {
        if (sortBy === "path")
          return (left.path ?? "").localeCompare(right.path ?? "");
        if (sortBy === "consecutive")
          return right.consecutiveReports - left.consecutiveReports;
        if (sortBy === "severity")
          return SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity];
        return `${left.code}-${left.path ?? ""}`.localeCompare(
          `${right.code}-${right.path ?? ""}`,
        );
      });

    res.json({ findings });
  });
}

export function createDashboardApiRouter(
  commandRunner: CommandRunner,
  wsHub: DashboardWebSocketHub,
): Router {
  const router = Router();
  registerCommandRoutes(router, commandRunner);
  registerWorkRoutes(router, wsHub);
  registerFindingsRoute(router);
  return router;
}
