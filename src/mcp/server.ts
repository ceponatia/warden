import { createServer } from "node:http";

import {
  McpServer,
  ResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import * as z from "zod";

import { readResourceByUri } from "./resources.js";
import {
  toolAnalyze,
  toolCollect,
  toolGetPlan,
  toolGetWorkDoc,
  toolListPlans,
  toolListRepos,
  toolListWorkDocs,
  toolReport,
  toolSnapshotDiff,
  toolTrustScores,
  toolUpdateWorkStatus,
  toolWikiLookup,
} from "./tools.js";

function registerStaticResources(server: McpServer): void {
  server.registerResource(
    "warden-repos",
    "warden://repos",
    {
      description: "Registered repository configs",
      mimeType: "application/json",
    },
    async () => ({
      contents: [
        {
          uri: "warden://repos",
          text: await readResourceByUri("warden://repos"),
        },
      ],
    }),
  );

  server.registerResource(
    "warden-findings",
    "warden://findings",
    {
      description: "Finding code registry",
      mimeType: "application/json",
    },
    async () => ({
      contents: [
        {
          uri: "warden://findings",
          text: await readResourceByUri("warden://findings"),
        },
      ],
    }),
  );
}

function registerTemplatedResource(
  server: McpServer,
  name: string,
  template: string,
  description: string,
  mimeType: string,
  uriFactory: (variables: Record<string, string | string[]>) => string,
): void {
  server.registerResource(
    name,
    new ResourceTemplate(template, { list: undefined }),
    { description, mimeType },
    async (_uri, variables) => {
      const uri = uriFactory(variables);
      return {
        contents: [{ uri, text: await readResourceByUri(uri) }],
      };
    },
  );
}

function variableToString(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return value[0] ?? "";
  }

  return value ?? "";
}

function registerTemplatedResources(server: McpServer): void {
  registerTemplatedResource(
    server,
    "warden-repo-latest-snapshot",
    "warden://repos/{slug}/latest-snapshot",
    "Latest snapshot bundle for a repo",
    "application/json",
    (variables) =>
      `warden://repos/${variableToString(variables.slug)}/latest-snapshot`,
  );

  registerTemplatedResource(
    server,
    "warden-repo-latest-report",
    "warden://repos/{slug}/latest-report",
    "Latest report for a repo",
    "text/markdown",
    (variables) =>
      `warden://repos/${variableToString(variables.slug)}/latest-report`,
  );

  registerTemplatedResource(
    server,
    "warden-repo-snapshots",
    "warden://repos/{slug}/snapshots",
    "Snapshot timestamp list for a repo",
    "application/json",
    (variables) =>
      `warden://repos/${variableToString(variables.slug)}/snapshots`,
  );

  registerTemplatedResource(
    server,
    "warden-repo-github",
    "warden://repos/{slug}/github",
    "GitHub source metadata for a repo",
    "application/json",
    (variables) => `warden://repos/${variableToString(variables.slug)}/github`,
  );

  registerTemplatedResource(
    server,
    "warden-repo-pull-requests",
    "warden://repos/{slug}/pull-requests",
    "Recorded pull request history for a repo",
    "application/json",
    (variables) =>
      `warden://repos/${variableToString(variables.slug)}/pull-requests`,
  );

  registerTemplatedResource(
    server,
    "warden-wiki",
    "warden://wiki/{code}",
    "Wiki page for a finding code",
    "text/markdown",
    (variables) => `warden://wiki/${variableToString(variables.code)}`,
  );
}

function registerCoreTools(server: McpServer): void {
  server.registerTool(
    "warden_list_repos",
    { description: "List registered repos" },
    async () => ({ content: [{ type: "text", text: await toolListRepos() }] }),
  );

  server.registerTool(
    "warden_collect",
    {
      description: "Trigger collection for a repo",
      inputSchema: z.object({ repo: z.string().describe("Repo slug") }),
    },
    async ({ repo }) => ({
      content: [{ type: "text", text: await toolCollect(repo) }],
    }),
  );

  server.registerTool(
    "warden_analyze",
    {
      description: "Trigger analysis for a repo",
      inputSchema: z.object({ repo: z.string().describe("Repo slug") }),
    },
    async ({ repo }) => ({
      content: [{ type: "text", text: await toolAnalyze(repo) }],
    }),
  );

  server.registerTool(
    "warden_report",
    {
      description: "Generate report for a repo",
      inputSchema: z.object({ repo: z.string().describe("Repo slug") }),
    },
    async ({ repo }) => ({
      content: [{ type: "text", text: await toolReport(repo) }],
    }),
  );

  server.registerTool(
    "warden_wiki_lookup",
    {
      description: "Lookup finding wiki page",
      inputSchema: z.object({ code: z.string().describe("Finding code") }),
    },
    async ({ code }) => ({
      content: [{ type: "text", text: await toolWikiLookup(code) }],
    }),
  );

  server.registerTool(
    "warden_snapshot_diff",
    {
      description: "Compare two snapshots",
      inputSchema: z.object({
        repo: z.string().describe("Repo slug"),
        leftTimestamp: z
          .string()
          .optional()
          .describe("Older snapshot timestamp"),
        rightTimestamp: z
          .string()
          .optional()
          .describe("Newer snapshot timestamp"),
      }),
    },
    async ({ repo, leftTimestamp, rightTimestamp }) => ({
      content: [
        {
          type: "text",
          text: await toolSnapshotDiff(repo, leftTimestamp, rightTimestamp),
        },
      ],
    }),
  );
}

function registerWorkDocTools(server: McpServer): void {
  server.registerTool(
    "warden_list_work_docs",
    {
      description: "List active work documents for a repo",
      inputSchema: z.object({ repo: z.string().describe("Repo slug") }),
    },
    async ({ repo }) => ({
      content: [{ type: "text", text: await toolListWorkDocs(repo) }],
    }),
  );

  server.registerTool(
    "warden_get_work_doc",
    {
      description: "Get details of a specific work document",
      inputSchema: z.object({
        repo: z.string().describe("Repo slug"),
        findingId: z.string().describe("Work document finding ID"),
      }),
    },
    async ({ repo, findingId }) => ({
      content: [{ type: "text", text: await toolGetWorkDoc(repo, findingId) }],
    }),
  );

  server.registerTool(
    "warden_update_work_status",
    {
      description: "Update status/notes on a work document",
      inputSchema: z.object({
        repo: z.string().describe("Repo slug"),
        findingId: z.string().describe("Work document finding ID"),
        status: z.string().optional().describe("New status"),
        note: z.string().optional().describe("Note to add"),
      }),
    },
    async ({ repo, findingId, status, note }) => ({
      content: [
        {
          type: "text",
          text: await toolUpdateWorkStatus(repo, findingId, status, note),
        },
      ],
    }),
  );

  server.registerTool(
    "warden_list_plans",
    {
      description: "List generated plan documents for a repo",
      inputSchema: z.object({ repo: z.string().describe("Repo slug") }),
    },
    async ({ repo }) => ({
      content: [{ type: "text", text: await toolListPlans(repo) }],
    }),
  );

  server.registerTool(
    "warden_get_plan",
    {
      description: "Read a specific plan document",
      inputSchema: z.object({
        repo: z.string().describe("Repo slug"),
        findingId: z.string().describe("Finding ID for the plan"),
      }),
    },
    async ({ repo, findingId }) => ({
      content: [{ type: "text", text: await toolGetPlan(repo, findingId) }],
    }),
  );

  server.registerTool(
    "warden_trust_scores",
    {
      description: "Get trust metrics for all agents",
      inputSchema: z.object({ repo: z.string().describe("Repo slug") }),
    },
    async ({ repo }) => ({
      content: [{ type: "text", text: await toolTrustScores(repo) }],
    }),
  );
}

function createWardenMcpServer(): McpServer {
  const server = new McpServer({
    name: "warden-mcp",
    version: "0.1.0",
  });
  registerStaticResources(server);
  registerTemplatedResources(server);
  registerCoreTools(server);
  registerWorkDocTools(server);

  return server;
}

export async function startMcpServer(
  transport: "stdio" | "sse" = "stdio",
  port = 3001,
): Promise<void> {
  if (transport === "stdio") {
    const server = createWardenMcpServer();
    const stdio = new StdioServerTransport();
    await server.connect(stdio);
    process.stderr.write("Warden MCP server running on stdio\n");
    return;
  }

  const MAX_BODY_BYTES = 1 * 1024 * 1024; // 1 MiB
  const sharedServer = createWardenMcpServer();

  const httpServer = createServer(async (req, res) => {
    if (!req.url || req.url !== "/mcp") {
      res.statusCode = 404;
      res.end("Not found");
      return;
    }

    if (req.method !== "POST") {
      res.statusCode = 405;
      res.end("Method not allowed");
      return;
    }

    let raw = "";
    let overflow = false;
    req.on("data", (chunk) => {
      if (overflow) {
        return;
      }

      raw += chunk.toString();
      if (raw.length > MAX_BODY_BYTES) {
        overflow = true;
        res.statusCode = 413;
        res.end("Request body too large");
      }
    });

    req.on("end", async () => {
      if (overflow) {
        return;
      }

      try {
        const parsed = raw.trim().length > 0 ? JSON.parse(raw) : undefined;
        const streamable = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
        });

        await sharedServer.connect(streamable);
        await streamable.handleRequest(req, res, parsed);

        res.on("close", () => {
          void streamable.close();
        });
      } catch (error) {
        res.statusCode = 500;
        res.end(
          `MCP request failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    });
  });

  await new Promise<void>((resolve) => {
    httpServer.listen(port, () => resolve());
  });

  httpServer.on("close", () => {
    void sharedServer.close();
  });

  process.stderr.write(
    `Warden MCP server running on http://localhost:${port}/mcp\n`,
  );
}
