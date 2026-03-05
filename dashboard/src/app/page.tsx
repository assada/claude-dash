"use client";

import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Plus, Settings, Terminal, LayoutGrid, Columns3 } from "lucide-react";
import { formatCost } from "@/lib/pricing";
import { ServerPanel } from "@/components/ServerPanel";
import { DotGridCanvas, type PanelRect } from "@/components/DotGridCanvas";
import { NewSessionModal } from "@/components/NewSessionModal";
import { MobileServerList } from "@/components/MobileServerList";
import { WorkspaceLayout } from "@/components/WorkspaceLayout";
import { useCommandPaletteActions } from "@/components/CommandPalette";
import { useSessionStateContext } from "@/hooks/useSessionState";
import { useNotification } from "@/hooks/useNotification";
import { usePanelPositions } from "@/hooks/usePanelPositions";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useWorkspace } from "@/hooks/useWorkspace";

function isWorkspaceEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem("workspace-enabled") === "true";
}

export default function Home() {
  const {
    servers,
    createSession,
    killSession: rawKillSession,
  } = useSessionStateContext();
  const [showNewSession, setShowNewSession] = useState(false);
  const [defaultNewServerId, setDefaultNewServerId] = useState<string>();
  const router = useRouter();
  const isMobile = useIsMobile();
  const workspace = useWorkspace();
  const [workspaceEnabled, setWorkspaceEnabled] = useState(() => isWorkspaceEnabled());

  // React to workspace toggle from settings page (cross-tab + same-tab on focus)
  useEffect(() => {
    const sync = () => {
      const enabled = isWorkspaceEnabled();
      setWorkspaceEnabled((prev) => {
        if (prev === enabled) return prev;
        if (!enabled) workspace.purge();
        return enabled;
      });
    };
    // Cross-tab: storage event
    const onStorage = (e: StorageEvent) => {
      if (e.key === "workspace-enabled") sync();
    };
    // Same-tab: check on focus return (e.g. navigated back from settings)
    const onFocus = () => sync();
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", onFocus);
    // Also check on mount (user may have toggled in settings then navigated back)
    sync();
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", onFocus);
    };
  }, [workspace]);

  // Kill session + auto-close its workspace pane
  const killSession = useCallback((serverId: string, sessionId: string) => {
    rawKillSession(serverId, sessionId);
    workspace.closePaneBySession(serverId, sessionId);
  }, [rawKillSession, workspace]);

  // Auto-close workspace panes for dead/removed sessions
  useEffect(() => {
    if (!workspaceEnabled || workspace.panes.length === 0) return;
    const alive = new Set<string>();
    for (const server of servers) {
      for (const session of server.sessions) {
        if (session.state !== "dead") {
          alive.add(`${server.id}:${session.id}`);
        }
      }
    }
    for (const pane of workspace.panes) {
      if (!alive.has(pane.id)) {
        workspace.closePaneBySession(pane.serverId, pane.sessionId);
      }
    }
  }, [servers, workspaceEnabled, workspace]);

  const [metricsVisible, setMetricsVisible] = useState(() => {
    if (typeof window === "undefined") return true;
    return localStorage.getItem("metrics-visible") !== "false";
  });
  const [zOrder, setZOrder] = useState<string[]>([]);
  const panelRectsRef = useRef<Record<string, PanelRect>>({});

  const serverIds = useMemo(() => servers.map((s) => s.id), [servers]);
  const { positions, updatePosition, arrangeAll } =
    usePanelPositions(serverIds);

  const attentionCount = useMemo(() => {
    let count = 0;
    for (const server of servers) {
      for (const session of server.sessions) {
        if (session.state === "needs_attention") count++;
      }
    }
    return count;
  }, [servers]);

  const totalCost = useMemo(() => {
    return servers.reduce((sum, s) => sum + (s.usage?.totalCost ?? 0), 0);
  }, [servers]);

  useNotification(servers, workspaceEnabled ? workspace.openPane : undefined);

  const toggleMetrics = useCallback(() => {
    setMetricsVisible((v) => {
      const next = !v;
      localStorage.setItem("metrics-visible", String(next));
      return next;
    });
  }, []);

  useCommandPaletteActions({
    onNewSession: (serverId) => {
      setDefaultNewServerId(serverId);
      setShowNewSession(true);
    },
    onArrange: arrangeAll,
    onToggleMetrics: toggleMetrics,
    onOpenTerminal: (serverId, sessionId) => {
      if (isMobile || !workspaceEnabled) {
        router.push(`/server/${serverId}/session/${sessionId}`);
      } else {
        workspace.openPane(serverId, sessionId);
      }
    },
  });

  const bringToFront = useCallback((id: string) => {
    setZOrder((prev) => [...prev.filter((z) => z !== id), id]);
  }, []);

  const handleReportRect = useCallback(
    (serverId: string, rect: PanelRect) => {
      panelRectsRef.current[serverId] = rect;
    },
    []
  );

  const handleOpenTerminal = useCallback(
    (serverId: string, sessionId: string) => {
      if (workspaceEnabled) {
        workspace.openPane(serverId, sessionId);
      } else {
        router.push(`/server/${serverId}/session/${sessionId}`);
      }
    },
    [workspaceEnabled, workspace, router]
  );

  const handleNewSession = useCallback((serverId: string) => {
    setDefaultNewServerId(serverId);
    setShowNewSession(true);
  }, []);

  const handleNewSessionGlobal = useCallback(() => {
    setDefaultNewServerId(undefined);
    setShowNewSession(true);
  }, []);

  const handleCloseNewSession = useCallback(() => {
    setShowNewSession(false);
  }, []);

  const handleMobileOpenTerminal = useCallback(
    (serverId: string, sessionId: string) => {
      router.push(`/server/${serverId}/session/${sessionId}`);
    },
    [router]
  );

  if (isMobile) {
    return (
      <>
        <MobileServerList
          servers={servers}
          attentionCount={attentionCount}
          onOpenTerminal={handleMobileOpenTerminal}
          onKillSession={killSession}
          onNewSession={handleNewSession}
          onNewSessionGlobal={handleNewSessionGlobal}
        />
        <NewSessionModal
          open={showNewSession}
          servers={servers}
          defaultServerId={defaultNewServerId}
          onClose={handleCloseNewSession}
          onSubmit={createSession}
        />
      </>
    );
  }

  const showWorkspaceView = workspaceEnabled && workspace.visible;

  return (
    <>
      {/* Workspace mode */}
      {showWorkspaceView && (
        <WorkspaceLayout
          servers={servers}
          panes={workspace.panes}
          focusedPaneId={workspace.focusedPaneId}
          layout={workspace.layout}
          onClose={workspace.hideWorkspace}
          onCloseAll={workspace.closeAll}
          openPane={workspace.openPane}
          closePane={workspace.closePane}
          focusPane={workspace.focusPane}
          setLayout={workspace.setLayout}
          reorderPanes={workspace.reorderPanes}
          focusNext={workspace.focusNext}
          focusPrev={workspace.focusPrev}
          onNewSession={handleNewSession}
        />
      )}

      {/* Overview mode — hidden when workspace is visible */}
      <div className={`h-screen overflow-hidden bg-surface-0 ${showWorkspaceView ? "hidden" : ""}`}>
        {/* Reactive dot grid canvas */}
        <DotGridCanvas panelRectsRef={panelRectsRef} />

        {/* Noise overlay */}
        <div className="noise-overlay" />

        {/* Top bar — transparent, floating */}
        <header className="fixed top-0 left-0 right-0 z-40 pointer-events-none">
          <div className="flex items-center gap-3 px-6 py-3">
            <div className="icon-box w-9 h-9">
              <Terminal size={18} className="text-text-secondary" />
            </div>
            <h1 className="text-[17px] font-semibold text-text-secondary tracking-tight">
              ADHD Dashboard
            </h1>

            {attentionCount > 0 && (
              <span
                className="animate-shimmer px-2 py-0.5 rounded-md bg-warn text-white text-[11px] font-semibold pointer-events-auto"
                data-tooltip={`${attentionCount} session${attentionCount > 1 ? "s" : ""} need${attentionCount === 1 ? "s" : ""} attention`}
              >
                {attentionCount}
              </span>
            )}

            {totalCost > 0 && (
              <span
                className="px-2 py-0.5 rounded-md bg-emerald-900/40 text-emerald-400 text-[11px] font-semibold pointer-events-auto"
                data-tooltip="Total cost across all servers"
              >
                {formatCost(totalCost)}
              </span>
            )}

            <div className="ml-auto flex items-center gap-2 pointer-events-auto">
              {/* Workspace button — show when workspace has saved panes */}
              {workspaceEnabled && workspace.hasPanes && (
                <button
                  onClick={workspace.showWorkspace}
                  className="btn-skin flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium"
                  data-tooltip={`Open workspace (${workspace.panes.length} terminal${workspace.panes.length !== 1 ? "s" : ""})`}
                >
                  <Columns3 size={13} />
                  Workspace
                  <span className="px-1 py-0.5 rounded bg-surface-2 text-text-muted text-[10px] font-bold leading-none">
                    {workspace.panes.length}
                  </span>
                </button>
              )}
              {servers.length > 0 && (
                <button
                  onClick={arrangeAll}
                  className="btn-skin flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium"
                  data-tooltip="Arrange panels"
                >
                  <LayoutGrid size={13} /> Arrange
                </button>
              )}
              <button
                onClick={handleNewSessionGlobal}
                className="btn-skin flex items-center gap-1.5 px-3.5 py-1.5 text-[13px] font-medium"
              >
                <Plus size={14} /> New Session
              </button>
              <Link href="/settings" className="btn-ghost p-2" data-tooltip="Settings">
                <Settings size={16} />
              </Link>
            </div>
          </div>
        </header>

        {/* Panels (fixed position, float on viewport) */}
        {servers.length === 0 ? null : (
          servers.map((server) => {
              const pos = positions[server.id];
              if (!pos) return null;
              return (
                <ServerPanel
                  key={server.id}
                  server={server}
                  position={pos}
                  showMetrics={metricsVisible}
                  onPositionChange={updatePosition}
                  onBringToFront={bringToFront}
                  onReportRect={handleReportRect}
                  zIndex={zOrder.indexOf(server.id) + 1}
                  onOpenTerminal={handleOpenTerminal}
                  onKillSession={killSession}
                  onNewSession={handleNewSession}
                />
              );
            })
          )}

        <NewSessionModal
          open={showNewSession}
          servers={servers}
          defaultServerId={defaultNewServerId}
          onClose={handleCloseNewSession}
          onSubmit={createSession}
        />
      </div>
    </>
  );
}
