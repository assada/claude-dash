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
  show: { y: 0, opacity: 1 },
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
            className="fixed inset-0 z-50 bg-black/40"
          />

          {/* Drawer */}
          <motion.div
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className="fixed bottom-0 left-0 right-0 z-50 max-h-[50vh] bg-zinc-900/95 backdrop-blur border-t border-zinc-700 rounded-t-2xl flex flex-col"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 shrink-0">
              <h2 className="text-base font-semibold text-zinc-200">
                Archived Sessions ({sessions.length})
              </h2>
              <div className="flex items-center gap-2">
                {sessions.length > 0 && (
                  <button
                    onClick={onClear}
                    className="flex items-center gap-1 px-3 py-1.5 rounded bg-zinc-800 hover:bg-red-900/50 text-zinc-400 hover:text-red-400 text-xs transition-colors"
                  >
                    <Trash2 size={12} /> Clear All
                  </button>
                )}
                <button
                  onClick={onClose}
                  className="p-1.5 rounded hover:bg-zinc-800 text-zinc-400"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            {/* Body */}
            <div className="overflow-y-auto px-6 py-4">
              {sessions.length === 0 ? (
                <div className="text-center py-8 text-zinc-600 text-sm">
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
                      className="relative group cursor-pointer rounded-xl border border-zinc-700/50 p-4 bg-zinc-800/50 hover:bg-zinc-800 transition-colors select-none opacity-70 hover:opacity-100"
                    >
                      {/* Header */}
                      <div className="flex items-center gap-2 mb-2">
                        <StatusIndicator state={session.state} />
                        <span className="font-semibold text-sm text-zinc-300 truncate">
                          {shortName(session.name)}
                        </span>
                        <span className="ml-auto text-xs text-zinc-600">
                          {timeSince(session.archivedAt)} ago
                        </span>
                      </div>

                      {/* State */}
                      <div className="mb-2">
                        <StateLabel state={session.state} />
                      </div>

                      {/* Server label */}
                      <div className="text-xs text-zinc-500 mb-1">
                        {session.serverName}
                      </div>

                      {/* Workdir */}
                      <div className="flex items-center gap-1 text-xs text-zinc-600 mb-2">
                        <FolderOpen size={12} />
                        <span className="truncate">
                          {session.workdir || "~"}
                        </span>
                      </div>

                      {/* Last line preview */}
                      {session.last_line && (
                        <div
                          className="text-xs text-zinc-700 truncate"
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
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
