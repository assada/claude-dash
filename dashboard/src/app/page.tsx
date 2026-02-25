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

  let attentionCount = 0;
  for (const server of servers) {
    for (const session of server.sessions) {
      if (session.state === "needs_attention") attentionCount++;
    }
  }

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
    <div className="min-h-screen bg-surface-0 dot-grid">
      <div className="noise-overlay" />

      {/* Top bar */}
      <header className="sticky top-0 z-40 backdrop-blur bg-surface-0/85 border-b border-surface-1">
        <div className="flex items-center gap-3 px-6 py-3">
          <div className="icon-box w-9 h-9">
            <Terminal size={18} className="text-text-secondary" />
          </div>
          <h1 className="text-[17px] font-semibold text-text-secondary tracking-tight">
            Claude Dashboard
          </h1>

          {attentionCount > 0 && (
            <span className="animate-shimmer px-2 py-0.5 rounded-md bg-warn text-white text-[11px] font-semibold">
              {attentionCount}
            </span>
          )}

          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => {
                setDefaultNewServerId(undefined);
                setShowNewSession(true);
              }}
              className="btn-skin flex items-center gap-1.5 px-3.5 py-1.5 text-[13px] font-medium"
            >
              <Plus size={14} /> New Session
            </button>
            <a href="/settings" className="btn-ghost p-2">
              <Settings size={16} />
            </a>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="px-6 py-6 max-w-7xl mx-auto relative z-10">
        {servers.length === 0 ? (
          <div className="text-center py-20 text-text-faint">
            <Terminal size={48} className="mx-auto mb-4 opacity-30" />
            <p className="text-[17px] font-medium mb-2">No servers configured</p>
            <p className="text-[13px] text-text-muted">
              Go to{" "}
              <a href="/settings" className="text-accent hover:underline">
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

      <ArchiveStack count={archiveCount} onClick={() => setArchiveOpen(true)} />

      <ArchiveDrawer
        open={archiveOpen}
        sessions={archivedSessions}
        onClose={() => setArchiveOpen(false)}
        onClear={clearArchive}
        onOpenTerminal={handleOpenTerminal}
      />

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
