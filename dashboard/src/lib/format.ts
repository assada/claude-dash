export const EXPECTED_VERSION = process.env.NEXT_PUBLIC_AGENT_VERSION || "dev";

// isAgentOutdated compares MAJOR.MINOR only — patch differences are compatible.
export function isAgentOutdated(agentVersion: string, expectedVersion: string): boolean {
  const minor = (v: string) => v.match(/^v?(\d+\.\d+)/)?.[1];
  const a = minor(agentVersion);
  const e = minor(expectedVersion);
  if (!a || !e) return false;
  return a !== e;
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
