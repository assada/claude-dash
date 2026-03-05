"use client";

import { useEffect, useMemo, useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Grid3X3, Columns3, Rows3, PanelLeftClose, PanelLeft, X } from "lucide-react";
import { WorkspaceSidebar } from "./WorkspaceSidebar";
import { TerminalGrid } from "./TerminalGrid";
import { TerminalGridPane } from "./TerminalGridPane";
import { useSessionStateContext } from "@/hooks/useSessionState";
import type { WorkspaceLayout as LayoutType, WorkspacePane } from "@/hooks/useWorkspace";
import type { ServerStatus } from "@/lib/types";

const layoutIcons: Record<LayoutType, React.ReactNode> = {
  grid: <Grid3X3 size={14} />,
  columns: <Columns3 size={14} />,
  rows: <Rows3 size={14} />,
};

const layouts: LayoutType[] = ["grid", "columns", "rows"];

export function WorkspaceLayout({
  servers,
  panes,
  focusedPaneId,
  layout,
  onClose,
  onCloseAll,
  openPane,
  closePane,
  focusPane,
  setLayout,
  reorderPanes,
  focusNext,
  focusPrev,
  onNewSession,
}: {
  servers: ServerStatus[];
  panes: WorkspacePane[];
  focusedPaneId: string | null;
  layout: LayoutType;
  onClose: () => void;
  onCloseAll: () => void;
  openPane: (serverId: string, sessionId: string) => void;
  closePane: (id: string) => void;
  focusPane: (id: string) => void;
  setLayout: (layout: LayoutType) => void;
  reorderPanes: (panes: WorkspacePane[]) => void;
  focusNext: () => void;
  focusPrev: () => void;
  onNewSession: (serverId: string) => void;
}) {
  const router = useRouter();
  const { startViewing, markSeen } = useSessionStateContext();
  const [sidebarVisible, setSidebarVisible] = useState(true);

  const toggleSidebar = useCallback(() => {
    setSidebarVisible((v) => !v);
  }, []);

  // Register all open panes as actively viewed
  useEffect(() => {
    const cleanups: (() => void)[] = [];
    for (const pane of panes) {
      cleanups.push(startViewing(pane.serverId, pane.sessionId));
    }
    return () => { cleanups.forEach((fn) => fn()); };
  }, [panes, startViewing]);

  // Auto-clear waiting when tab becomes visible for all panes
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        for (const pane of panes) {
          markSeen(pane.serverId, pane.sessionId);
        }
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [panes, markSeen]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey) {
        if (e.key === "]") {
          e.preventDefault();
          focusNext();
        } else if (e.key === "[") {
          e.preventDefault();
          focusPrev();
        } else if (e.key === "W" || e.key === "w") {
          e.preventDefault();
          if (focusedPaneId) closePane(focusedPaneId);
        }
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "b") {
        e.preventDefault();
        toggleSidebar();
      }
      // Note: Escape is not bound here because terminal (Claude Code) captures it
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [focusedPaneId, focusNext, focusPrev, closePane, toggleSidebar]);

  const openPaneIds = useMemo(
    () => new Set(panes.map((p) => p.id)),
    [panes]
  );

  // Resolve session info for each pane using Maps for O(1) lookup
  const paneInfoMap = useMemo(() => {
    const serverMap = new Map(servers.map((s) => [s.id, s]));
    const map = new Map<string, { sessionName: string; workdir?: string; serverName: string; sessionState: "idle" | "working" | "waiting" | "needs_attention" | "starting" | "dead" }>();
    for (const pane of panes) {
      const server = serverMap.get(pane.serverId);
      const session = server?.sessions.find((s) => s.id === pane.sessionId);
      map.set(pane.id, {
        sessionName: session?.name || pane.sessionId,
        workdir: session?.workdir,
        serverName: server?.name || pane.serverId,
        sessionState: session?.state || "dead",
      });
    }
    return map;
  }, [panes, servers]);

  const handleFullscreen = useCallback(
    (serverId: string, sessionId: string) => {
      router.push(`/server/${serverId}/session/${sessionId}`);
    },
    [router]
  );

  const isMac = typeof navigator !== "undefined" && /Mac/.test(navigator.userAgent);
  const mod = isMac ? "\u2318" : "Ctrl";

  return (
    <div className="h-screen flex flex-col bg-[#0d1117]">
      {/* Top bar */}
      <div className="flex items-center gap-2 px-3 py-1.5 bg-surface-0 border-b border-surface-1 shrink-0">
        <button
          onClick={onClose}
          className="btn-ghost flex items-center gap-1 text-[12px]"
          data-tooltip="Back to overview"
        >
          <ArrowLeft size={13} /> Overview
        </button>

        <button
          onClick={toggleSidebar}
          className="btn-ghost p-1"
          data-tooltip={`${sidebarVisible ? "Hide" : "Show"} sidebar (${mod}+B)`}
        >
          {sidebarVisible ? <PanelLeftClose size={14} /> : <PanelLeft size={14} />}
        </button>

        <div className="flex-1" />

        {/* Close all */}
        {panes.length > 0 && (
          <button
            onClick={onCloseAll}
            className="btn-ghost flex items-center gap-1 text-[11px] text-text-faint hover:text-warn"
            data-tooltip="Close all terminals"
          >
            <X size={12} /> Close all
          </button>
        )}

        {/* Layout selector */}
        <div className="flex items-center gap-0.5 bg-surface-1 rounded-md p-0.5">
          {layouts.map((l) => (
            <button
              key={l}
              onClick={() => setLayout(l)}
              className={`p-1 rounded transition-colors ${
                layout === l
                  ? "bg-surface-2 text-text-secondary"
                  : "text-text-faint hover:text-text-muted"
              }`}
              data-tooltip={l.charAt(0).toUpperCase() + l.slice(1)}
            >
              {layoutIcons[l]}
            </button>
          ))}
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex min-h-0">
        {/* Sidebar */}
        {sidebarVisible && (
          <div className="w-[220px] shrink-0">
            <WorkspaceSidebar
              servers={servers}
              openPaneIds={openPaneIds}
              focusedPaneId={focusedPaneId}
              onOpenPane={openPane}
              onNewSession={onNewSession}
              onFullscreen={handleFullscreen}
            />
          </div>
        )}

        {/* Terminal grid */}
        <div className="flex-1 min-w-0 p-[2px]">
          {panes.length === 0 ? (
            <div className="h-full flex items-center justify-center">
              <p className="text-[13px] text-text-faint">
                Click a session in the sidebar to open it here
              </p>
            </div>
          ) : (
            <TerminalGrid
              layout={layout}
              panes={panes}
              onReorder={reorderPanes}
              renderPane={(pane, dragControls) => {
                const info = paneInfoMap.get(pane.id);
                if (!info) return null;
                return (
                  <TerminalGridPane
                    serverId={pane.serverId}
                    sessionId={pane.sessionId}
                    sessionName={info.sessionName}
                    workdir={info.workdir}
                    serverName={info.serverName}
                    sessionState={info.sessionState}
                    isFocused={focusedPaneId === pane.id}
                    dragControls={dragControls}
                    onFocus={() => focusPane(pane.id)}
                    onClose={() => closePane(pane.id)}
                    onFullscreen={() => handleFullscreen(pane.serverId, pane.sessionId)}
                  />
                );
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
