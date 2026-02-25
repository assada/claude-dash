import WebSocket from "ws";
import { loadConfig, type ServerConfig } from "./config";
import type { AgentMessage, SessionInfo, ServerStatus } from "./types";

type StateCallback = (servers: ServerStatus[]) => void;

class AgentConnection {
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 1000;
  private maxReconnectDelay = 30000;

  public online = false;
  public hostname?: string;
  public os?: string;
  public dirs?: string[];
  public sessions: SessionInfo[] = [];

  constructor(
    public config: ServerConfig,
    private onUpdate: () => void
  ) {}

  connect() {
    if (this.ws) {
      try {
        this.ws.close();
      } catch {}
    }

    const url = `ws://${this.config.host}:${this.config.port}/ws?token=${encodeURIComponent(this.config.token)}`;

    try {
      this.ws = new WebSocket(url);
    } catch {
      this.scheduleReconnect();
      return;
    }

    this.ws.on("open", () => {
      this.online = true;
      this.reconnectDelay = 1000;
      // Request machine info
      this.send({ type: "machine_info" });
      this.onUpdate();
    });

    this.ws.on("message", (data) => {
      try {
        const msg: AgentMessage = JSON.parse(data.toString());
        this.handleMessage(msg);
      } catch {}
    });

    this.ws.on("close", () => {
      this.online = false;
      this.ws = null;
      this.onUpdate();
      this.scheduleReconnect();
    });

    this.ws.on("error", () => {
      this.online = false;
      this.ws = null;
      this.onUpdate();
      this.scheduleReconnect();
    });
  }

  private handleMessage(msg: AgentMessage) {
    switch (msg.type) {
      case "sessions":
        if (msg.sessions) {
          this.sessions = msg.sessions.map((s) => ({
            ...s,
            serverId: this.config.id,
            serverName: this.config.name,
          }));
          this.onUpdate();
        }
        break;

      case "machine_info":
        this.hostname = msg.hostname;
        this.os = msg.os;
        this.dirs = msg.dirs;
        this.onUpdate();
        break;
    }
  }

  send(msg: Record<string, unknown>) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, this.reconnectDelay);
    this.reconnectDelay = Math.min(
      this.reconnectDelay * 2,
      this.maxReconnectDelay
    );
  }

  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.online = false;
  }

  // Create a terminal proxy: agent WS ↔ browser WS
  createTerminalProxy(
    sessionId: string,
    onOutput: (data: string) => void,
    onScrollback: (data: string) => void,
    onError: (msg: string) => void,
    cols?: number,
    rows?: number
  ): {
    sendInput: (data: string) => void;
    resize: (cols: number, rows: number) => void;
    detach: () => void;
    close: () => void;
  } {
    const url = `ws://${this.config.host}:${this.config.port}/ws?token=${encodeURIComponent(this.config.token)}`;
    const termWs = new WebSocket(url);

    termWs.on("open", () => {
      // Attach to session
      termWs.send(
        JSON.stringify({
          type: "attach",
          session_id: sessionId,
          cols: cols || 200,
          rows: rows || 50,
        })
      );
    });

    termWs.on("message", (data) => {
      try {
        const msg: AgentMessage = JSON.parse(data.toString());
        if (msg.type === "output" && msg.data) {
          onOutput(msg.data);
        } else if (msg.type === "scrollback" && msg.data) {
          onScrollback(msg.data);
        } else if (msg.type === "error" && msg.message) {
          onError(msg.message);
        }
      } catch {}
    });

    termWs.on("close", () => {});
    termWs.on("error", () => {});

    return {
      sendInput: (data: string) => {
        if (termWs.readyState === WebSocket.OPEN) {
          termWs.send(JSON.stringify({ type: "input", data }));
        }
      },
      resize: (cols: number, rows: number) => {
        if (termWs.readyState === WebSocket.OPEN) {
          termWs.send(JSON.stringify({ type: "resize", cols, rows }));
        }
      },
      detach: () => {
        if (termWs.readyState === WebSocket.OPEN) {
          termWs.send(JSON.stringify({ type: "detach" }));
        }
      },
      close: () => {
        termWs.close();
      },
    };
  }

  getScrollback(
    sessionId: string,
    callback: (data: string) => void
  ) {
    // Use the control connection to request scrollback
    const url = `ws://${this.config.host}:${this.config.port}/ws?token=${encodeURIComponent(this.config.token)}`;
    const sbWs = new WebSocket(url);

    sbWs.on("open", () => {
      sbWs.send(
        JSON.stringify({ type: "get_scrollback", session_id: sessionId })
      );
    });

    sbWs.on("message", (data) => {
      try {
        const msg: AgentMessage = JSON.parse(data.toString());
        if (msg.type === "scrollback" && msg.data) {
          callback(msg.data);
          sbWs.close();
        } else if (msg.type === "error") {
          sbWs.close();
        }
      } catch {}
    });

    sbWs.on("error", () => sbWs.close());
  }
}

class AgentManager {
  private connections = new Map<string, AgentConnection>();
  private stateCallbacks: StateCallback[] = [];
  private initialized = false;

  init() {
    if (this.initialized) return;
    this.initialized = true;
    this.refreshConnections();
  }

  refreshConnections() {
    const config = loadConfig();

    // Close removed servers
    for (const [id, conn] of this.connections) {
      if (!config.servers.find((s) => s.id === id)) {
        conn.disconnect();
        this.connections.delete(id);
      }
    }

    // Add/update servers
    for (const server of config.servers) {
      if (!this.connections.has(server.id)) {
        const conn = new AgentConnection(server, () => this.notifyState());
        this.connections.set(server.id, conn);
        conn.connect();
      }
    }
  }

  getServers(): ServerStatus[] {
    const servers: ServerStatus[] = [];
    for (const [id, conn] of this.connections) {
      servers.push({
        id,
        name: conn.config.name,
        host: conn.config.host,
        port: conn.config.port,
        online: conn.online,
        hostname: conn.hostname,
        os: conn.os,
        dirs: conn.dirs,
        sessions: conn.sessions,
      });
    }
    return servers;
  }

  getConnection(serverId: string): AgentConnection | undefined {
    return this.connections.get(serverId);
  }

  onStateChange(cb: StateCallback) {
    this.stateCallbacks.push(cb);
    return () => {
      this.stateCallbacks = this.stateCallbacks.filter((c) => c !== cb);
    };
  }

  private notifyState() {
    const servers = this.getServers();
    for (const cb of this.stateCallbacks) {
      cb(servers);
    }
  }

  createSession(serverId: string, workdir: string, name: string) {
    const conn = this.connections.get(serverId);
    if (!conn) return;
    conn.send({ type: "create_session", workdir, name });
  }

  killSession(serverId: string, sessionId: string) {
    const conn = this.connections.get(serverId);
    if (!conn) return;
    conn.send({ type: "kill_session", session_id: sessionId });
  }
}

// Singleton
export const agentManager = new AgentManager();
