"use client";

import { useState, useCallback, useEffect, useRef, useMemo } from "react";

const STORAGE_KEY = "panel-positions";
const PANEL_WIDTH = 320;
const GAP = 24;
const PAD_X = 32;
const PAD_Y = 56; // below header area

export interface PanelPosition {
  x: number;
  y: number;
}

function load(): Record<string, PanelPosition> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function save(positions: Record<string, PanelPosition>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(positions));
  } catch {}
}

function arrange(
  ids: string[],
  containerWidth: number
): Record<string, PanelPosition> {
  const cols = Math.max(
    1,
    Math.floor((containerWidth - PAD_X * 2 + GAP) / (PANEL_WIDTH + GAP))
  );

  // Column heights tracker for masonry-ish layout
  const colHeights = new Array(cols).fill(0);
  const ROW_H = 300;

  const result: Record<string, PanelPosition> = {};
  for (const id of ids) {
    // Find shortest column
    let minCol = 0;
    for (let c = 1; c < cols; c++) {
      if (colHeights[c] < colHeights[minCol]) minCol = c;
    }
    result[id] = {
      x: PAD_X + minCol * (PANEL_WIDTH + GAP),
      y: PAD_Y + colHeights[minCol],
    };
    colHeights[minCol] += ROW_H + GAP;
  }
  return result;
}

export function usePanelPositions(serverIds: string[]) {
  const [positions, setPositions] = useState<Record<string, PanelPosition>>({});
  const initializedRef = useRef(false);
  const serverIdsRef = useRef(serverIds);
  serverIdsRef.current = serverIds;

  // Initialize: load saved positions, auto-arrange any missing panels
  useEffect(() => {
    if (serverIds.length === 0) return;

    const saved = load();
    const width =
      typeof window !== "undefined" ? window.innerWidth : 1200;

    // Find IDs that don't have a saved position
    const missing = serverIds.filter((id) => !saved[id]);

    if (missing.length > 0) {
      // Arrange only the missing panels, offset by existing ones
      const arranged = arrange(missing, width);

      // Shift arranged panels below existing ones
      if (Object.keys(saved).length > 0 && missing.length < serverIds.length) {
        const maxY = Math.max(
          ...Object.values(saved).map((p) => p.y + 300),
          0
        );
        for (const id of missing) {
          arranged[id].y += maxY + GAP;
        }
      }

      const merged = { ...saved, ...arranged };
      // Only keep positions for current server IDs
      const cleaned: Record<string, PanelPosition> = {};
      for (const id of serverIds) {
        if (merged[id]) cleaned[id] = merged[id];
      }
      setPositions(cleaned);
      save(cleaned);
    } else {
      // All panels have saved positions
      const cleaned: Record<string, PanelPosition> = {};
      for (const id of serverIds) {
        if (saved[id]) cleaned[id] = saved[id];
      }
      setPositions(cleaned);
    }
    initializedRef.current = true;
  }, [serverIds.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  const updatePosition = useCallback(
    (id: string, pos: PanelPosition) => {
      setPositions((prev) => {
        const next = { ...prev, [id]: pos };
        save(next);
        return next;
      });
    },
    []
  );

  const arrangeAll = useCallback(() => {
    const width =
      typeof window !== "undefined" ? window.innerWidth : 1200;
    const arranged = arrange(serverIdsRef.current, width);
    setPositions(arranged);
    save(arranged);
  }, []);

  return useMemo(
    () => ({ positions, updatePosition, arrangeAll }),
    [positions, updatePosition, arrangeAll]
  );
}
