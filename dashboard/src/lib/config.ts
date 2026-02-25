import fs from "fs";
import path from "path";
import yaml from "yaml";

export interface ServerConfig {
  id: string;
  name: string;
  host: string;
  port: number;
  token: string;
}

export interface DashboardConfig {
  auth: {
    password: string;
  };
  servers: ServerConfig[];
  ui: {
    poll_interval_ms: number;
    notification_sound: boolean;
    theme: "dark" | "light";
  };
}

const CONFIG_PATH =
  process.env.DASHBOARD_CONFIG || "/app/config.yaml";

let cachedConfig: DashboardConfig | null = null;
let configMtime: number = 0;

function defaultConfig(): DashboardConfig {
  return {
    auth: { password: process.env.DASHBOARD_PASSWORD || "admin" },
    servers: [],
    ui: {
      poll_interval_ms: 500,
      notification_sound: true,
      theme: "dark",
    },
  };
}

export function loadConfig(): DashboardConfig {
  try {
    const stat = fs.statSync(CONFIG_PATH);
    if (cachedConfig && stat.mtimeMs === configMtime) {
      return cachedConfig;
    }
    const content = fs.readFileSync(CONFIG_PATH, "utf-8");
    const parsed = yaml.parse(content) as Partial<DashboardConfig>;
    const cfg = { ...defaultConfig(), ...parsed };
    cachedConfig = cfg;
    configMtime = stat.mtimeMs;
    return cfg;
  } catch {
    // If no config file, use env vars / defaults
    const cfg = defaultConfig();

    // Allow servers from env: SERVERS=name:host:port:token,name2:host2:port2:token2
    const serversEnv = process.env.SERVERS;
    if (serversEnv) {
      cfg.servers = serversEnv.split(",").map((s, i) => {
        const parts = s.split(":");
        return {
          id: parts[0] || `server-${i}`,
          name: parts[0] || `Server ${i}`,
          host: parts[1] || "127.0.0.1",
          port: parseInt(parts[2]) || 9100,
          token: parts[3] || "",
        };
      });
    }

    cachedConfig = cfg;
    return cfg;
  }
}

export function saveConfig(config: DashboardConfig): void {
  const dir = path.dirname(CONFIG_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(CONFIG_PATH, yaml.stringify(config), "utf-8");
  cachedConfig = config;
}
