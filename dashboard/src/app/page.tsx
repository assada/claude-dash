"use client";

import { useState, useCallback } from "react";
import { Plus, Settings, Terminal } from "lucide-react";
import { ServerGroup } from "@/components/ServerGroup";
import { NewSessionModal } from "@/components/NewSessionModal";
import { TerminalView } from "@/components/TerminalView";
import { ArchiveStack } from "@/components/ArchiveStack";
import { ArchiveDrawer } from "@/components/ArchiveDrawer";
import { useSessionState } from "@/hooks/useSessionState";
import { useNotification } from "@/hooks/useNotification";

export default function Home() {
  const {
    servers,
    archivedSessions,
    archiveCount,
    createSession,
    killSession,
    clearArchive,
  } = useSessionState();
  const [showNewSession, setShowNewSession] = useState(false);
  const [defaultNewServerId, setDefaultNewServerId] = useState<string>();
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [terminalTarget, setTerminalTarget] = useState<{
    serverId: string;
    sessionId: string;
    sessionName: string;
    serverName: string;
  } | null>(null);

  useNotification(servers);

  const handleOpenTerminal = useCallback(
    (serverId: string, sessionId: string) => {
      const server = servers.find((s) => s.id === serverId);
      const session = server?.sessions.find((s) => s.id === sessionId);
      const archived = archivedSessions.find(
        (s) => s.id === sessionId && s.serverId === serverId
      );
      const target = session || archived;
      const serverName = server?.name || archived?.serverName || serverId;

      if (target) {
        setTerminalTarget({
          serverId,
          sessionId,
          sessionName: target.name,
          serverName,
        });
        setArchiveOpen(false);
      }
    },
    [servers, archivedSessions]
  );

  // Count attention-needing sessions
  let attentionCount = 0;
  for (const server of servers) {
    for (const session of server.sessions) {
      if (session.state === "needs_attention") attentionCount++;
    }
  }

  // Terminal full-screen view
  if (terminalTarget) {
    const server = servers.find((s) => s.id === terminalTarget.serverId);
    const session = server?.sessions.find(
      (s) => s.id === terminalTarget.sessionId
    );
    const state = session?.state || "dead";

    return (
      <TerminalView
        serverId={terminalTarget.serverId}
        sessionId={terminalTarget.sessionId}
        sessionName={terminalTarget.sessionName}
        serverName={terminalTarget.serverName}
        sessionState={state}
        onBack={() => setTerminalTarget(null)}
      />
    );
  }

  return (
    <div className="min-h-screen dot-grid" style={{ background: "#171717" }}>
      {/* Noise overlay */}
      <div className="noise-overlay" />

      {/* Top bar */}
      <header
        className="sticky top-0 z-40 backdrop-blur"
        style={{
          background: "rgba(23, 23, 23, 0.85)",
          borderBottom: "1px solid #262626",
        }}
      >
        <div className="flex items-center gap-3 px-6 py-3">
          <div
            className="btn-skin flex items-center justify-center"
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              border: "1px solid #404040",
            }}
          >
            <Terminal size={18} style={{ color: "#e5e5e5" }} />
          </div>
          <h1
            style={{
              fontSize: 17,
              fontWeight: 600,
              color: "#e5e5e5",
              letterSpacing: "-0.01em",
            }}
          >
            Claude Dashboard
          </h1>

          {attentionCount > 0 && (
            <span
              className="animate-shimmer"
              style={{
                padding: "2px 8px",
                borderRadius: 6,
                background: "#ef4444",
                color: "#fff",
                fontSize: 11,
                fontWeight: 600,
              }}
            >
              {attentionCount}
            </span>
          )}

          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => {
                setDefaultNewServerId(undefined);
                setShowNewSession(true);
              }}
              className="btn-skin flex items-center gap-1.5"
              style={{
                padding: "6px 14px",
                borderRadius: 8,
                border: "1px solid #404040",
                color: "#e5e5e5",
                fontSize: 13,
                fontWeight: 500,
                transition: "all 0.2s ease",
              }}
            >
              <Plus size={14} /> New Session
            </button>
            <a
              href="/settings"
              className="btn-skin flex items-center justify-center"
              style={{
                width: 34,
                height: 34,
                borderRadius: 8,
                border: "1px solid #404040",
                color: "#737373",
                transition: "color 0.2s ease",
              }}
            >
              <Settings size={16} />
            </a>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="px-6 py-6 max-w-7xl mx-auto relative z-10">
        {servers.length === 0 ? (
          <div className="text-center py-20" style={{ color: "#525252" }}>
            <Terminal size={48} className="mx-auto mb-4 opacity-30" />
            <p style={{ fontSize: 17, fontWeight: 500, marginBottom: 8 }}>
              No servers configured
            </p>
            <p style={{ fontSize: 13, color: "#737373" }}>
              Go to{" "}
              <a
                href="/settings"
                style={{ color: "#58a6ff", textDecoration: "none" }}
              >
                Settings
              </a>{" "}
              to add agent servers
            </p>
          </div>
        ) : (
          servers.map((server) => (
            <ServerGroup
              key={server.id}
              server={server}
              onOpenTerminal={(sessionId) =>
                handleOpenTerminal(server.id, sessionId)
              }
              onKillSession={(sessionId) =>
                killSession(server.id, sessionId)
              }
              onNewSession={() => {
                setDefaultNewServerId(server.id);
                setShowNewSession(true);
              }}
            />
          ))
        )}
      </main>

      {/* Archive stack button */}
      <ArchiveStack
        count={archiveCount}
        onClick={() => setArchiveOpen(true)}
      />

      {/* Archive drawer */}
      <ArchiveDrawer
        open={archiveOpen}
        sessions={archivedSessions}
        onClose={() => setArchiveOpen(false)}
        onClear={clearArchive}
        onOpenTerminal={handleOpenTerminal}
      />

      {/* New session modal */}
      {showNewSession && (
        <NewSessionModal
          servers={servers}
          defaultServerId={defaultNewServerId}
          onClose={() => setShowNewSession(false)}
          onSubmit={createSession}
        />
      )}
    </div>
  );
}
