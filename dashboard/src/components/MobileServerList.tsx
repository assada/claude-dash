"use client";

import Link from "next/link";
import { Plus, Settings, Terminal, Wifi, WifiOff } from "lucide-react";
import { SessionRow } from "./ServerPanel";
import type { ServerStatus } from "@/lib/types";

export function MobileServerList({
  servers,
  attentionCount,
  onOpenTerminal,
  onKillSession,
  onNewSession,
  onNewSessionGlobal,
}: {
  servers: ServerStatus[];
  attentionCount: number;
  onOpenTerminal: (serverId: string, sessionId: string) => void;
  onKillSession: (serverId: string, sessionId: string) => void;
  onNewSession: (serverId: string) => void;
  onNewSessionGlobal: () => void;
}) {
  return (
    <div className="min-h-screen bg-surface-0 safe-bottom">
      {/* Sticky header */}
      <header className="sticky top-0 z-40 backdrop-blur bg-surface-0/85 border-b border-surface-1">
        <div className="flex items-center gap-3 px-4 py-3">
          <div className="icon-box w-8 h-8">
            <Terminal size={16} className="text-text-secondary" />
          </div>
          <h1 className="text-[15px] font-semibold text-text-secondary tracking-tight">
            Dashboard
          </h1>

          {attentionCount > 0 && (
            <span className="animate-shimmer px-2 py-0.5 rounded-md bg-warn text-white text-[11px] font-semibold">
              {attentionCount}
            </span>
          )}

          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={onNewSessionGlobal}
              className="btn-skin flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium"
            >
              <Plus size={13} /> New
            </button>
            <Link href="/settings" className="btn-ghost p-2">
              <Settings size={16} />
            </Link>
          </div>
        </div>
      </header>

      {/* Server cards */}
      <main className="px-3 py-3 flex flex-col gap-3">
        {servers.length === 0 && (
          <div className="py-12 text-center text-[13px] text-text-faint italic">
            No servers configured
          </div>
        )}

        {servers.map((server) => {
          const activeCount = server.sessions.filter(
            (s) => s.state !== "dead"
          ).length;

          return (
            <div key={server.id} className="panel overflow-hidden">
              {/* Server header */}
              <div className="flex items-center gap-2 px-4 h-12">
                <span className="text-[13px] font-medium text-text-secondary truncate flex-1">
                  {server.name}
                </span>

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
                  onClick={() => onNewSession(server.id)}
                  className="btn-ghost p-1 shrink-0"
                  title="New session"
                >
                  <Plus size={13} />
                </button>
              </div>

              {/* Sessions */}
              <div className="pb-2 pt-1">
                {server.online ? (
                  <>
                    {server.sessions.map((session) => (
                      <SessionRow
                        key={session.id}
                        session={session}
                        onOpen={() =>
                          onOpenTerminal(server.id, session.id)
                        }
                        onKill={() =>
                          onKillSession(server.id, session.id)
                        }
                      />
                    ))}
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
            </div>
          );
        })}
      </main>
    </div>
  );
}
