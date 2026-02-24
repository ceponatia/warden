import { startMcpServer } from "../../mcp/server.js";

function toPort(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid --port value: ${value}`);
  }

  return parsed;
}

export async function runMcpCommand(
  transportArg?: string,
  portArg?: string,
): Promise<void> {
  const transport = transportArg === "sse" ? "sse" : "stdio";
  const port = toPort(portArg) ?? 3001;
  await startMcpServer(transport, port);
}
