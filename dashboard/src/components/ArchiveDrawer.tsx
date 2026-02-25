"use client";

import { motion, AnimatePresence } from "framer-motion";
import { X, Trash2, FolderOpen } from "lucide-react";
import { StatusIndicator, StateLabel } from "./StatusIndicator";
import type { ArchivedSession } from "@/lib/types";

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

const containerVariants = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.05 },
  },
};

const cardVariants = {
  hidden: { y: 30, opacity: 0 },
  show: {
    y: 0,
    opacity: 1,
    transition: {
      y: { type: "spring" as const, stiffness: 400, damping: 25 },
      opacity: { duration: 0.15 },
    },
  },
};

export function ArchiveDrawer({
  open,
  sessions,
  onClose,
  onClear,
  onOpenTerminal,
}: {
  open: boolean;
  sessions: ArchivedSession[];
  onClose: () => void;
  onClear: () => void;
  onOpenTerminal: (serverId: string, sessionId: string) => void;
}) {
  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-50"
            style={{ background: "rgba(0, 0, 0, 0.5)" }}
          />

          {/* Drawer */}
          <motion.div
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className="fixed bottom-0 left-0 right-0 z-50 flex flex-col"
            style={{
              maxHeight: "50vh",
              background: "rgba(23, 23, 23, 0.95)",
              backdropFilter: "blur(20px)",
              borderTop: "1px solid #404040",
              borderRadius: "16px 16px 0 0",
            }}
          >
            {/* Header */}
            <div
              className="flex items-center justify-between px-6 py-4 shrink-0"
              style={{ borderBottom: "1px solid #262626" }}
            >
              <span
                style={{ fontSize: 15, fontWeight: 600, color: "#e5e5e5" }}
              >
                Archived Sessions ({sessions.length})
              </span>
              <div className="flex items-center gap-2">
                {sessions.length > 0 && (
                  <motion.button
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={{ duration: 0.2, ease: "easeOut" }}
                    onClick={onClear}
                    className="flex items-center gap-1"
                    style={{
                      padding: "5px 12px",
                      borderRadius: 6,
                      border: "1px solid #404040",
                      background: "#262626",
                      color: "#737373",
                      fontSize: 11,
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
                  >
                    <Trash2 size={11} /> Clear All
                  </motion.button>
                )}
                <button
                  onClick={onClose}
                  style={{
                    padding: 6,
                    borderRadius: 6,
                    color: "#737373",
                    transition: "color 0.2s ease",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.color = "#e5e5e5";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.color = "#737373";
                  }}
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            {/* Body */}
            <div className="overflow-y-auto hide-scrollbar px-6 py-4">
              {sessions.length === 0 ? (
                <div
                  className="text-center py-8"
                  style={{ fontSize: 13, color: "#525252" }}
                >
                  No archived sessions
                </div>
              ) : (
                <motion.div
                  variants={containerVariants}
                  initial="hidden"
                  animate="show"
                  className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4"
                >
                  {sessions.map((session) => (
                    <motion.div
                      key={session.id}
                      variants={cardVariants}
                      onDoubleClick={() =>
                        onOpenTerminal(session.serverId, session.id)
                      }
                      className="relative group cursor-pointer select-none"
                      style={{
                        borderRadius: 12,
                        border: "1px solid rgba(255,255,255,0.06)",
                        padding: 16,
                        background:
                          "linear-gradient(135deg, #2a2a2a 0%, #222222 100%)",
                        opacity: 0.7,
                        transition: "all 0.2s ease",
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.opacity = "1";
                        e.currentTarget.style.borderColor =
                          "rgba(255,255,255,0.12)";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.opacity = "0.7";
                        e.currentTarget.style.borderColor =
                          "rgba(255,255,255,0.06)";
                      }}
                    >
                      {/* Header */}
                      <div className="flex items-center gap-2 mb-2">
                        <StatusIndicator state={session.state} />
                        <span
                          className="truncate"
                          style={{
                            fontSize: 13,
                            fontWeight: 500,
                            color: "#d4d4d4",
                          }}
                        >
                          {shortName(session.name)}
                        </span>
                        <span
                          className="ml-auto"
                          style={{ fontSize: 11, color: "#525252" }}
                        >
                          {timeSince(session.archivedAt)} ago
                        </span>
                      </div>

                      {/* State */}
                      <div className="mb-2">
                        <StateLabel state={session.state} />
                      </div>

                      {/* Server label */}
                      <div style={{ fontSize: 11, color: "#525252", marginBottom: 4 }}>
                        {session.serverName}
                      </div>

                      {/* Workdir */}
                      <div
                        className="flex items-center gap-1 mb-2"
                        style={{ fontSize: 11, color: "#525252" }}
                      >
                        <FolderOpen size={11} />
                        <span className="truncate">
                          {session.workdir || "~"}
                        </span>
                      </div>

                      {/* Last line preview */}
                      {session.last_line && (
                        <div
                          className="truncate"
                          style={{
                            fontSize: 11,
                            color: "#404040",
                            fontFamily:
                              "'JetBrains Mono NF', 'JetBrains Mono', Menlo, monospace",
                          }}
                        >
                          {session.last_line}
                        </div>
                      )}
                    </motion.div>
                  ))}
                </motion.div>
              )}

              {/* Scroll fade */}
              {sessions.length > 4 && (
                <div
                  className="sticky bottom-0 left-0 right-0 pointer-events-none"
                  style={{
                    height: 40,
                    marginTop: -40,
                    background:
                      "linear-gradient(to top, rgba(23,23,23,0.95) 0%, transparent 100%)",
                  }}
                />
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
