import { startDashboardServer } from "../../dashboard/server.js";

export async function runDashboardCommand(portArg?: string): Promise<void> {
  const port = portArg ? Number(portArg) : 3333;
  if (!Number.isFinite(port) || port <= 0) {
    throw new Error("Invalid --port value. Expected a positive number.");
  }

  await startDashboardServer({ port });
}
