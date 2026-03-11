"use client";

import { useState } from "react";
import { useIsMobile } from "@/hooks/useIsMobile";
import type { JSONLSessionData } from "@/lib/types";

function getBarColor(percent: number): string {
  if (percent <= 50) return "#238636";
  if (percent <= 80) return "linear-gradient(90deg, #238636, #eab308)";
  return "linear-gradient(90deg, #eab308, #da3633)";
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return String(n);
}

export function ContextBar({ data }: { data: JSONLSessionData }) {
  const isMobile = useIsMobile();
  const [showTooltip, setShowTooltip] = useState(false);

  if (isMobile) return null;
  if (!data.contextTokens || !data.contextLimit) return null;

  const percent = Math.min(100, Math.round((data.contextTokens / data.contextLimit) * 100));

  return (
    <div className="flex items-center gap-3 px-4 py-1 bg-[#0d1117] border-b border-surface-1 text-[11px]">
      {data.model && (
        <>
          <span className="text-text-faint">{data.model.replace("claude-", "")}</span>
          <span className="text-[#21262d]">&middot;</span>
        </>
      )}
      {data.currentActivity && (
        <span className="text-text-muted truncate max-w-[300px]">{data.currentActivity}</span>
      )}
      <div
        className="flex items-center gap-1.5 ml-auto cursor-pointer rounded px-1 hover:bg-[rgba(56,139,253,0.08)] relative"
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
      >
        <span className="text-text-faint">ctx</span>
        <div className="w-[100px] h-1 bg-[#21262d] rounded-sm overflow-hidden">
          <div className="h-full rounded-sm" style={{ width: `${percent}%`, background: getBarColor(percent) }} />
        </div>
        <span className="text-text-muted">~{formatTokens(data.contextTokens)}/{formatTokens(data.contextLimit)}</span>
        {(data.compactionCount ?? 0) > 0 && (
          <>
            <span className="text-[#21262d]">&middot;</span>
            <span className="text-text-faint">{data.compactionCount}&times; compact</span>
          </>
        )}
        {showTooltip && <ContextTooltip data={data} percent={percent} />}
      </div>
    </div>
  );
}

function ContextTooltip({ data, percent }: { data: JSONLSessionData; percent: number }) {
  const total = data.contextTokens || 1;
  const claudeMd = 8000;
  const thinking = Math.round(total * 0.3);
  const toolOutputs = Math.round(total * 0.4);
  const messages = Math.max(0, total - claudeMd - thinking - toolOutputs);

  const categories = [
    { name: "Tool outputs", tokens: toolOutputs, color: "#da3633", pct: toolOutputs / total },
    { name: "Thinking", tokens: thinking, color: "#a371f7", pct: thinking / total },
    { name: "Messages", tokens: messages, color: "#58a6ff", pct: messages / total },
    { name: "CLAUDE.md", tokens: claudeMd, color: "#3fb950", pct: claudeMd / total },
  ];

  return (
    <div className="absolute top-full right-0 mt-1 w-[260px] bg-[#1c2128] border border-surface-1 rounded-lg p-3.5 shadow-xl z-50">
      <div className="flex justify-between items-center mb-2.5">
        <span className="text-xs text-text-primary font-semibold">Context Window</span>
        <span className="text-[11px]" style={{ color: percent > 80 ? "#da3633" : percent > 50 ? "#eab308" : "#238636" }}>
          {percent}%
        </span>
      </div>
      <div className="w-full h-2 bg-[#21262d] rounded overflow-hidden mb-2.5">
        <div className="h-full rounded" style={{ width: `${percent}%`, background: getBarColor(percent) }} />
      </div>
      <div className="text-xs text-text-primary mb-2.5">
        ~{formatTokens(data.contextTokens || 0)} / {formatTokens(data.contextLimit || 200000)} tokens
      </div>
      <div className="flex flex-col gap-1.5 text-[11px]">
        {categories.map((cat) => (
          <div key={cat.name} className="flex justify-between items-center">
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-sm" style={{ background: cat.color }} />
              <span className="text-text-muted">{cat.name}</span>
            </div>
            <span className="text-text-primary font-mono">~{formatTokens(cat.tokens)}</span>
          </div>
        ))}
      </div>
      <div className="flex w-full h-1.5 rounded overflow-hidden mt-2.5 gap-px">
        {categories.map((cat) => (
          <div key={cat.name} style={{ width: `${Math.max(1, cat.pct * 100)}%`, background: cat.color }} />
        ))}
      </div>
      {(data.compactionCount ?? 0) > 0 && (
        <div className="mt-2.5 pt-2 border-t border-[#21262d] text-[11px] text-text-faint">
          Compacted {data.compactionCount} times
        </div>
      )}
    </div>
  );
}
