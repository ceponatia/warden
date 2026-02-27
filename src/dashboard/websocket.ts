import type { Server } from "node:http";

import { WebSocket, WebSocketServer } from "ws";

export interface DashboardWsEvent {
  type:
    | "command-output"
    | "command-complete"
    | "snapshot-ready"
    | "analysis-ready"
    | "work-update";
  slug: string;
  payload: unknown;
}

interface SubscriptionMessage {
  type: "subscribe";
  slug: string;
}

interface ClientState {
  socket: WebSocket;
  subscriptions: Set<string>;
}

export class DashboardWebSocketHub {
  private readonly clients = new Set<ClientState>();
  private readonly wss: WebSocketServer;

  constructor(
    server: Server,
    private readonly isValidSlug: (slug: string) => boolean,
  ) {
    this.wss = new WebSocketServer({ server, path: "/ws", maxPayload: 64 * 1024 });
    this.wss.on("connection", (socket) => {
      const state: ClientState = { socket, subscriptions: new Set() };
      this.clients.add(state);

      socket.on("message", (raw) => {
        const msg = this.parseMessage(raw.toString("utf8"));
        if (!msg || msg.type !== "subscribe") {
          return;
        }
        if (!this.isValidSlug(msg.slug)) {
          return;
        }
        state.subscriptions.add(msg.slug);
      });

      socket.on("close", () => {
        this.clients.delete(state);
      });
    });
  }

  broadcast(event: DashboardWsEvent): void {
    const text = JSON.stringify(event);
    for (const state of this.clients) {
      if (!state.subscriptions.has(event.slug)) {
        continue;
      }
      if (state.socket.readyState !== WebSocket.OPEN) {
        continue;
      }
      state.socket.send(text);
    }
  }

  private parseMessage(raw: string): SubscriptionMessage | null {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== "object") {
        return null;
      }
      const candidate = parsed as Record<string, unknown>;
      if (
        candidate.type !== "subscribe" ||
        typeof candidate.slug !== "string"
      ) {
        return null;
      }
      return { type: "subscribe", slug: candidate.slug };
    } catch {
      return null;
    }
  }
}
