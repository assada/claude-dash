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
      initial={{
        opacity: 0,
        scale: 0.95,
        y: 10,
      }}
      animate={{
        opacity: 1,
        scale: 1,
        y: 0,
      }}
      exit={{ opacity: 0, scale: 0.6, y: 50 }}
      transition={{
        opacity: { duration: 0.15 },
        scale: { type: "spring", stiffness: 400, damping: 25 },
        y: { type: "spring", stiffness: 400, damping: 25 },
      }}
      whileHover={{
        scale: 1.018,
        boxShadow: "0 32px 40px -8px rgba(0, 0, 0, 0.55)",
      }}
      onDoubleClick={onDoubleClick}
      className="relative group cursor-pointer select-none"
      style={{
        borderRadius: 12,
        border: isNeedsAttention
          ? `1px solid ${stateColor}`
          : "1px solid #404040",
        padding: 16,
        background: isNeedsAttention
          ? "linear-gradient(135deg, #2a1a1a 0%, #262626 100%)"
          : "linear-gradient(135deg, #3a3a3a 0%, #262626 100%)",
        boxShadow: "0 24px 24px -12px rgba(0, 0, 0, 0.25)",
        opacity: isDead ? 0.5 : 1,
        transition:
          "transform 0.15s cubic-bezier(0.4, 0, 0.2, 1), box-shadow 0.15s cubic-bezier(0.4, 0, 0.2, 1)",
      }}
    >
      {/* Pulsing glow for needs_attention */}
      {isNeedsAttention && (
        <motion.div
          className="absolute inset-0 pointer-events-none"
          style={{
            borderRadius: 12,
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
        <span
          className="truncate"
          style={{ fontSize: 13, fontWeight: 600, color: "#fafafa" }}
        >
          {shortName(session.name)}
        </span>
        <span className="ml-auto" style={{ fontSize: 11, color: "#737373" }}>
          {timeSince(session.state_changed_at)}
        </span>
      </div>

      {/* State */}
      <div className="mb-2">
        <StateLabel state={session.state} />
      </div>

      {/* Workdir */}
      <div
        className="flex items-center gap-1 mb-2"
        style={{ fontSize: 11, color: "#737373" }}
      >
        <FolderOpen size={11} />
        <span className="truncate">{session.workdir || "~"}</span>
      </div>

      {/* Last line preview */}
      {session.last_line && (
        <div
          className="truncate"
          style={{
            fontSize: 11,
            color: "#525252",
            fontFamily:
              "'JetBrains Mono NF', 'JetBrains Mono', Menlo, monospace",
          }}
        >
          {session.last_line}
        </div>
      )}

      {/* Actions (visible on hover) */}
      <div
        className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 flex gap-1"
        style={{ transition: "opacity 0.2s ease-out" }}
      >
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDoubleClick();
          }}
          className="btn-skin"
          style={{
            padding: 5,
            borderRadius: 6,
            border: "1px solid #404040",
            color: "#737373",
            transition: "color 0.2s ease",
          }}
          title="Open terminal"
        >
          <Terminal size={13} />
        </button>
        {!isDead && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (confirm("Kill this session?")) {
                onKill();
              }
            }}
            style={{
              padding: 5,
              borderRadius: 6,
              border: "1px solid #404040",
              background: "#262626",
              color: "#737373",
              transition: "all 0.2s ease",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "#3a1a1a";
              e.currentTarget.style.borderColor = "#ef4444";
              e.currentTarget.style.color = "#ef4444";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "#262626";
              e.currentTarget.style.borderColor = "#404040";
              e.currentTarget.style.color = "#737373";
            }}
            title="Kill session"
          >
            <Trash2 size={13} />
          </button>
        )}
      </div>
    </motion.div>
  );
}
