export const EXPECTED_VERSION = process.env.NEXT_PUBLIC_AGENT_VERSION || "dev";

export function timeSince(ts: number): string {
  const seconds = Math.floor((Date.now() - ts) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export function shortName(name: string): string {
  const match = name.match(/^cc-\d+-(.+)$/);
  return match ? match[1] : name;
}
