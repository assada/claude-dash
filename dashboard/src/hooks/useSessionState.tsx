"use client";

import { createContext, useContext, useEffect, useState, useRef, useCallback, useMemo } from "react";
import type { ServerStatus, SessionState, SessionInfo, ServerMetrics, ServerUsage, JSONLSessionData, SessionEvent } from "@/lib/types";
import { wsUrl } from "@/lib/format";

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
  // Store JSONL data in a ref that persists across renders
  const jsonlDataRef = useRef<Record<string, JSONLSessionData>>({});
  // Session event callback
  const sessionEventCallbackRef = useRef<((event: SessionEvent) => void) | null>(null);

  const onSessionEvent = useCallback((handler: (event: SessionEvent) => void) => {
    sessionEventCallbackRef.current = handler;
  }, []);

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

          // Persist JSONL data from incoming session
          if ((s as any).claudeSessionId) {
            jsonlDataRef.current[key] = {
              claudeSessionId: (s as any).claudeSessionId,
              currentActivity: (s as any).currentActivity,
              toolName: (s as any).toolName,
              model: (s as any).model,
              contextTokens: (s as any).contextTokens,
              contextLimit: (s as any).contextLimit,
              compactionCount: (s as any).compactionCount,
            };
          }

          // Merge JSONL data into session object
          const sessionObj: any = { ...s, state: displayState };
          const jsonlData = jsonlDataRef.current[key];
          if (jsonlData) {
            Object.assign(sessionObj, jsonlData);
          }

          return sessionObj as SessionInfo;
        });

      return { ...server, sessions };
    });

    // Clean up stale entries from tracking maps
    const currentKeys = new Set(
      filtered.flatMap((s) => s.sessions.map((ss) => `${s.id}:${ss.id}`))
    );
    for (const key of prevStates.keys()) {
      if (!currentKeys.has(key)) {
        prevStates.delete(key);
        waitingSet.delete(key);
      }
    }

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
            s.usage?.totalTokens === f.usage?.totalTokens
          );
        })
      ) {
        return prev;
      }
      return filtered;
    });
  }, []);

  // Process a targeted update (only one server, only changed fields)
  const applyTargetedUpdate = useCallback((msg: {
    type: string;
    serverId: string;
    sessions?: SessionInfo[];
    metrics?: ServerMetrics;
    serverInfo?: { hostname?: string; os?: string; agentVersion?: string; dirs?: string[] };
    usage?: ServerUsage;
    online?: boolean;
    sessionEvent?: SessionEvent;
  }) => {
    // Handle session events (fire callback, no state update needed)
    if (msg.type === "session_event" && msg.sessionEvent) {
      sessionEventCallbackRef.current?.(msg.sessionEvent);
      return;
    }

    const prevStates = prevStatesRef.current;
    const waitingSet = waitingSetRef.current;
    const activeViews = activeViewsRef.current;
    const isTabVisible = typeof document !== "undefined" && document.visibilityState === "visible";

    setServers((prev) => {
      const idx = prev.findIndex((s) => s.id === msg.serverId);
      if (idx === -1) return prev;

      const server = prev[idx];
      let changed = false;
      let updated = { ...server };

      if (msg.type === "sessions" && msg.sessions) {
        // Persist JSONL data from incoming sessions
        for (const s of msg.sessions) {
          if ((s as any).claudeSessionId) {
            const key = `${msg.serverId}:${s.id}`;
            jsonlDataRef.current[key] = {
              claudeSessionId: (s as any).claudeSessionId,
              currentActivity: (s as any).currentActivity,
              toolName: (s as any).toolName,
              model: (s as any).model,
              contextTokens: (s as any).contextTokens,
              contextLimit: (s as any).contextLimit,
              compactionCount: (s as any).compactionCount,
            };
          }
        }

        const newSessions = msg.sessions
          .filter((s) => s.state !== "dead")
          .map((s) => {
            const key = `${msg.serverId}:${s.id}`;
            const prevState = prevStates.get(key);
            if (prevState === "working" && s.state === "idle") {
              if (!(activeViews.has(key) && isTabVisible)) {
                waitingSet.add(key);
              }
            }
            if (s.state !== "idle") waitingSet.delete(key);
            prevStates.set(key, s.state);
            const displayState = waitingSet.has(key) ? "waiting" : s.state;

            // Merge JSONL data into session object
            const sessionObj: any = { ...s, state: displayState };
            const jsonlData = jsonlDataRef.current[key];
            if (jsonlData) {
              Object.assign(sessionObj, jsonlData);
            }
            return sessionObj as SessionInfo;
          });

        // Check if sessions actually changed
        if (
          server.sessions.length !== newSessions.length ||
          !server.sessions.every((ss, j) =>
            ss.id === newSessions[j]?.id &&
            ss.state === newSessions[j]?.state &&
            ss.last_line === newSessions[j]?.last_line &&
            ss.state_changed_at === newSessions[j]?.state_changed_at
          )
        ) {
          updated.sessions = newSessions;
          changed = true;
        }
      }

      if (msg.type === "metrics" && msg.metrics) {
        const m = msg.metrics;
        const pm = server.metrics;
        if (
          !pm ||
          pm.cpuPercent !== m.cpuPercent ||
          pm.memUsed !== m.memUsed ||
          pm.diskUsed !== m.diskUsed ||
          pm.uptimeSecs !== m.uptimeSecs
        ) {
          updated.metrics = m;
          changed = true;
        }
      }

      if (msg.type === "server_info" && msg.serverInfo) {
        const si = msg.serverInfo;
        if (
          server.agentVersion !== si.agentVersion ||
          server.hostname !== si.hostname ||
          server.os !== si.os
        ) {
          updated = { ...updated, ...si };
          changed = true;
        }
      }

      if (msg.type === "usage" && msg.usage) {
        if (
          server.usage?.totalCost !== msg.usage.totalCost ||
          server.usage?.totalTokens !== msg.usage.totalTokens
        ) {
          updated.usage = msg.usage;
          changed = true;
        }
      }

      if (msg.type === "connectivity" && msg.online !== undefined) {
        if (server.online !== msg.online) {
          updated.online = msg.online;
          changed = true;
        }
        // Also update sessions on connectivity change
        if (msg.sessions) {
          // Persist JSONL data from incoming sessions
          for (const s of msg.sessions) {
            if ((s as any).claudeSessionId) {
              const key = `${msg.serverId}:${s.id}`;
              jsonlDataRef.current[key] = {
                claudeSessionId: (s as any).claudeSessionId,
                currentActivity: (s as any).currentActivity,
                toolName: (s as any).toolName,
                model: (s as any).model,
                contextTokens: (s as any).contextTokens,
                contextLimit: (s as any).contextLimit,
                compactionCount: (s as any).compactionCount,
              };
            }
          }

          const newSessions = msg.sessions
            .filter((s) => s.state !== "dead")
            .map((s) => {
              const key = `${msg.serverId}:${s.id}`;
              prevStates.set(key, s.state);
              const displayState = waitingSet.has(key) ? "waiting" : s.state;

              // Merge JSONL data into session object
              const sessionObj: any = { ...s, state: displayState };
              const jsonlData = jsonlDataRef.current[key];
              if (jsonlData) {
                Object.assign(sessionObj, jsonlData);
              }
              return sessionObj as SessionInfo;
            });
          updated.sessions = newSessions;
          changed = true;
        }
      }

      if (!changed) return prev;
      const next = [...prev];
      next[idx] = updated;
      return next;
    });
  }, []);

  const connectRef = useRef<() => void>(null);

  useEffect(() => {
    const doConnect = () => {
      const ws = new WebSocket(wsUrl());
      wsRef.current = ws;

      ws.onopen = () => {
        ws.send(JSON.stringify({ type: "subscribe" }));
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === "state_update" && msg.servers) {
            processServers(msg.servers);
          } else if (msg.serverId) {
            // Targeted update: sessions, metrics, server_info, usage, connectivity
            applyTargetedUpdate(msg);
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
  }, [processServers, applyTargetedUpdate]);

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
      onSessionEvent,
    }),
    [servers, createSession, killSession, markSeen, startViewing, onSessionEvent]
  );
}
