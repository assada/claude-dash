"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Plus, Maximize2 } from "lucide-react";
import { StatusIndicator } from "./StatusIndicator";
import { shortName } from "@/lib/format";
import type { ServerStatus } from "@/lib/types";

function stateLabel(state: string): string {
  switch (state) {
    case "idle": return "Idle";
    case "waiting": return "Done";
    case "working": return "Working";
    case "needs_attention": return "Needs You";
    case "starting": return "Starting";
    case "dead": return "Exited";
    default: return state;
  }
}

export function WorkspaceSidebar({
  servers,
  openPaneIds,
  focusedPaneId,
  onOpenPane,
  onNewSession,
  onFullscreen,
}: {
  servers: ServerStatus[];
  openPaneIds: Set<string>;
  focusedPaneId: string | null;
  onOpenPane: (serverId: string, sessionId: string) => void;
  onNewSession: (serverId: string) => void;
  onFullscreen: (serverId: string, sessionId: string) => void;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    try {
      const raw = localStorage.getItem("ws-sidebar-collapsed");
      return raw ? new Set(JSON.parse(raw)) : new Set();
    } catch { return new Set(); }
  });

  const toggleServer = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      localStorage.setItem("ws-sidebar-collapsed", JSON.stringify([...next]));
      return next;
    });
  };

  return (
    <div className="flex flex-col h-full overflow-y-auto bg-surface-0 border-r border-surface-1">
      <div className="px-3 py-2 border-b border-surface-1">
        <span className="text-[11px] font-semibold text-text-faint uppercase tracking-wider">
          Sessions
        </span>
      </div>

      <div className="flex-1 overflow-y-auto py-1">
        {servers.map((server) => {
          const isCollapsed = collapsed.has(server.id);
          const activeSessions = server.sessions.filter((s) => s.state !== "dead");

          return (
            <div key={server.id}>
              {/* Server header */}
              <button
                onClick={() => toggleServer(server.id)}
                className="w-full flex items-center gap-1.5 px-3 py-1.5 hover:bg-surface-1 transition-colors"
              >
                {isCollapsed ? (
                  <ChevronRight size={12} className="text-text-faint shrink-0" />
                ) : (
                  <ChevronDown size={12} className="text-text-faint shrink-0" />
                )}
                <span className={`text-[12px] font-medium truncate flex-1 text-left ${
                  server.online ? "text-text-secondary" : "text-text-faint"
                }`}>
                  {server.name}
                </span>
                <span className={`text-[10px] ${server.online ? "text-ok" : "text-text-faint"}`}>
                  {activeSessions.length}
                </span>
                <button
                  onClick={(e) => { e.stopPropagation(); onNewSession(server.id); }}
                  className="btn-ghost p-0.5 shrink-0"
                  data-tooltip="New session"
                >
                  <Plus size={11} />
                </button>
              </button>

              {/* Sessions */}
              {!isCollapsed && (
                <div className="pb-1">
                  {server.sessions.map((session) => {
                    const paneId = `${server.id}:${session.id}`;
                    const isOpen = openPaneIds.has(paneId);
                    const isFocused = focusedPaneId === paneId;

                    return (
                      <div
                        key={session.id}
                        onClick={() => onOpenPane(server.id, session.id)}
                        className={`group flex items-center gap-1.5 pl-6 pr-2 py-1.5 cursor-pointer transition-colors ${
                          isFocused
                            ? "bg-accent/10"
                            : isOpen
                            ? "bg-surface-1/50"
                            : "hover:bg-surface-1"
                        } ${session.state === "dead" ? "opacity-40" : ""}`}
                      >
                        <StatusIndicator state={session.state} size={6} />
                        <span
                          className="text-[12px] text-text-secondary truncate flex-1"
                          style={{ direction: "rtl", textAlign: "left" }}
                        >
                          {shortName(session.name, session.workdir)}
                        </span>
                        <span className="text-[10px] text-text-faint shrink-0">
                          {stateLabel(session.state)}
                        </span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onFullscreen(server.id, session.id);
                          }}
                          className="btn-ghost p-0.5 opacity-0 group-hover:opacity-60 hover:!opacity-100 shrink-0"
                          data-tooltip="Fullscreen"
                        >
                          <Maximize2 size={10} />
                        </button>
                      </div>
                    );
                  })}

                  {activeSessions.length === 0 && server.online && (
                    <div className="pl-6 pr-2 py-1.5 text-[11px] text-text-faint italic">
                      No sessions
                    </div>
                  )}

                  {!server.online && (
                    <div className="pl-6 pr-2 py-1.5 text-[11px] text-text-faint italic">
                      Offline
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
