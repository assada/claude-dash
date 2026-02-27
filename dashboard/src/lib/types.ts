export type SessionState =
  | "idle"
  | "working"
  | "needs_attention"
  | "starting"
  | "dead";

export interface SessionInfo {
  id: string;
  name: string;
  state: SessionState;
  workdir: string;
  created: number;
  state_changed_at: number;
  last_line: string;
  serverId: string;
  serverName: string;
}

export interface ServerMetrics {
  cpuPercent: number;
  memTotal: number;
  memUsed: number;
  diskTotal: number;
  diskUsed: number;
  uptimeSecs: number;
  loadAvg: number;
}

export interface ServerStatus {
  id: string;
  name: string;
  host: string;
  port: number;
  online: boolean;
  hostname?: string;
  os?: string;
  agentVersion?: string;
  dirs?: string[];
  sessions: SessionInfo[];
  metrics?: ServerMetrics;
}

// Agent → Dashboard messages
export interface AgentMessage {
  type: string;
  sessions?: Array<{
    id: string;
    name: string;
    state: SessionState;
    workdir: string;
    created: number;
    state_changed_at: number;
    last_line: string;
  }>;
  session_id?: string;
  name?: string;
  data?: string;
  hostname?: string;
  os?: string;
  version?: string;
  dirs?: string[];
  message?: string;

  // System metrics (sent with machine_info)
  cpu_percent?: number;
  mem_total?: number;
  mem_used?: number;
  disk_total?: number;
  disk_used?: number;
  uptime_secs?: number;
  load_avg?: number;
}

// Browser → Dashboard messages
export interface BrowserMessage {
  type: string;
  serverId?: string;
  sessionId?: string;
  workdir?: string;
  name?: string;
  data?: string;
  cols?: number;
  rows?: number;
}
