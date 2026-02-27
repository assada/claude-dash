"use client";

import { useEffect, useRef } from "react";

export function useNotification(attentionCount: number) {
  const prevAttentionCount = useRef(0);

  useEffect(() => {
    // Update tab title
    if (attentionCount > 0) {
      document.title = `(${attentionCount}) ADHD Dashboard`;
    } else {
      document.title = "ADHD Dashboard";
    }

    // New attention needed - show notification
    if (attentionCount > prevAttentionCount.current && prevAttentionCount.current >= 0) {
      if (Notification.permission === "granted") {
        new Notification("ADHD Dashboard", {
          body: `${attentionCount} session(s) need your attention`,
          icon: "/favicon.ico",
        });
      }
    }

    prevAttentionCount.current = attentionCount;
  }, [attentionCount]);

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
