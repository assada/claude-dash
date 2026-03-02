import type { UsageEntry } from "./types";

interface ModelPricing {
  input: number;
  output: number;
  cacheCreate: number;
  cacheRead: number;
}

// Pricing per 1M tokens (USD) — https://platform.claude.com/docs/en/about-claude/pricing
const PRICING: Record<string, ModelPricing> = {
  "claude-opus-4-6":   { input: 5,    output: 25,  cacheCreate: 6.25,  cacheRead: 0.50 },
  "claude-opus-4-5":   { input: 5,    output: 25,  cacheCreate: 6.25,  cacheRead: 0.50 },
  "claude-opus-4-1":   { input: 15,   output: 75,  cacheCreate: 18.75, cacheRead: 1.50 },
  "claude-opus-4-":    { input: 15,   output: 75,  cacheCreate: 18.75, cacheRead: 1.50 },
  "claude-sonnet-4-6": { input: 3,    output: 15,  cacheCreate: 3.75,  cacheRead: 0.30 },
  "claude-sonnet-4-5": { input: 3,    output: 15,  cacheCreate: 3.75,  cacheRead: 0.30 },
  "claude-sonnet-4-":  { input: 3,    output: 15,  cacheCreate: 3.75,  cacheRead: 0.30 },
  "claude-haiku-4-5":  { input: 1,    output: 5,   cacheCreate: 1.25,  cacheRead: 0.10 },
  "claude-haiku-3-5":  { input: 0.80, output: 4,   cacheCreate: 1.00,  cacheRead: 0.08 },
};

// Fallback for unknown models — use sonnet pricing as a reasonable middle ground
const DEFAULT_PRICING: ModelPricing = PRICING["claude-sonnet-4-6"];

function getPricing(model: string): ModelPricing {
  // Try exact match first
  if (PRICING[model]) return PRICING[model];
  // Try prefix match (e.g. "claude-opus-4-6-20260301")
  for (const key of Object.keys(PRICING)) {
    if (model.startsWith(key)) return PRICING[key];
  }
  return DEFAULT_PRICING;
}

export function calculateEntryCost(entry: UsageEntry): number {
  const p = getPricing(entry.model);
  return (
    (entry.input_tokens * p.input +
      entry.output_tokens * p.output +
      entry.cache_creation_input_tokens * p.cacheCreate +
      entry.cache_read_input_tokens * p.cacheRead) /
    1_000_000
  );
}

export function formatCost(n: number): string {
  if (n < 0.01) return `$${n.toFixed(4)}`;
  if (n < 1) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(2)}`;
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}
