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
  const { servers, archivedSessions, archiveCount, createSession, killSession, clearArchive } =
    useSessionState();
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
      // Look in active servers first, then archived sessions
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
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      {/* Top bar */}
      <header className="sticky top-0 z-40 bg-zinc-950/80 backdrop-blur border-b border-zinc-800 px-6 py-3">
        <div className="flex items-center gap-3">
          <Terminal size={24} className="text-blue-500" />
          <h1 className="text-lg font-bold">Claude Dashboard</h1>

          {attentionCount > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-red-600 text-white text-xs font-bold animate-pulse">
              {attentionCount}
            </span>
          )}

          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => {
                setDefaultNewServerId(undefined);
                setShowNewSession(true);
              }}
              className="flex items-center gap-1 px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white text-sm"
            >
              <Plus size={14} /> New Session
            </button>
            <a
              href="/settings"
              className="p-2 hover:bg-zinc-800 rounded text-zinc-400"
            >
              <Settings size={18} />
            </a>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="px-6 py-6 max-w-7xl mx-auto">
        {servers.length === 0 ? (
          <div className="text-center py-20 text-zinc-600">
            <Terminal size={48} className="mx-auto mb-4 opacity-50" />
            <p className="text-lg mb-2">No servers configured</p>
            <p className="text-sm">
              Go to{" "}
              <a href="/settings" className="text-blue-500 hover:underline">
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
