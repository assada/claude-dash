"use client";

import { AnimatePresence } from "framer-motion";
import { Monitor, Plus, Wifi, WifiOff } from "lucide-react";
import { SessionCard } from "./SessionCard";
import type { ServerStatus } from "@/lib/types";

export function ServerGroup({
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
  return (
    <div className="mb-8">
      {/* Server header */}
      <div className="flex items-center gap-3 mb-4">
        <Monitor size={20} className="text-zinc-400" />
        <h2 className="text-lg font-semibold text-zinc-200">{server.name}</h2>
        {server.online ? (
          <span className="flex items-center gap-1 text-xs text-green-500">
            <Wifi size={12} /> online
          </span>
        ) : (
          <span className="flex items-center gap-1 text-xs text-red-500">
            <WifiOff size={12} /> offline
          </span>
        )}
        <span className="text-xs text-zinc-600">{server.host}</span>
        {server.hostname && (
          <span className="text-xs text-zinc-600">({server.hostname})</span>
        )}
        <button
          onClick={onNewSession}
          className="ml-auto flex items-center gap-1 px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400 text-xs"
          title="New session"
        >
          <Plus size={12} /> New
        </button>
      </div>

      {/* Session cards grid */}
      {server.online ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          <AnimatePresence mode="popLayout">
            {server.sessions.map((session) => (
              <SessionCard
                key={session.id}
                session={session}
                onDoubleClick={() => onOpenTerminal(session.id)}
                onKill={() => onKillSession(session.id)}
              />
            ))}
          </AnimatePresence>
          {server.sessions.length === 0 && (
            <div className="text-zinc-600 text-sm italic col-span-full py-4">
              No sessions running
            </div>
          )}
        </div>
      ) : (
        <div className="text-zinc-600 text-sm italic py-4">
          Server is offline
        </div>
      )}
    </div>
  );
}
