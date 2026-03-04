"use client";

import { useEffect, useRef, useMemo, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import type { ServerStatus, SessionState } from "@/lib/types";
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
  }, []);

  return { soundEnabled, browserEnabled, permission, toggleSound, toggleBrowser, requestPermission };
}

export function useNotification(servers: ServerStatus[]) {
  const prevStatesRef = useRef<Map<string, SessionState>>(new Map());
  const { playDone, playAlert } = useNotificationSound();
  const router = useRouter();
  const soundEnabled = useRef(readPref(LS_SOUND, true));
  const browserEnabled = useRef(readPref(LS_BROWSER, true));

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

    if (doneSession && canNotify) {
      const { sessionName, serverName, serverId, sessionId } = doneSession;
      const n = new Notification("Session done", {
        body: `${sessionName} @ ${serverName}`,
        icon: "/favicon.ico",
      });
      n.onclick = () => {
        window.focus();
        router.push(`/server/${serverId}/session/${sessionId}`);
        n.close();
      };
    }

    if (alertSession && canNotify) {
      const { sessionName, serverName, serverId, sessionId } = alertSession;
      const n = new Notification("Session needs attention", {
        body: `${sessionName} @ ${serverName}`,
        icon: "/favicon.ico",
      });
      n.onclick = () => {
        window.focus();
        router.push(`/server/${serverId}/session/${sessionId}`);
        n.close();
      };
    }
  }, [servers, playDone, playAlert, router]);
}
