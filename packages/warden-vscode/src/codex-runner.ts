import * as vscode from "vscode";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";

type PendingTurn = {
  resolve: (message: string | null) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

export class CodexRunner {
  private child: ChildProcessWithoutNullStreams | null = null;
  private rpc: JsonRpcClient | null = null;
  private threadId: string | null = null;
  private turnId: string | null = null;
  private readyPromise: Promise<void> | null = null;
  private readonly cwd: string;
  private pendingTurns = new Map<string, PendingTurn>();

  constructor(
    private readonly output: vscode.OutputChannel,
    cwd: string,
  ) {
    this.cwd = cwd;
  }

  dispose(): void {
    this.child?.kill("SIGINT");
    this.child = null;
    this.rpc = null;
    this.threadId = null;
    this.turnId = null;
    this.readyPromise = null;
    this.rejectAllPending(new Error("Codex runner disposed."));
  }

  async sendPrompt(prompt: string): Promise<string | null> {
    await this.ensureReady();
    if (!this.rpc || !this.threadId) {
      throw new Error("Codex app-server not ready.");
    }
    this.output.appendLine("[codex] sending prompt");
    const result = await this.rpc.request<Record<string, unknown>>(
      "turn/start",
      {
        threadId: this.threadId,
        thread_id: this.threadId,
        input: [{ type: "text", text: prompt }],
        cwd: this.cwd,
        approval_policy: "on-request",
        sandbox_policy: "workspace-write",
      },
    );
    const turnIdRaw = result.turn_id ?? result.turnId;
    if (typeof turnIdRaw !== "string") {
      return null;
    }
    const turnId = turnIdRaw;
    this.turnId = turnId;
    this.output.appendLine(`[codex] turn started id=${turnId}`);

    return new Promise<string | null>((resolve, reject) => {
      const timeout = setTimeout(
        () => {
          const pending = this.pendingTurns.get(turnId);
          if (!pending) return;
          this.pendingTurns.delete(turnId);
          pending.resolve(null);
        },
        5 * 60 * 1000,
      );

      this.pendingTurns.set(turnId, { resolve, reject, timeout });
    });
  }

  private async ensureReady(): Promise<void> {
    if (this.readyPromise) return this.readyPromise;
    this.readyPromise = this.start();
    return this.readyPromise;
  }

  // Rationale: startup coordinates process lifecycle, RPC init, auth checks, and thread bootstrap in one control path.
  // eslint-disable-next-line complexity
  private async start(): Promise<void> {
    this.output.appendLine("[codex] starting app-server");
    const child = spawn("npx", ["-y", "@openai/codex@latest", "app-server"], {
      cwd: this.cwd,
      env: {
        NODE_NO_WARNINGS: "1",
        NO_COLOR: "1",
        RUST_LOG: "error",
        ...process.env,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child = child;

    child.on("exit", (code, signal) => {
      this.output.appendLine(
        `[codex] exited code=${code ?? "null"} signal=${signal ?? "null"}`,
      );
      this.child = null;
      this.rpc = null;
      this.threadId = null;
      this.turnId = null;
      this.readyPromise = null;
      this.rejectAllPending(
        new Error(
          `Codex app-server exited (code=${code ?? "null"}, signal=${signal ?? "null"}).`,
        ),
      );
    });

    const stdoutRl = createInterface({ input: child.stdout });
    const stderrRl = createInterface({ input: child.stderr });
    stdoutRl.on("line", (line) => {
      this.output.appendLine(`[codex] ${sanitizeCodexLine(line)}`);
      this.rpc?.handleLine(line);
    });
    stderrRl.on("line", (line) =>
      this.output.appendLine(`[codex:err] ${line}`),
    );

    const rpc = new JsonRpcClient(
      (line) => child.stdin.write(`${line}\n`),
      (msg) => this.handleRpcMessage(msg),
    );
    this.rpc = rpc;

    await rpc.request("initialize", {
      clientInfo: { name: "viz-vibe", version: "0.1.50" },
    });
    rpc.notify("initialized", {});

    const auth = await rpc.request<Record<string, unknown>>("getAuthStatus", {
      includeToken: true,
      refreshToken: false,
    });
    const requiresAuth =
      (auth.requires_openai_auth ?? auth.requiresOpenaiAuth ?? true) === true;
    const authMethod = auth.auth_method ?? auth.authMethod;
    if (requiresAuth && !authMethod) {
      throw new Error("Codex authentication required");
    }

    const thread = await rpc.request<Record<string, unknown>>("thread/start", {
      cwd: this.cwd,
      approval_policy: "on-request",
      sandbox_policy: "workspace-write",
    });
    const nestedThread =
      thread.thread && typeof thread.thread === "object"
        ? (thread.thread as Record<string, unknown>)
        : {};
    const threadId =
      thread.thread_id ??
      thread.threadId ??
      nestedThread.id ??
      nestedThread.thread_id ??
      nestedThread.threadId;
    if (!threadId) {
      throw new Error("Codex missing thread id");
    }
    if (typeof threadId !== "string") {
      throw new Error("Codex missing thread id");
    }
    this.threadId = threadId;
    this.output.appendLine(`[codex] ready thread=${threadId}`);
  }

  // Rationale: RPC handlers are centralized here so all protocol event routing is visible in one place.
  // eslint-disable-next-line complexity
  private handleRpcMessage(msg: Record<string, unknown>): void {
    const method = typeof msg.method === "string" ? msg.method : undefined;
    if (method === "codex/event/task_complete") {
      const params =
        msg.params && typeof msg.params === "object"
          ? (msg.params as Record<string, unknown>)
          : {};
      const nested =
        params.msg && typeof params.msg === "object"
          ? (params.msg as Record<string, unknown>)
          : {};
      const turnId = params.id ?? nested.turn_id;
      const response = nested.last_agent_message;
      this.resolvePendingTurn(
        turnId,
        typeof response === "string" ? response : null,
      );
      return;
    }

    if (method === "codex/event/error") {
      const params =
        msg.params && typeof msg.params === "object"
          ? (msg.params as Record<string, unknown>)
          : {};
      const nested =
        params.msg && typeof params.msg === "object"
          ? (params.msg as Record<string, unknown>)
          : {};
      const turnId = params.id ?? nested.turn_id;
      const message = nested.message;
      if (typeof message === "string") {
        this.rejectPendingTurn(turnId, new Error(message));
      }
      return;
    }

    if (method === "turn/completed") {
      const params =
        msg.params && typeof msg.params === "object"
          ? (msg.params as Record<string, unknown>)
          : {};
      const turn =
        params.turn && typeof params.turn === "object"
          ? (params.turn as Record<string, unknown>)
          : null;
      const status = turn?.status;
      if (status === "failed") {
        const errorObj =
          turn?.error && typeof turn.error === "object"
            ? (turn.error as Record<string, unknown>)
            : {};
        this.rejectPendingTurn(
          turn?.id,
          new Error(
            typeof errorObj.message === "string"
              ? errorObj.message
              : "Codex turn failed.",
          ),
        );
      }
    }
  }

  private resolvePendingTurn(turnId: unknown, message: string | null): void {
    if (typeof turnId !== "string") return;
    const pending = this.pendingTurns.get(turnId);
    if (!pending) return;
    clearTimeout(pending.timeout);
    this.pendingTurns.delete(turnId);
    pending.resolve(message);
  }

  private rejectPendingTurn(turnId: unknown, error: Error): void {
    if (typeof turnId !== "string") return;
    const pending = this.pendingTurns.get(turnId);
    if (!pending) return;
    clearTimeout(pending.timeout);
    this.pendingTurns.delete(turnId);
    pending.reject(error);
  }

  private rejectAllPending(error: Error): void {
    for (const pending of this.pendingTurns.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pendingTurns.clear();
  }
}

class JsonRpcClient {
  private nextId = 1;
  private pending = new Map<
    string,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();

  constructor(
    private write: (line: string) => void,
    private onMessage: (msg: Record<string, unknown>) => void,
  ) {}

  request<T = unknown>(method: string, params?: unknown): Promise<T> {
    const id = String(this.nextId++);
    const payload = { jsonrpc: "2.0", id, method, params };
    this.write(JSON.stringify(payload));
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
      });
    });
  }

  notify(method: string, params?: unknown) {
    const payload = { jsonrpc: "2.0", method, params };
    this.write(JSON.stringify(payload));
  }

  handleLine(line: string) {
    const msg = safeJsonParse(line);
    if (!msg) return;

    if (typeof msg !== "object") return;
    const message = msg as Record<string, unknown>;

    if (message.id !== undefined && message.method) {
      this.onMessage(message);
      return;
    }

    if (message.id !== undefined) {
      const key = String(message.id);
      const pending = this.pending.get(key);
      if (!pending) return;
      this.pending.delete(key);

      if (message.error && typeof message.error === "object") {
        const errorObj = message.error as Record<string, unknown>;
        pending.reject(
          new Error(
            typeof errorObj.message === "string"
              ? errorObj.message
              : "JSON-RPC error",
          ),
        );
      } else {
        pending.resolve(message.result as unknown);
      }
      return;
    }

    if (message.method) {
      this.onMessage(message);
    }
  }
}

function safeJsonParse(line: string): unknown | null {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function sanitizeCodexLine(line: string): string {
  const msg = safeJsonParse(line);
  if (!msg || typeof msg !== "object") return line;
  const cloned = JSON.parse(JSON.stringify(msg));
  if (cloned?.result?.authToken) {
    cloned.result.authToken = "[redacted]";
  }
  if (cloned?.result?.auth_token) {
    cloned.result.auth_token = "[redacted]";
  }
  return JSON.stringify(cloned);
}
