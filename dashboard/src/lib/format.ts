export const EXPECTED_VERSION = process.env.NEXT_PUBLIC_AGENT_VERSION || "dev";

// isAgentOutdated returns true only when agent version is LOWER than expected.
export function isAgentOutdated(agentVersion: string, expectedVersion: string): boolean {
  const parse = (v: string) => {
    const m = v.match(/^v?(\d+)\.(\d+)/);
    return m ? [Number(m[1]), Number(m[2])] : null;
  };
  const a = parse(agentVersion);
  const e = parse(expectedVersion);
  if (!a || !e) return false;
  return a[0] < e[0] || (a[0] === e[0] && a[1] < e[1]);
}

export function timeSince(ts: number): string {
  const seconds = Math.floor((Date.now() - ts) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

import type { SessionState } from "@/lib/types";

export function readLS<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function writeLS(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch { /* quota exceeded or private mode */ }
}

export function wsUrl(path = "/ws"): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}${path}`;
}

export const STATE_LABELS: Record<SessionState, string> = {
  idle: "Idle",
  waiting: "Done",
  working: "Working",
  needs_attention: "Needs You",
  starting: "Starting",
  dead: "Exited",
};

export function stateLabel(state: SessionState): string {
  return STATE_LABELS[state] ?? state;
}

export function shortName(name: string, workdir?: string): string {
  const match = name.match(/^cc-\d+-(.+)$/);
  const label = match ? match[1] : name;
  return label === "session" && workdir ? workdir : label;
}
