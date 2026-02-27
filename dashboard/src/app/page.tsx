"use client";

import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Plus, Settings, Terminal, LayoutGrid } from "lucide-react";
import { ServerPanel } from "@/components/ServerPanel";
import { DotGridCanvas, type PanelRect } from "@/components/DotGridCanvas";
import { NewSessionModal } from "@/components/NewSessionModal";
import { MobileServerList } from "@/components/MobileServerList";
import { useCommandPaletteActions } from "@/components/CommandPalette";
import { ArchiveStack } from "@/components/ArchiveStack";
import { ArchiveDrawer } from "@/components/ArchiveDrawer";
import { useSessionStateContext } from "@/hooks/useSessionState";
import { useNotification } from "@/hooks/useNotification";
import { usePanelPositions } from "@/hooks/usePanelPositions";
import { useIsMobile } from "@/hooks/useIsMobile";

export default function Home() {
  const {
    servers,
    archivedSessions,
    archiveCount,
    createSession,
    killSession,
    clearArchive,
  } = useSessionStateContext();
  const [showNewSession, setShowNewSession] = useState(false);
  const [defaultNewServerId, setDefaultNewServerId] = useState<string>();
  const [archiveOpen, setArchiveOpen] = useState(false);
  const router = useRouter();
  const isMobile = useIsMobile();

  const [metricsVisible, setMetricsVisible] = useState(true);
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

  useNotification(attentionCount);

  useEffect(() => {
    if (localStorage.getItem("metrics-visible") === "false") {
      setMetricsVisible(false);
    }
  }, []);

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
    onOpenArchive: () => setArchiveOpen(true),
    onClearArchive: clearArchive,
    onToggleMetrics: toggleMetrics,
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
      setArchiveOpen(false);
      router.push(`/server/${serverId}/session/${sessionId}`);
    },
    [router]
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

  const handleOpenArchive = useCallback(() => {
    setArchiveOpen(true);
  }, []);

  const handleCloseArchive = useCallback(() => {
    setArchiveOpen(false);
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

  return (
    <div className="h-screen overflow-hidden bg-surface-0">
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
            <span className="animate-shimmer px-2 py-0.5 rounded-md bg-warn text-white text-[11px] font-semibold">
              {attentionCount}
            </span>
          )}

          <div className="ml-auto flex items-center gap-2 pointer-events-auto">
            {servers.length > 0 && (
              <button
                onClick={arrangeAll}
                className="btn-skin flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium !text-text-muted"
                title="Arrange panels"
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
            <Link href="/settings" className="btn-ghost p-2">
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

      <ArchiveStack
        count={archiveCount}
        onClick={handleOpenArchive}
      />

      <ArchiveDrawer
        open={archiveOpen}
        sessions={archivedSessions}
        onClose={handleCloseArchive}
        onClear={clearArchive}
        onOpenTerminal={handleOpenTerminal}
      />

      <NewSessionModal
        open={showNewSession}
        servers={servers}
        defaultServerId={defaultNewServerId}
        onClose={handleCloseNewSession}
        onSubmit={createSession}
      />

    </div>
  );
}
