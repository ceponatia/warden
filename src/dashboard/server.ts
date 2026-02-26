import express from "express";
import path from "node:path";

import { registerDashboardRoutes } from "./routes.js";

export interface DashboardServerOptions {
  port?: number;
}

export async function startDashboardServer(
  options: DashboardServerOptions = {},
): Promise<void> {
  const app = express();
  app.use(express.urlencoded({ extended: true }));
  app.use(
    "/static",
    express.static(path.resolve(process.cwd(), "src", "dashboard", "public")),
  );

  registerDashboardRoutes(app);

  const port = options.port ?? 3333;
  await new Promise<void>((resolve) => {
    app.listen(port, () => {
      process.stdout.write(
        `Warden dashboard running at http://localhost:${port}\n`,
      );
      resolve();
    });
  });
}
