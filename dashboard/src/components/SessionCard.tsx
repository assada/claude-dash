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
      initial={{ opacity: 0, scale: 0.95, y: 10 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.6, y: 50 }}
      transition={{
        opacity: { duration: 0.15 },
        scale: { type: "spring", stiffness: 400, damping: 25 },
        y: { type: "spring", stiffness: 400, damping: 25 },
      }}
      whileHover={{ scale: 1.018 }}
      onDoubleClick={onDoubleClick}
      className={`panel relative group cursor-pointer select-none p-4 ${isDead ? "opacity-50" : ""} ${isNeedsAttention ? "!border-warn !bg-[linear-gradient(135deg,#2a1a1a_0%,#262626_100%)]" : ""}`}
    >
      {/* Pulsing glow for needs_attention */}
      {isNeedsAttention && (
        <motion.div
          className="absolute inset-0 rounded-xl pointer-events-none"
          style={{
            boxShadow: `0 0 20px ${stateColor}40, inset 0 0 20px ${stateColor}10`,
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
        <span className="text-[13px] font-semibold text-text-primary truncate">
          {shortName(session.name)}
        </span>
        <span className="ml-auto text-[11px] text-text-muted">
          {timeSince(session.state_changed_at)}
        </span>
      </div>

      {/* State */}
      <div className="mb-2">
        <StateLabel state={session.state} />
      </div>

      {/* Workdir */}
      <div className="flex items-center gap-1 mb-2 text-[11px] text-text-muted">
        <FolderOpen size={11} />
        <span className="truncate">{session.workdir || "~"}</span>
      </div>

      {/* Last line preview */}
      {session.last_line && (
        <div
          className="text-[11px] text-text-faint truncate"
          style={{
            fontFamily:
              "'JetBrains Mono NF', 'JetBrains Mono', Menlo, monospace",
          }}
        >
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
          className="btn-skin !rounded-md p-1.5"
          title="Open terminal"
        >
          <Terminal size={13} className="text-text-muted" />
        </button>
        {!isDead && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (confirm("Kill this session?")) {
                onKill();
              }
            }}
            className="btn-danger p-1.5"
            title="Kill session"
          >
            <Trash2 size={13} />
          </button>
        )}
      </div>
    </motion.div>
  );
}
