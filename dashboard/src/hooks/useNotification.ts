"use client";

import { useEffect, useRef } from "react";
import type { ServerStatus } from "@/lib/types";

export function useNotification(servers: ServerStatus[]) {
  const prevAttentionCount = useRef(0);

  useEffect(() => {
    let count = 0;
    for (const server of servers) {
      for (const session of server.sessions) {
        if (session.state === "needs_attention") {
          count++;
        }
      }
    }

    // Update tab title
    if (count > 0) {
      document.title = `(${count}) ADHD Dashboard`;
    } else {
      document.title = "ADHD Dashboard";
    }

    // New attention needed - show notification
    if (count > prevAttentionCount.current && prevAttentionCount.current >= 0) {
      // Browser notification
      if (Notification.permission === "granted") {
        new Notification("ADHD Dashboard", {
          body: `${count} session(s) need your attention`,
          icon: "/favicon.ico",
        });
      }
    }

    prevAttentionCount.current = count;
  }, [servers]);

  // Request notification permission on mount
  useEffect(() => {
    if (
      typeof Notification !== "undefined" &&
      Notification.permission === "default"
    ) {
      Notification.requestPermission();
    }
  }, []);
}
