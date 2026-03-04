"use client";

import { useRef, useCallback } from "react";

export function useNotificationSound() {
  const doneRef = useRef<HTMLAudioElement | null>(null);
  const alertRef = useRef<HTMLAudioElement | null>(null);

  const playDone = useCallback(() => {
    if (!doneRef.current) {
      doneRef.current = new Audio("/done.wav");
      doneRef.current.volume = 0.5;
    }
    doneRef.current.currentTime = 0;
    doneRef.current.play().catch(() => {});
  }, []);

  const playAlert = useCallback(() => {
    if (!alertRef.current) {
      alertRef.current = new Audio("/alert.wav");
      alertRef.current.volume = 0.6;
    }
    alertRef.current.currentTime = 0;
    alertRef.current.play().catch(() => {});
  }, []);

  return { playDone, playAlert };
}
