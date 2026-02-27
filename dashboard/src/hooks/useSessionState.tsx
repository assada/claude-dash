"use client";

import { createContext, useContext, useEffect, useState, useRef, useCallback, useMemo } from "react";
import type { ServerStatus, ArchivedSession } from "@/lib/types";

type SessionStateValue = ReturnType<typeof useSessionState>;

const SessionStateContext = createContext<SessionStateValue | null>(null);

export function SessionStateProvider({ children }: { children: React.ReactNode }) {
  const state = useSessionState();
  return (
    <SessionStateContext.Provider value={state}>
      {children}
    </SessionStateContext.Provider>
  );
}

export function useSessionStateContext(): SessionStateValue {
  const ctx = useContext(SessionStateContext);
  if (!ctx) {
    throw new Error("useSessionStateContext must be used within a SessionStateProvider");
  }
  return ctx;
}

export function useSessionState() {
  const [servers, setServers] = useState<ServerStatus[]>([]);
  const [archivedSessions, setArchivedSessions] = useState<ArchivedSession[]>(
    []
  );
  const archivedIdsRef = useRef<Set<string>>(new Set());
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const processServers = useCallback((incoming: ServerStatus[]) => {
    const now = Date.now();
    const newArchived: ArchivedSession[] = [];

    // Find newly dead sessions
    for (const server of incoming) {
      for (const session of server.sessions) {
        if (
          session.state === "dead" &&
          !archivedIdsRef.current.has(session.id)
        ) {
          archivedIdsRef.current.add(session.id);
          newArchived.push({ ...session, archivedAt: now });
        }
      }
    }

    // Add new archived sessions
    if (newArchived.length > 0) {
      setArchivedSessions((prev) => [...prev, ...newArchived]);
    }

    // Filter dead+archived sessions out of servers
    const filtered = incoming.map((server) => ({
      ...server,
      sessions: server.sessions.filter(
        (s) => !(s.state === "dead" && archivedIdsRef.current.has(s.id))
      ),
    }));

    // Check if any session resurrected (came back alive after being archived)
    for (const server of incoming) {
      for (const session of server.sessions) {
        if (
          session.state !== "dead" &&
          archivedIdsRef.current.has(session.id)
        ) {
          archivedIdsRef.current.delete(session.id);
          setArchivedSessions((prev) =>
            prev.filter((a) => a.id !== session.id)
          );
        }
      }
    }

    // Remove archived sessions that no longer exist in incoming data
    // (agent already deleted them via clear_dead_sessions)
    const allIncomingIds = new Set<string>();
    for (const server of incoming) {
      for (const session of server.sessions) {
        allIncomingIds.add(session.id);
      }
    }
    setArchivedSessions((prev) => {
      const filtered = prev.filter((a) => allIncomingIds.has(a.id));
      if (filtered.length !== prev.length) {
        // Clean up refs for removed sessions
        for (const a of prev) {
          if (!allIncomingIds.has(a.id)) {
            archivedIdsRef.current.delete(a.id);
          }
        }
        return filtered;
      }
      return prev;
    });

    setServers((prev) => {
      if (
        prev.length === filtered.length &&
        prev.every((s, i) => {
          const f = filtered[i];
          return (
            s.id === f.id &&
            s.online === f.online &&
            s.sessions.length === f.sessions.length &&
            s.sessions.every(
              (ss, j) =>
                ss.id === f.sessions[j]?.id &&
                ss.state === f.sessions[j]?.state &&
                ss.last_line === f.sessions[j]?.last_line &&
                ss.state_changed_at === f.sessions[j]?.state_changed_at
            ) &&
            s.agentVersion === f.agentVersion &&
            s.metrics?.cpuPercent === f.metrics?.cpuPercent &&
            s.metrics?.memUsed === f.metrics?.memUsed &&
            s.metrics?.diskUsed === f.metrics?.diskUsed &&
            s.metrics?.uptimeSecs === f.metrics?.uptimeSecs
          );
        })
      ) {
        return prev;
      }
      return filtered;
    });
  }, []);

  const connect = useCallback(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "subscribe" }));
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "state_update" && msg.servers) {
          processServers(msg.servers);
        }
      } catch (e) {
        console.warn("[ws] Failed to parse message:", (e as Error).message);
      }
    };

    ws.onclose = () => {
      wsRef.current = null;
      reconnectTimer.current = setTimeout(connect, 2000);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, [processServers]);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current);
      }
      wsRef.current?.close();
    };
  }, [connect]);

  const createSession = useCallback(
    (serverId: string, workdir: string, name: string, dangerouslySkipPermissions?: boolean) => {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({ type: "create_session", serverId, workdir, name, dangerouslySkipPermissions: dangerouslySkipPermissions || false })
        );
      }
    },
    []
  );

  const killSession = useCallback(
    (serverId: string, sessionId: string) => {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({ type: "kill_session", serverId, sessionId })
        );
      }
    },
    []
  );

  const archivedRef = useRef(archivedSessions);
  archivedRef.current = archivedSessions;

  const clearArchive = useCallback(() => {
    // Collect server IDs before clearing
    const serverIds = new Set<string>();
    for (const s of archivedRef.current) {
      serverIds.add(s.serverId);
    }

    // Clear locally immediately
    archivedIdsRef.current.clear();
    setArchivedSessions([]);

    // Tell each agent server to clean up scrollback files
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      for (const serverId of serverIds) {
        ws.send(
          JSON.stringify({ type: "clear_dead_sessions", serverId })
        );
      }
    }
  }, []);

  return useMemo(
    () => ({
      servers,
      archivedSessions,
      archiveCount: archivedSessions.length,
      createSession,
      killSession,
      clearArchive,
    }),
    [servers, archivedSessions, createSession, killSession, clearArchive]
  );
}
