import express from "express";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";

import { createDashboardApiRouter } from "./api.js";
import { CommandRunner } from "./command-runner.js";
import { registerDashboardRoutes } from "./routes.js";
import { DashboardWebSocketHub } from "./websocket.js";
import { loadRepoConfigs } from "../config/loader.js";

export interface DashboardServerOptions {
  port?: number;
}

export async function startDashboardServer(
  options: DashboardServerOptions = {},
): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  const staticDir = fileURLToPath(new URL("./public", import.meta.url));
  app.use("/static", express.static(staticDir));

  const repoConfigs = await loadRepoConfigs();
  const validSlugs = new Set(repoConfigs.map((repo) => repo.slug));
  const commandRunner = new CommandRunner();
  registerDashboardRoutes(app);
  const server = createServer(app);
  const wsHub = new DashboardWebSocketHub(server, (slug) =>
    validSlugs.has(slug),
  );

  commandRunner.on("output", (job, line) => {
    wsHub.broadcast({
      type: "command-output",
      slug: job.slug,
      payload: { jobId: job.id, line },
    });
  });

  commandRunner.on("complete", (job) => {
    wsHub.broadcast({
      type: "command-complete",
      slug: job.slug,
      payload: { jobId: job.id, exitCode: job.exitCode ?? 1 },
    });

    if (job.command === "collect") {
      wsHub.broadcast({
        type: "snapshot-ready",
        slug: job.slug,
        payload: { timestamp: new Date().toISOString() },
      });
    }
    if (job.command === "analyze") {
      wsHub.broadcast({
        type: "analysis-ready",
        slug: job.slug,
        payload: { timestamp: new Date().toISOString() },
      });
    }
  });

  app.use("/api", createDashboardApiRouter(commandRunner, wsHub));
  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "API route not found" });
  });

  const port = options.port ?? 3333;
  await new Promise<void>((resolve, reject) => {
    server.listen(port, () => {
      process.stdout.write(
        `Warden dashboard running at http://localhost:${port}\n`,
      );
      resolve();
    });

    server.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        reject(
          new Error(
            `Failed to start Warden dashboard: port ${port} is already in use.`,
          ),
        );
      } else {
        reject(err);
      }
    });
  });
}
