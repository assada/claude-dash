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

export function shortName(name: string, workdir?: string): string {
  const match = name.match(/^cc-\d+-(.+)$/);
  const label = match ? match[1] : name;
  return label === "session" && workdir ? workdir : label;
}
