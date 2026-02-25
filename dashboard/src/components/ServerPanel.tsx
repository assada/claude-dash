"use client";

import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence, useAnimation } from "framer-motion";
import {
  GripVertical,
  ChevronUp,
  Plus,
  Wifi,
  WifiOff,
  Loader2,
  CircleCheck,
  AlertCircle,
  Terminal,
  FolderOpen,
  Trash2,
} from "lucide-react";
import { StatusIndicator } from "./StatusIndicator";
import type { ServerStatus, SessionInfo, SessionState } from "@/lib/types";

function timeSince(ts: number): string {
  const seconds = Math.floor((Date.now() - ts) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function shortName(name: string): string {
  const match = name.match(/^cc-\d+-(.+)$/);
  return match ? match[1] : name;
}

function stateIcon(state: SessionState) {
  switch (state) {
    case "working":
      return <Loader2 size={14} className="text-yellow-500 animate-spin" />;
    case "needs_attention":
      return <AlertCircle size={14} className="text-warn" />;
    case "idle":
      return <CircleCheck size={14} className="text-ok" />;
    case "dead":
      return <div className="w-3.5 h-3.5 rounded-full bg-neutral-700" />;
    default:
      return <StatusIndicator state={state} size={10} />;
  }
}

function stateLabel(state: SessionState): string {
  switch (state) {
    case "idle": return "Idle";
    case "working": return "Working";
    case "needs_attention": return "Needs You";
    case "starting": return "Starting";
    case "dead": return "Exited";
    default: return state;
  }
}

function SessionRow({
  session,
  onOpen,
  onKill,
}: {
  session: SessionInfo;
  onOpen: () => void;
  onKill: () => void;
}) {
  const isAttention = session.state === "needs_attention";
  const isDead = session.state === "dead";
  const isWorking = session.state === "working";

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{
        opacity: { duration: 0.15 },
        y: { type: "spring", stiffness: 400, damping: 25 },
      }}
      onClick={onOpen}
      className={`group flex items-center gap-2.5 px-4 py-2.5 cursor-pointer transition-colors rounded-[5px] ${
        isAttention
          ? "bg-red-950/30 hover:bg-red-950/50"
          : "hover:bg-[rgba(64,64,64,0.3)]"
      } ${isDead ? "opacity-40" : ""}`}
    >
      {/* Status icon */}
      <div className="shrink-0 w-5 flex items-center justify-center">
        {stateIcon(session.state)}
      </div>

      {/* Name + workdir */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span
            className={`text-[13px] font-medium truncate ${
              isAttention ? "text-warn" : "text-text-primary"
            } ${isWorking ? "animate-shimmer" : ""}`}
          >
            {shortName(session.name)}
          </span>
          <span className="text-[11px] text-text-muted shrink-0">
            {stateLabel(session.state)}
          </span>
        </div>
        {session.last_line && (
          <div
            className="text-[11px] text-text-faint truncate mt-0.5"
            style={{
              fontFamily: "'JetBrains Mono NF', 'JetBrains Mono', Menlo, monospace",
            }}
          >
            {session.last_line}
          </div>
        )}
      </div>

      {/* Time */}
      <span className="text-[11px] text-text-faint shrink-0">
        {timeSince(session.state_changed_at)}
      </span>

      {/* Kill button — hover only */}
      {!isDead && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (confirm("Kill this session?")) onKill();
          }}
          className="opacity-0 group-hover:opacity-100 btn-danger p-1 shrink-0"
          title="Kill"
        >
          <Trash2 size={11} />
        </button>
      )}
    </motion.div>
  );
}

export function ServerPanel({
  server,
  onOpenTerminal,
  onKillSession,
  onNewSession,
}: {
  server: ServerStatus;
  onOpenTerminal: (sessionId: string) => void;
  onKillSession: (sessionId: string) => void;
  onNewSession: () => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const contentRef = useRef<HTMLDivElement>(null);
  const [contentHeight, setContentHeight] = useState<number | "auto">("auto");

  const attentionCount = server.sessions.filter(
    (s) => s.state === "needs_attention"
  ).length;
  const activeCount = server.sessions.filter(
    (s) => s.state !== "dead"
  ).length;

  // Measure content height for spring animation
  useEffect(() => {
    if (contentRef.current) {
      setContentHeight(contentRef.current.scrollHeight);
    }
  }, [server.sessions.length, expanded]);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.95, y: 10 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{
        opacity: { duration: 0.15 },
        scale: { type: "spring", stiffness: 400, damping: 25 },
        y: { type: "spring", stiffness: 400, damping: 25 },
      }}
      className="panel overflow-hidden"
      style={{ width: 320 }}
    >
      {/* Header — always visible */}
      <div
        className="flex items-center gap-2 px-4 h-12 cursor-pointer select-none transition-colors hover:bg-[rgba(64,64,64,0.3)]"
        onClick={() => setExpanded(!expanded)}
      >
        <GripVertical size={14} className="text-text-faint shrink-0" />

        <span className="text-[13px] font-medium text-text-secondary truncate flex-1">
          {server.name}
        </span>

        {/* Status badges */}
        {attentionCount > 0 && (
          <span className="animate-shimmer px-1.5 py-0.5 rounded bg-warn/20 text-warn text-[10px] font-semibold">
            {attentionCount}
          </span>
        )}

        {server.online ? (
          <span className="flex items-center gap-1 text-[10px] text-ok">
            <Wifi size={10} />
            <span>{activeCount}</span>
          </span>
        ) : (
          <span className="flex items-center gap-1 text-[10px] text-warn">
            <WifiOff size={10} />
          </span>
        )}

        <button
          onClick={(e) => {
            e.stopPropagation();
            onNewSession();
          }}
          className="btn-ghost p-1 shrink-0"
          title="New session"
        >
          <Plus size={13} />
        </button>

        <motion.div
          animate={{ rotate: expanded ? 180 : 0 }}
          transition={{ duration: 0.3, ease: "easeOut" }}
          className="shrink-0"
        >
          <ChevronUp size={13} className="text-text-faint" />
        </motion.div>
      </div>

      {/* Session list — collapsible */}
      <motion.div
        animate={{
          height: expanded ? contentHeight : 0,
          opacity: expanded ? 1 : 0,
        }}
        transition={{
          height: { type: "spring", stiffness: 400, damping: 28 },
          opacity: { duration: 0.15 },
        }}
        className="overflow-hidden"
      >
        <div ref={contentRef} className="pb-2 pt-1">
          {server.online ? (
            <>
              <AnimatePresence mode="popLayout">
                {server.sessions.map((session) => (
                  <SessionRow
                    key={session.id}
                    session={session}
                    onOpen={() => onOpenTerminal(session.id)}
                    onKill={() => onKillSession(session.id)}
                  />
                ))}
              </AnimatePresence>
              {server.sessions.length === 0 && (
                <div className="px-4 py-3 text-[11px] text-text-faint italic">
                  No sessions
                </div>
              )}
            </>
          ) : (
            <div className="px-4 py-3 text-[11px] text-text-faint italic">
              Offline
            </div>
          )}
        </div>

        {/* Scroll fade */}
        {server.sessions.length > 6 && expanded && (
          <div className="scroll-fade-bottom" />
        )}
      </motion.div>
    </motion.div>
  );
}
