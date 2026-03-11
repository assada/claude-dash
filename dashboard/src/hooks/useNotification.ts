"use client";

import { useEffect, useRef, useMemo, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import type { ServerStatus, SessionState, SessionEvent } from "@/lib/types";
import { useNotificationSound } from "./useNotificationSound";

const LS_SOUND = "notif-sound-enabled";
const LS_BROWSER = "notif-browser-enabled";

function readPref(key: string, fallback: boolean): boolean {
  if (typeof window === "undefined") return fallback;
  const v = localStorage.getItem(key);
  return v === null ? fallback : v === "true";
}

function getPermission(): NotificationPermission {
  if (typeof Notification === "undefined") return "denied";
  return Notification.permission;
}

export function useNotificationPrefs() {
  const [soundEnabled, setSoundEnabled] = useState(() => readPref(LS_SOUND, true));
  const [browserEnabled, setBrowserEnabled] = useState(() => readPref(LS_BROWSER, true));
  const [permission, setPermission] = useState<NotificationPermission>(getPermission);

  const toggleSound = useCallback(() => {
    setSoundEnabled((v) => {
      const next = !v;
      localStorage.setItem(LS_SOUND, String(next));
      return next;
    });
  }, []);

  const toggleBrowser = useCallback(async () => {
    const next = !browserEnabled;
    if (next && typeof Notification !== "undefined" && Notification.permission === "default") {
      const result = await Notification.requestPermission();
      setPermission(result);
      if (result === "denied") return; // don't enable if denied
    }
    setBrowserEnabled(next);
    localStorage.setItem(LS_BROWSER, String(next));
  }, [browserEnabled]);

  const requestPermission = useCallback(async () => {
    if (typeof Notification === "undefined") return;
    const result = await Notification.requestPermission();
    setPermission(result);
    if (result === "granted") {
      setBrowserEnabled(true);
      localStorage.setItem(LS_BROWSER, "true");
    }
  }, []);

  return { soundEnabled, browserEnabled, permission, toggleSound, toggleBrowser, requestPermission };
}

export function useNotification(
  servers: ServerStatus[],
  onOpenPane?: (serverId: string, sessionId: string) => void,
  onSessionEvent?: (handler: (event: SessionEvent) => void) => void,
) {
  const prevStatesRef = useRef<Map<string, SessionState>>(new Map());
  const { playDone, playAlert, playInfo } = useNotificationSound();
  const router = useRouter();
  const soundEnabled = useRef(readPref(LS_SOUND, true));
  const browserEnabled = useRef(readPref(LS_BROWSER, true));
  const onOpenPaneRef = useRef(onOpenPane);

  useEffect(() => {
    onOpenPaneRef.current = onOpenPane;
  });

  // Keep refs in sync with localStorage (poll-free via storage event)
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === LS_SOUND) soundEnabled.current = e.newValue !== "false";
      if (e.key === LS_BROWSER) browserEnabled.current = e.newValue !== "false";
    };
    soundEnabled.current = readPref(LS_SOUND, true);
    browserEnabled.current = readPref(LS_BROWSER, true);
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const attentionCount = useMemo(() => {
    let count = 0;
    for (const server of servers) {
      for (const session of server.sessions) {
        if (session.state === "needs_attention") count++;
      }
    }
    return count;
  }, [servers]);

  useEffect(() => {
    if (attentionCount > 0) {
      document.title = `(${attentionCount}) ADHD Dashboard`;
    } else {
      document.title = "ADHD Dashboard";
    }
  }, [attentionCount]);

  useEffect(() => {
    const prevStates = prevStatesRef.current;
    let didDone = false;
    let doneSession: { sessionName: string; serverName: string; serverId: string; sessionId: string } | null = null;
    let alertSession: { sessionName: string; serverName: string; serverId: string; sessionId: string } | null = null;

    for (const server of servers) {
      for (const session of server.sessions) {
        const key = `${server.id}:${session.id}`;
        const prev = prevStates.get(key);

        // working → waiting (done sound + browser notification)
        if (prev === "working" && session.state === "waiting") {
          didDone = true;
          doneSession = {
            sessionName: session.name,
            serverName: server.name,
            serverId: server.id,
            sessionId: session.id,
          };
        }

        // * → needs_attention (alert sound + browser notification)
        if (prev && prev !== "needs_attention" && session.state === "needs_attention") {
          alertSession = {
            sessionName: session.name,
            serverName: server.name,
            serverId: server.id,
            sessionId: session.id,
          };
        }

        prevStates.set(key, session.state);
      }
    }

    // Clean up stale keys
    const currentKeys = new Set<string>();
    for (const server of servers) {
      for (const session of server.sessions) {
        currentKeys.add(`${server.id}:${session.id}`);
      }
    }
    for (const key of prevStates.keys()) {
      if (!currentKeys.has(key)) prevStates.delete(key);
    }

    if (didDone && soundEnabled.current) playDone();
    if (alertSession && soundEnabled.current) playAlert();

    const canNotify = browserEnabled.current &&
      typeof Notification !== "undefined" &&
      Notification.permission === "granted";

    const showNotification = (title: string, info: { sessionName: string; serverName: string; serverId: string; sessionId: string }) => {
      const n = new Notification(title, {
        body: `${info.sessionName} @ ${info.serverName}`,
        icon: "/favicon.ico",
      });
      n.onclick = () => {
        window.focus();
        if (onOpenPaneRef.current) {
          onOpenPaneRef.current(info.serverId, info.sessionId);
        } else {
          router.push(`/server/${info.serverId}/session/${info.sessionId}`);
        }
        n.close();
      };
    };

    if (doneSession && canNotify) showNotification("Session done", doneSession);
    if (alertSession && canNotify) showNotification("Session needs attention", alertSession);
  }, [servers, playDone, playAlert, router]);

  // Simple notification helper for session events (Errata E13)
  const showEventNotification = useCallback((title: string, body: string) => {
    if (!browserEnabled.current || Notification.permission !== "granted") return;
    new Notification(title, { body, icon: "/favicon.ico" });
  }, []);

  // Handle session events (errors, rate limits, compaction)
  useEffect(() => {
    if (!onSessionEvent) return;
    onSessionEvent((event: SessionEvent) => {
      if (!soundEnabled.current) return;
      switch (event.event) {
        case "error":
          playAlert();
          showEventNotification("Tool error", event.message);
          break;
        case "rate_limit":
          playAlert();
          showEventNotification("Rate limited", event.message);
          break;
        case "compaction":
          playInfo();
          showEventNotification("Context compacted", event.message);
          break;
      }
    });
  }, [playAlert, playInfo, showEventNotification, onSessionEvent]);
}
