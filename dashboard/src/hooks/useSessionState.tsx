"use client";

import { createContext, useContext, useEffect, useState, useRef, useCallback, useMemo } from "react";
import type { ServerStatus, SessionState } from "@/lib/types";

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
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track previous session states for working→idle detection
  const prevStatesRef = useRef<Map<string, SessionState>>(new Map());
  // Track sessions in "waiting" state (dashboard-side only)
  const waitingSetRef = useRef<Set<string>>(new Set());
  // Sessions currently being viewed (session page is mounted)
  const activeViewsRef = useRef<Set<string>>(new Set());

  const processServers = useCallback((incoming: ServerStatus[]) => {
    const prevStates = prevStatesRef.current;
    const waitingSet = waitingSetRef.current;
    const activeViews = activeViewsRef.current;
    const isTabVisible = typeof document !== "undefined" && document.visibilityState === "visible";

    const filtered = incoming.map((server) => {
      const sessions = server.sessions
        .filter((s) => s.state !== "dead")
        .map((s) => {
          const key = `${server.id}:${s.id}`;
          const prevState = prevStates.get(key);

          // Detect working → idle transition → set to waiting
          // (unless user is actively viewing this session)
          if (prevState === "working" && s.state === "idle") {
            if (!(activeViews.has(key) && isTabVisible)) {
              waitingSet.add(key);
            }
          }

          // If agent reports non-idle, remove from waiting
          if (s.state !== "idle") {
            waitingSet.delete(key);
          }

          // Update prev state tracker
          prevStates.set(key, s.state);

          // Override state if in waiting set
          const displayState = waitingSet.has(key) ? "waiting" : s.state;

          return { ...s, state: displayState };
        });

      return { ...server, sessions };
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
            s.metrics?.uptimeSecs === f.metrics?.uptimeSecs &&
            s.usage?.totalCost === f.usage?.totalCost &&
            s.usage?.totalTokens === f.usage?.totalTokens &&
            s.usage?.totalCost === f.usage?.totalCost &&
            s.usage?.totalTokens === f.usage?.totalTokens
          );
        })
      ) {
        return prev;
      }
      return filtered;
    });
  }, []);

  const connectRef = useRef<() => void>(null);

  useEffect(() => {
    const doConnect = () => {
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
        reconnectTimer.current = setTimeout(doConnect, 2000);
      };

      ws.onerror = () => {
        ws.close();
      };
    };

    connectRef.current = doConnect;
    doConnect();

    return () => {
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current);
      }
      wsRef.current?.close();
    };
  }, [processServers]);

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

  const markSeen = useCallback((serverId: string, sessionId: string) => {
    const key = `${serverId}:${sessionId}`;
    if (waitingSetRef.current.has(key)) {
      waitingSetRef.current.delete(key);
      setServers((prev) =>
        prev.map((server) => ({
          ...server,
          sessions: server.sessions.map((s) =>
            server.id === serverId && s.id === sessionId && s.state === "waiting"
              ? { ...s, state: "idle" as const }
              : s
          ),
        }))
      );
    }
  }, []);

  // Register a session as actively viewed. Returns cleanup function.
  // When visible + viewing → auto-clears waiting state.
  const startViewing = useCallback((serverId: string, sessionId: string) => {
    const key = `${serverId}:${sessionId}`;
    activeViewsRef.current.add(key);
    // Clear waiting immediately if tab is visible
    if (document.visibilityState === "visible") {
      markSeen(serverId, sessionId);
    }
    return () => {
      activeViewsRef.current.delete(key);
    };
  }, [markSeen]);

  return useMemo(
    () => ({
      servers,
      createSession,
      killSession,
      markSeen,
      startViewing,
    }),
    [servers, createSession, killSession, markSeen, startViewing]
  );
}
