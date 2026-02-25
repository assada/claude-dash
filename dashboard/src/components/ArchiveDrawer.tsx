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
  show: { transition: { staggerChildren: 0.05 } },
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
            className="fixed inset-0 z-50 bg-black/50"
          />

          {/* Drawer */}
          <motion.div
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className="fixed bottom-0 left-0 right-0 z-50 flex flex-col max-h-[50vh] bg-surface-0/95 backdrop-blur-xl border-t border-border rounded-t-2xl"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 shrink-0 border-b border-surface-1">
              <span className="text-[15px] font-semibold text-text-secondary">
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
                    className="btn-danger flex items-center gap-1 px-3 py-1.5 text-[11px]"
                  >
                    <Trash2 size={11} /> Clear All
                  </motion.button>
                )}
                <button onClick={onClose} className="btn-ghost p-1.5">
                  <X size={16} />
                </button>
              </div>
            </div>

            {/* Body */}
            <div className="overflow-y-auto hide-scrollbar px-6 py-4">
              {sessions.length === 0 ? (
                <div className="text-center py-8 text-[13px] text-text-faint">
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
                      className="relative group cursor-pointer select-none rounded-xl border border-border-subtle p-4 bg-[linear-gradient(135deg,#2a2a2a_0%,#222_100%)] opacity-70 hover:opacity-100 hover:border-border-hover transition-all"
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <StatusIndicator state={session.state} />
                        <span className="text-[13px] font-medium text-neutral-300 truncate">
                          {shortName(session.name)}
                        </span>
                        <span className="ml-auto text-[11px] text-text-faint">
                          {timeSince(session.archivedAt)} ago
                        </span>
                      </div>
                      <div className="mb-2">
                        <StateLabel state={session.state} />
                      </div>
                      <div className="text-[11px] text-text-faint mb-1">
                        {session.serverName}
                      </div>
                      <div className="flex items-center gap-1 mb-2 text-[11px] text-text-faint">
                        <FolderOpen size={11} />
                        <span className="truncate">{session.workdir || "~"}</span>
                      </div>
                      {session.last_line && (
                        <div
                          className="text-[11px] text-border truncate"
                          style={{
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
              {sessions.length > 4 && <div className="scroll-fade-bottom" />}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
