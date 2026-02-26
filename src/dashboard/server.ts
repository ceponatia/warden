import express from "express";
import { fileURLToPath } from "node:url";

import { registerDashboardRoutes } from "./routes.js";

export interface DashboardServerOptions {
  port?: number;
}

export async function startDashboardServer(
  options: DashboardServerOptions = {},
): Promise<void> {
  const app = express();
  app.use(express.urlencoded({ extended: true }));
  const staticDir = fileURLToPath(new URL("./public", import.meta.url));
  app.use("/static", express.static(staticDir));

  registerDashboardRoutes(app);

  const port = options.port ?? 3333;
  await new Promise<void>((resolve, reject) => {
    const server = app.listen(port, () => {
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
