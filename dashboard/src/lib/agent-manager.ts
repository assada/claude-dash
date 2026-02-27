import WebSocket from "ws";
import type { AgentMessage, SessionInfo, ServerMetrics, ServerStatus } from "./types";

export interface ServerConfig {
  id: string;
  name: string;
  host: string;
  port: number;
  token: string;
}

type StateCallback = (servers: ServerStatus[]) => void;

class AgentConnection {
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 1000;
  private maxReconnectDelay = 30000;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private lastMessageAt = 0;

  public online = false;
  public hostname?: string;
  public os?: string;
  public agentVersion?: string;
  public dirs?: string[];
  public sessions: SessionInfo[] = [];
  public metrics?: ServerMetrics;

  constructor(
    public config: ServerConfig,
    private onUpdate: () => void
  ) {}

  private get wsUrl(): string {
    return `ws://${this.config.host}:${this.config.port}/ws?token=${encodeURIComponent(this.config.token)}`;
  }

  connect() {
    if (this.ws) {
      try {
        this.ws.close();
      } catch {} // already dead socket
    }

    try {
      this.ws = new WebSocket(this.wsUrl);
    } catch (e) {
      console.warn(`[agent] Failed to create WebSocket for ${this.config.name}:`, (e as Error).message);
      this.scheduleReconnect();
      return;
    }

    this.ws.on("open", () => {
      this.online = true;
      this.reconnectDelay = 1000;
      this.lastMessageAt = Date.now();
      this.startHeartbeat();
      this.send({ type: "machine_info" });
      this.onUpdate();
    });

    this.ws.on("message", (data) => {
      this.lastMessageAt = Date.now();
      try {
        const msg: AgentMessage = JSON.parse(data.toString());
        this.handleMessage(msg);
      } catch (e) {
        console.warn(`[agent] Failed to parse message from ${this.config.name}:`, (e as Error).message);
      }
    });

    this.ws.on("close", (code, reason) => {
      console.log(`[agent] ${this.config.name}: WS closed (code=${code}, reason=${reason})`);
      this.stopHeartbeat();
      this.online = false;
      this.ws = null;
      this.sessions = this.sessions.map((s) => ({
        ...s,
        state: "dead" as const,
        state_changed_at: Date.now(),
      }));
      this.onUpdate();
      this.scheduleReconnect();
    });

    this.ws.on("error", (err) => {
      console.error(`[agent] ${this.config.name}: WS error:`, (err as Error).message);
      this.stopHeartbeat();
      this.online = false;
      this.ws = null;
      this.sessions = this.sessions.map((s) => ({
        ...s,
        state: "dead" as const,
        state_changed_at: Date.now(),
      }));
      this.onUpdate();
      this.scheduleReconnect();
    });
  }

  private handleMessage(msg: AgentMessage) {
    switch (msg.type) {
      case "sessions":
        if (msg.sessions) {
          console.log(`[agent] ${this.config.name}: received ${msg.sessions.length} sessions: [${msg.sessions.map(s => `${s.id}(${s.state})`).join(", ")}]`);
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
        this.agentVersion = msg.version;
        this.dirs = msg.dirs;
        if (msg.mem_total && msg.mem_total > 0) {
          this.metrics = {
            cpuPercent: msg.cpu_percent ?? 0,
            memTotal: msg.mem_total,
            memUsed: msg.mem_used ?? 0,
            diskTotal: msg.disk_total ?? 0,
            diskUsed: msg.disk_used ?? 0,
            uptimeSecs: msg.uptime_secs ?? 0,
            loadAvg: msg.load_avg ?? 0,
          };
        }
        this.onUpdate();
        break;
    }
  }

  send(msg: Record<string, unknown>) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    } else {
      console.warn(`[agent] send failed for ${this.config.name}: ws=${this.ws ? "exists" : "null"} readyState=${this.ws?.readyState}`);
    }
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    console.log(`[agent] ${this.config.name}: heartbeat started, lastMessageAt=${this.lastMessageAt}`);
    this.heartbeatTimer = setInterval(() => {
      const now = Date.now();
      const silentMs = now - this.lastMessageAt;
      if (silentMs > 2000) {
        console.log(`[heartbeat] ${this.config.name}: silent ${(silentMs / 1000).toFixed(1)}s, ws=${this.ws ? "exists" : "null"}, readyState=${this.ws?.readyState}`);
      }
      if (silentMs > 5000) {
        console.warn(`[agent] ${this.config.name}: zombie detected, closing WS`);
        this.stopHeartbeat();
        this.ws?.close();
      }
    }, 3000);
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    console.log(`[agent] ${this.config.name}: reconnecting in ${this.reconnectDelay}ms`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, this.reconnectDelay);
    this.reconnectDelay = Math.min(
      this.reconnectDelay * 2,
      this.maxReconnectDelay
    );
  }

  forceReconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectDelay = 1000;
    this.connect();
  }

  disconnect() {
    this.stopHeartbeat();
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

  createTerminalProxy(
    sessionId: string,
    onOutput: (data: string) => void,
    onError: (msg: string) => void,
    cols?: number,
    rows?: number
  ): {
    sendInput: (data: string) => void;
    resize: (cols: number, rows: number) => void;
    detach: () => void;
    close: () => void;
  } {
    console.log(`[terminal-proxy] connecting to ${this.config.host}:${this.config.port} for session ${sessionId}`);
    const termWs = new WebSocket(this.wsUrl);

    termWs.on("open", () => {
      console.log(`[terminal-proxy] connected, sending attach for ${sessionId}`);
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
        } else if (msg.type === "error" && msg.message) {
          onError(msg.message);
        }
      } catch (e) {
        console.warn(`[terminal-proxy] Failed to parse message:`, (e as Error).message);
      }
    });

    termWs.on("close", (code, reason) => {
      console.log(`[terminal-proxy] closed code=${code} reason=${reason}`);
    });
    termWs.on("error", (err) => {
      console.error(`[terminal-proxy] error:`, err.message);
    });

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
}

// Key format: "userId:serverId"
function connKey(userId: string, serverId: string) {
  return `${userId}:${serverId}`;
}

const CLEANUP_DELAY_MS = 5 * 60 * 1000; // 5 minutes

class AgentManager {
  private connections = new Map<string, AgentConnection>();
  // Per-user state callbacks: userId -> callbacks[]
  private userCallbacks = new Map<string, StateCallback[]>();
  // Per-user WS count for lazy cleanup
  private userWsCount = new Map<string, number>();
  // Per-user cleanup timers
  private cleanupTimers = new Map<string, ReturnType<typeof setTimeout>>();

  /**
   * Connect to servers for a user. Called when a WebSocket connects.
   * Adds new connections, removes ones for servers no longer in the list.
   */
  ensureUserConnections(userId: string, servers: ServerConfig[]) {
    const desiredKeys = new Set(servers.map((s) => connKey(userId, s.id)));

    // Remove connections for servers no longer in the user's list
    for (const [key, conn] of this.connections) {
      if (key.startsWith(`${userId}:`) && !desiredKeys.has(key)) {
        for (const session of conn.sessions) {
          if (session.state !== "dead") {
            conn.send({ type: "kill_session", session_id: session.id });
          }
        }
        conn.disconnect();
        this.connections.delete(key);
      }
    }

    // Add/update connections
    for (const server of servers) {
      const key = connKey(userId, server.id);
      const existing = this.connections.get(key);

      if (!existing) {
        const conn = new AgentConnection(server, () =>
          this.notifyUser(userId)
        );
        this.connections.set(key, conn);
        conn.connect();
      } else if (
        existing.config.host !== server.host ||
        existing.config.port !== server.port ||
        existing.config.token !== server.token ||
        existing.config.name !== server.name
      ) {
        existing.disconnect();
        const conn = new AgentConnection(server, () =>
          this.notifyUser(userId)
        );
        this.connections.set(key, conn);
        conn.connect();
      } else if (!existing.online) {
        // Existing connection is offline — force immediate reconnect
        existing.forceReconnect();
      }
    }

    // Cancel any pending cleanup
    this.cancelUserCleanup(userId);
  }

  /**
   * Disconnect all servers for a user (called after cleanup timer fires).
   */
  private disconnectUser(userId: string) {
    for (const [key, conn] of this.connections) {
      if (key.startsWith(`${userId}:`)) {
        conn.disconnect();
        this.connections.delete(key);
      }
    }
    this.userCallbacks.delete(userId);
  }

  /**
   * Get server statuses for a specific user.
   */
  getServersForUser(userId: string): ServerStatus[] {
    const servers: ServerStatus[] = [];
    for (const [key, conn] of this.connections) {
      if (key.startsWith(`${userId}:`)) {
        servers.push({
          id: conn.config.id,
          name: conn.config.name,
          host: conn.config.host,
          port: conn.config.port,
          online: conn.online,
          hostname: conn.hostname,
          os: conn.os,
          agentVersion: conn.agentVersion,
          dirs: conn.dirs,
          sessions: conn.sessions,
          metrics: conn.metrics,
        });
      }
    }
    return servers;
  }

  getConnection(userId: string, serverId: string): AgentConnection | undefined {
    return this.connections.get(connKey(userId, serverId));
  }

  /**
   * Subscribe to state changes for a specific user.
   */
  onUserStateChange(userId: string, cb: StateCallback): () => void {
    const cbs = this.userCallbacks.get(userId) || [];
    cbs.push(cb);
    this.userCallbacks.set(userId, cbs);
    return () => {
      const arr = this.userCallbacks.get(userId);
      if (arr) {
        this.userCallbacks.set(
          userId,
          arr.filter((c) => c !== cb)
        );
      }
    };
  }

  private notifyUser(userId: string) {
    const servers = this.getServersForUser(userId);
    const cbs = this.userCallbacks.get(userId) || [];
    for (const cb of cbs) {
      cb(servers);
    }
  }

  /**
   * Track WebSocket connections per user for lazy cleanup.
   */
  trackUserConnect(userId: string) {
    this.userWsCount.set(userId, (this.userWsCount.get(userId) || 0) + 1);
    this.cancelUserCleanup(userId);
  }

  trackUserDisconnect(userId: string) {
    const count = (this.userWsCount.get(userId) || 1) - 1;
    this.userWsCount.set(userId, count);
    if (count <= 0) {
      this.userWsCount.set(userId, 0);
      this.scheduleUserCleanup(userId);
    }
  }

  private scheduleUserCleanup(userId: string) {
    if (this.cleanupTimers.has(userId)) return;
    const timer = setTimeout(() => {
      this.cleanupTimers.delete(userId);
      // Double-check no active connections
      if ((this.userWsCount.get(userId) || 0) <= 0) {
        console.log(`[cleanup] Disconnecting idle user ${userId}`);
        this.disconnectUser(userId);
      }
    }, CLEANUP_DELAY_MS);
    this.cleanupTimers.set(userId, timer);
  }

  cancelUserCleanup(userId: string) {
    const timer = this.cleanupTimers.get(userId);
    if (timer) {
      clearTimeout(timer);
      this.cleanupTimers.delete(userId);
    }
  }

  createSession(
    userId: string,
    serverId: string,
    workdir: string,
    name: string,
    dangerouslySkipPermissions?: boolean
  ) {
    const conn = this.connections.get(connKey(userId, serverId));
    if (!conn) return;
    conn.send({
      type: "create_session",
      workdir,
      name,
      dangerously_skip_permissions: dangerouslySkipPermissions || false,
    });
  }

  killSession(userId: string, serverId: string, sessionId: string) {
    const conn = this.connections.get(connKey(userId, serverId));
    if (!conn) {
      console.warn(`[agent-manager] killSession: no connection for ${connKey(userId, serverId)}`);
      return;
    }
    console.log(`[agent-manager] killSession: sending kill_session for ${sessionId} to ${serverId}`);
    conn.send({ type: "kill_session", session_id: sessionId });
    // Optimistically remove session from local state
    conn.sessions = conn.sessions.filter((s) => s.id !== sessionId);
    this.notifyUser(userId);
  }

  updateAgent(userId: string, serverId: string) {
    const conn = this.connections.get(connKey(userId, serverId));
    if (!conn) return;
    conn.send({ type: "self_update" });
  }
}

// Singleton shared across module boundaries
const GLOBAL_KEY = Symbol.for("agentManager");
const g = globalThis as Record<symbol, unknown>;
if (!g[GLOBAL_KEY]) {
  g[GLOBAL_KEY] = new AgentManager();
}
export const agentManager = g[GLOBAL_KEY] as AgentManager;
