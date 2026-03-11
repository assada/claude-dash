import WebSocket from "ws";
import type { AgentMessage, SessionInfo, ServerMetrics, ServerStatus, ServerUsage, SessionUsage, SessionEvent } from "./types";
import { calculateEntryCost } from "./pricing";
import { prisma } from "./prisma";

export interface ServerConfig {
  id: string;
  name: string;
  host: string;
  port: number;
  token: string;
}

export type UpdateType = "sessions" | "metrics" | "server_info" | "usage" | "connectivity" | "session_event";
type StateCallback = (servers: ServerStatus[]) => void;
type TargetedCallback = (update: TargetedUpdate) => void;

export interface TargetedUpdate {
  type: UpdateType;
  serverId: string;
  sessions?: SessionInfo[];
  metrics?: ServerMetrics;
  serverInfo?: { hostname?: string; os?: string; agentVersion?: string; dirs?: string[] };
  usage?: ServerUsage;
  online?: boolean;
  sessionEvent?: SessionEvent | null;
}

class AgentConnection {
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 1000;
  private maxReconnectDelay = 30000;
  private static readonly STALE_TIMEOUT_MS = 15_000; // 3 missed 5s metric cycles

  public online = false;
  public hostname?: string;
  public os?: string;
  public agentVersion?: string;
  public dirs?: string[];
  public sessions: SessionInfo[] = [];
  public metrics?: ServerMetrics;
  public serverUsage?: ServerUsage;

  public lastSessionEvent: SessionEvent | null = null;
  private snapshotTimers = new Map<string, number>();

  constructor(
    public config: ServerConfig,
    private userId: string,
    private onEvent: (type: UpdateType) => void
  ) {}

  private get wsUrl(): string {
    return `ws://${this.config.host}:${this.config.port}/ws`;
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
      this.ws!.send(JSON.stringify({ type: "auth", data: this.config.token }));
      this.online = true;
      this.reconnectDelay = 1000;
      // Socket-level inactivity timeout — auto-resets on any received data
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const socket = (this.ws as any)?._socket;
      if (socket) {
        socket.setTimeout(AgentConnection.STALE_TIMEOUT_MS);
        socket.on("timeout", () => this.ws?.close());
      }
      this.send({ type: "machine_info" });
      this.loadUsageFromDB().catch((e) =>
        console.warn(`[agent] Failed to load usage from DB:`, (e as Error).message)
      );
      this.loadLatestSnapshots().catch((e) =>
        console.warn(`[agent] Failed to load snapshots from DB:`, (e as Error).message)
      );
      this.onEvent("connectivity");
    });

    this.ws.on("message", (data) => {
      try {
        const msg: AgentMessage = JSON.parse(data.toString());
        this.handleMessage(msg).catch((e) =>
          console.warn(`[agent] Error handling message from ${this.config.name}:`, (e as Error).message)
        );
      } catch (e) {
        console.warn(`[agent] Failed to parse message from ${this.config.name}:`, (e as Error).message);
      }
    });

    this.ws.on("close", () => {
      this.online = false;
      this.ws = null;
      this.sessions = this.sessions.map((s) => ({
        ...s,
        state: "dead" as const,
        state_changed_at: Date.now(),
      }));
      this.onEvent("connectivity");
      this.scheduleReconnect();
    });

    this.ws.on("error", () => {
      this.online = false;
      this.ws = null;
      this.sessions = this.sessions.map((s) => ({
        ...s,
        state: "dead" as const,
        state_changed_at: Date.now(),
      }));
      this.onEvent("connectivity");
      this.scheduleReconnect();
    });
  }

  private async handleMessage(msg: AgentMessage) {
    switch (msg.type) {
      case "sessions":
        if (msg.sessions) {
          this.sessions = msg.sessions.map((s) => ({
            ...s,
            serverId: this.config.id,
            serverName: this.config.name,
          }));
          this.onEvent("sessions");
        }
        break;

      case "usage_entries":
        if (msg.entries && msg.entries.length > 0) {
          const rows = msg.entries.map((e) => ({
            userId: this.userId,
            serverId: this.config.id,
            sessionId: e.session_id,
            requestId: e.request_id,
            uuid: e.uuid,
            timestamp: new Date(e.timestamp),
            model: e.model,
            workdir: e.workdir,
            inputTokens: e.input_tokens,
            outputTokens: e.output_tokens,
            cacheCreationInputTokens: e.cache_creation_input_tokens,
            cacheReadInputTokens: e.cache_read_input_tokens,
            cost: calculateEntryCost(e),
          }));
          const result = await prisma.usageEntry.createMany({
            data: rows,
            skipDuplicates: true,
          });
          if (result.count > 0) {
            await this.loadUsageFromDB();
            this.onEvent("usage");
          }
        }
        break;

      case "machine_info": {
        const infoChanged =
          this.hostname !== msg.hostname ||
          this.os !== msg.os ||
          this.agentVersion !== msg.version ||
          JSON.stringify(this.dirs) !== JSON.stringify(msg.dirs);
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
          this.onEvent("metrics");
        }
        if (infoChanged) {
          this.onEvent("server_info");
        }
        break;
      }

      case "session_state":
        this.handleSessionState(msg);
        this.onEvent("sessions");
        break;

      case "session_event":
        this.handleSessionEvent(msg);
        this.onEvent("session_event");
        break;

      case "session_created":
        if (msg.session_id && msg.claude_session_id && this.userId) {
          this.persistSession(msg).catch(console.error);
        }
        break;
    }
  }

  async loadUsageFromDB() {
    const aggregates = await prisma.usageEntry.groupBy({
      by: ["workdir"],
      where: { userId: this.userId, serverId: this.config.id },
      _sum: {
        cost: true,
        inputTokens: true,
        outputTokens: true,
        cacheCreationInputTokens: true,
        cacheReadInputTokens: true,
      },
      _count: true,
      _min: { timestamp: true },
      _max: { timestamp: true },
    });

    let totalCost = 0;
    let totalTokens = 0;
    const sessionUsages: Record<string, SessionUsage> = {};

    for (const agg of aggregates) {
      const s = agg._sum;
      const cost = s.cost ?? 0;
      totalCost += cost;
      const tokens =
        (s.inputTokens ?? 0) +
        (s.outputTokens ?? 0) +
        (s.cacheCreationInputTokens ?? 0) +
        (s.cacheReadInputTokens ?? 0);
      totalTokens += tokens;

      sessionUsages[agg.workdir] = {
        sessionId: agg.workdir,
        totalCost: cost,
        totalInputTokens: s.inputTokens ?? 0,
        totalOutputTokens: s.outputTokens ?? 0,
        totalCacheCreateTokens: s.cacheCreationInputTokens ?? 0,
        totalCacheReadTokens: s.cacheReadInputTokens ?? 0,
        messageCount: agg._count,
        firstSeen: agg._min.timestamp?.toISOString() ?? "",
        lastSeen: agg._max.timestamp?.toISOString() ?? "",
      };
    }

    this.serverUsage = { totalCost, totalTokens, sessionUsages };
  }

  private handleSessionState(msg: AgentMessage) {
    const session = this.sessions.find(s => s.id === msg.session_id);
    if (session) {
      session.claudeSessionId = msg.claude_session_id;
      session.currentActivity = msg.activity;
      session.toolName = msg.tool_name;
      session.model = msg.model;
      session.contextTokens = msg.context_tokens;
      session.contextLimit = msg.context_limit;
      session.compactionCount = msg.compaction_count;
      session.sessionInputTokens = msg.input_tokens;
      session.sessionOutputTokens = msg.output_tokens;
      session.cacheReadTokens = msg.cache_read_tokens;
      session.cacheCreateTokens = msg.cache_create_tokens;
    }
    this.throttledSnapshot(msg);
  }

  private handleSessionEvent(msg: AgentMessage) {
    this.lastSessionEvent = {
      session: msg.session_id || "",
      event: msg.event || "error",
      message: msg.message || "",
      timestamp: msg.timestamp || Date.now(),
    };
  }

  private async persistSession(msg: AgentMessage) {
    if (!this.userId) return;
    try {
      await prisma.session.upsert({
        where: {
          userId_serverId_claudeSessionId: {
            userId: this.userId,
            serverId: this.config.id,
            claudeSessionId: msg.claude_session_id || "",
          },
        },
        update: {},
        create: {
          tmuxSessionName: msg.session_id || "",
          claudeSessionId: msg.claude_session_id || "",
          serverId: this.config.id,
          userId: this.userId,
          workdir: msg.workdir || "",
        },
      });
    } catch (e) {
      console.error("Failed to persist session:", e);
    }
  }

  private throttledSnapshot(msg: AgentMessage) {
    const key = msg.session_id || "";
    const now = Date.now();
    const lastTime = this.snapshotTimers.get(key) || 0;
    if (now - lastTime < 30_000) return;
    this.snapshotTimers.set(key, now);
    this.saveSnapshot(msg).catch(console.error);
  }

  private async saveSnapshot(msg: AgentMessage) {
    if (!this.userId) return;
    const session = await prisma.session.findFirst({
      where: {
        userId: this.userId,
        serverId: this.config.id,
        claudeSessionId: msg.claude_session_id || "",
      },
    });
    if (!session) return;

    await prisma.sessionSnapshot.create({
      data: {
        sessionId: session.id,
        contextTokens: msg.context_tokens || 0,
        contextLimit: msg.context_limit || 200000,
        compactionCount: msg.compaction_count || 0,
        state: msg.session_state || "idle",
        inputTokens: msg.input_tokens || 0,
        outputTokens: msg.output_tokens || 0,
        cacheReadTokens: msg.cache_read_tokens || 0,
        cacheCreateTokens: msg.cache_create_tokens || 0,
      },
    });
    await this.pruneSnapshots(session.id);
  }

  private async pruneSnapshots(sessionDbId: string) {
    const count = await prisma.sessionSnapshot.count({
      where: { sessionId: sessionDbId },
    });
    if (count > 100) {
      const oldest = await prisma.sessionSnapshot.findMany({
        where: { sessionId: sessionDbId },
        orderBy: { timestamp: "asc" },
        take: count - 100,
        select: { id: true },
      });
      await prisma.sessionSnapshot.deleteMany({
        where: { id: { in: oldest.map((s: { id: string }) => s.id) } },
      });
    }
  }

  private async loadLatestSnapshots(): Promise<void> {
    if (!this.userId) return;
    const sessions = await prisma.session.findMany({
      where: { userId: this.userId, serverId: this.config.id },
      include: {
        snapshots: { orderBy: { timestamp: "desc" }, take: 1 },
      },
    });
    for (const session of sessions) {
      if (session.snapshots.length > 0) {
        const snap = session.snapshots[0];
        const tmuxSession = this.sessions.find((s: SessionInfo) => s.id === session.tmuxSessionName);
        if (tmuxSession) {
          tmuxSession.contextTokens = snap.contextTokens;
          tmuxSession.contextLimit = snap.contextLimit;
          tmuxSession.compactionCount = snap.compactionCount;
          tmuxSession.claudeSessionId = session.claudeSessionId;
        }
      }
    }
  }

  send(msg: Record<string, unknown>) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    // Add ±30% jitter to prevent thundering herd
    const jitter = this.reconnectDelay * (0.7 + Math.random() * 0.6);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, jitter);
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
      termWs.send(JSON.stringify({ type: "auth", data: this.config.token }));
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
        const conn = new AgentConnection(server, userId, (type) =>
          this.notifyUserTargeted(userId, this.buildUpdate(conn, type))
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
        const conn = new AgentConnection(server, userId, (type) =>
          this.notifyUserTargeted(userId, this.buildUpdate(conn, type))
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
    this.targetedCallbacks.delete(userId);
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
          usage: conn.serverUsage,
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

  onUserTargetedUpdate(userId: string, cb: TargetedCallback): () => void {
    const cbs = this.targetedCallbacks.get(userId) || [];
    cbs.push(cb);
    this.targetedCallbacks.set(userId, cbs);
    return () => {
      const arr = this.targetedCallbacks.get(userId);
      if (arr) {
        this.targetedCallbacks.set(userId, arr.filter((c) => c !== cb));
      }
    };
  }

  private buildUpdate(conn: AgentConnection, type: UpdateType): TargetedUpdate {
    const base = { type, serverId: conn.config.id };
    switch (type) {
      case "sessions":
        return { ...base, sessions: conn.sessions };
      case "metrics":
        return { ...base, metrics: conn.metrics };
      case "server_info":
        return { ...base, serverInfo: { hostname: conn.hostname, os: conn.os, agentVersion: conn.agentVersion, dirs: conn.dirs } };
      case "usage":
        return { ...base, usage: conn.serverUsage };
      case "connectivity":
        return { ...base, online: conn.online, sessions: conn.sessions };
      case "session_event":
        return { ...base, sessionEvent: conn.lastSessionEvent };
    }
  }

  private targetedCallbacks = new Map<string, TargetedCallback[]>();

  private notifyUserTargeted(userId: string, update: TargetedUpdate) {
    const cbs = this.targetedCallbacks.get(userId) || [];
    for (const cb of cbs) {
      cb(update);
    }
  }

  /** Legacy: send full state (used for initial sync only) */
  private notifyUserFull(userId: string) {
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
    if (!conn) return;
    conn.send({ type: "kill_session", session_id: sessionId });
    // Optimistically remove session from local state
    conn.sessions = conn.sessions.filter((s) => s.id !== sessionId);
    this.notifyUserTargeted(userId, { type: "sessions", serverId, sessions: conn.sessions });
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
