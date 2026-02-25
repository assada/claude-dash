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
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: 8,
            background: "#262626",
            border: "1px solid #404040",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Monitor size={14} style={{ color: "#737373" }} />
        </div>
        <span
          style={{ fontSize: 15, fontWeight: 600, color: "#e5e5e5" }}
        >
          {server.name}
        </span>
        {server.online ? (
          <span
            className="flex items-center gap-1"
            style={{ fontSize: 11, color: "#4ade80" }}
          >
            <Wifi size={11} /> online
          </span>
        ) : (
          <span
            className="flex items-center gap-1"
            style={{ fontSize: 11, color: "#ef4444" }}
          >
            <WifiOff size={11} /> offline
          </span>
        )}
        <span style={{ fontSize: 11, color: "#525252" }}>
          {server.host}
        </span>
        {server.hostname && (
          <span style={{ fontSize: 11, color: "#525252" }}>
            ({server.hostname})
          </span>
        )}
        <button
          onClick={onNewSession}
          className="btn-skin ml-auto flex items-center gap-1"
          style={{
            padding: "4px 10px",
            borderRadius: 6,
            border: "1px solid #404040",
            color: "#737373",
            fontSize: 11,
            fontWeight: 500,
            transition: "color 0.2s ease",
          }}
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
            <div
              className="col-span-full py-4"
              style={{ fontSize: 13, color: "#525252", fontStyle: "italic" }}
            >
              No sessions running
            </div>
          )}
        </div>
      ) : (
        <div
          className="py-4"
          style={{ fontSize: 13, color: "#525252", fontStyle: "italic" }}
        >
          Server is offline
        </div>
      )}
    </div>
  );
}
