"use client";

import { motion } from "framer-motion";
import { Terminal, Trash2, FolderOpen } from "lucide-react";
import { StatusIndicator, StateLabel, getStateColor } from "./StatusIndicator";
import type { SessionInfo } from "@/lib/types";

function timeSince(ts: number): string {
  const seconds = Math.floor((Date.now() - ts) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

function shortName(name: string): string {
  // Remove cc- prefix and timestamp
  const match = name.match(/^cc-\d+-(.+)$/);
  return match ? match[1] : name;
}

export function SessionCard({
  session,
  onDoubleClick,
  onKill,
}: {
  session: SessionInfo;
  onDoubleClick: () => void;
  onKill: () => void;
}) {
  const stateColor = getStateColor(session.state);
  const isNeedsAttention = session.state === "needs_attention";
  const isDead = session.state === "dead";

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.6, y: 50 }}
      whileHover={{ scale: 1.02 }}
      onDoubleClick={onDoubleClick}
      className={`
        relative group cursor-pointer rounded-xl border p-4
        transition-colors select-none
        ${isDead ? "opacity-50" : ""}
        ${isNeedsAttention ? "bg-red-950/20" : "bg-zinc-900/50"}
      `}
      style={{
        borderColor: isNeedsAttention ? undefined : `${stateColor}33`,
      }}
    >
      {/* Pulsing glow for needs_attention */}
      {isNeedsAttention && (
        <motion.div
          className="absolute inset-0 rounded-xl pointer-events-none"
          style={{
            boxShadow: `0 0 20px ${stateColor}40, inset 0 0 20px ${stateColor}10`,
            border: `1px solid ${stateColor}`,
            borderRadius: "0.75rem",
          }}
          animate={{
            boxShadow: [
              `0 0 20px ${stateColor}40, inset 0 0 20px ${stateColor}10`,
              `0 0 40px ${stateColor}60, inset 0 0 30px ${stateColor}20`,
              `0 0 20px ${stateColor}40, inset 0 0 20px ${stateColor}10`,
            ],
          }}
          transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
        />
      )}

      {/* Header */}
      <div className="flex items-center gap-2 mb-2">
        <StatusIndicator state={session.state} />
        <span className="font-semibold text-sm text-zinc-100 truncate">
          {shortName(session.name)}
        </span>
        <span className="ml-auto text-xs text-zinc-500">
          {timeSince(session.state_changed_at)}
        </span>
      </div>

      {/* State */}
      <div className="mb-2">
        <StateLabel state={session.state} />
      </div>

      {/* Workdir */}
      <div className="flex items-center gap-1 text-xs text-zinc-500 mb-2">
        <FolderOpen size={12} />
        <span className="truncate">{session.workdir || "~"}</span>
      </div>

      {/* Last line preview */}
      {session.last_line && (
        <div className="text-xs text-zinc-600 truncate" style={{ fontFamily: "'JetBrains Mono NF', 'JetBrains Mono', Menlo, monospace" }}>
          {session.last_line}
        </div>
      )}

      {/* Actions (visible on hover) */}
      <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDoubleClick();
          }}
          className="p-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400"
          title="Open terminal"
        >
          <Terminal size={14} />
        </button>
        {!isDead && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (confirm("Kill this session?")) {
                onKill();
              }
            }}
            className="p-1 rounded bg-zinc-800 hover:bg-red-900 text-zinc-400 hover:text-red-400"
            title="Kill session"
          >
            <Trash2 size={14} />
          </button>
        )}
      </div>
    </motion.div>
  );
}
