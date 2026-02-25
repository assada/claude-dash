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
        <div className="icon-box w-7 h-7">
          <Monitor size={14} className="text-text-muted" />
        </div>
        <span className="text-[15px] font-semibold text-text-secondary">
          {server.name}
        </span>
        {server.online ? (
          <span className="flex items-center gap-1 text-[11px] text-ok">
            <Wifi size={11} /> online
          </span>
        ) : (
          <span className="flex items-center gap-1 text-[11px] text-warn">
            <WifiOff size={11} /> offline
          </span>
        )}
        <span className="text-[11px] text-text-faint">{server.host}</span>
        {server.hostname && (
          <span className="text-[11px] text-text-faint">
            ({server.hostname})
          </span>
        )}
        <button
          onClick={onNewSession}
          className="btn-skin ml-auto flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium !text-text-muted"
          title="New session"
        >
          <Plus size={11} /> New
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
            <div className="col-span-full py-4 text-[13px] text-text-faint italic">
              No sessions running
            </div>
          )}
        </div>
      ) : (
        <div className="py-4 text-[13px] text-text-faint italic">
          Server is offline
        </div>
      )}
    </div>
  );
}
