"use client";

import { useState, useCallback, useEffect, useRef, useMemo } from "react";

const STORAGE_KEY = "panel-positions";
const PANEL_WIDTH = 320;
const ROW_H = 300;
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

function calcCols(containerWidth: number): number {
  return Math.max(
    1,
    Math.floor((containerWidth - PAD_X * 2 + GAP) / (PANEL_WIDTH + GAP))
  );
}

/** Arrange all ids into a clean masonry grid (ignores existing positions). */
function arrange(
  ids: string[],
  containerWidth: number
): Record<string, PanelPosition> {
  const cols = calcCols(containerWidth);
  const colHeights = new Array(cols).fill(0);

  const result: Record<string, PanelPosition> = {};
  for (const id of ids) {
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

/**
 * Place new panels into the shortest column, respecting existing panel
 * positions. Existing panels are not moved.
 */
function arrangeNew(
  newIds: string[],
  existing: Record<string, PanelPosition>,
  containerWidth: number
): Record<string, PanelPosition> {
  const cols = calcCols(containerWidth);
  const colHeights = new Array(cols).fill(0);

  // Seed column heights from existing panel positions
  for (const pos of Object.values(existing)) {
    const col = Math.round((pos.x - PAD_X) / (PANEL_WIDTH + GAP));
    if (col >= 0 && col < cols) {
      colHeights[col] = Math.max(colHeights[col], pos.y - PAD_Y + ROW_H + GAP);
    }
  }

  const result: Record<string, PanelPosition> = {};
  for (const id of newIds) {
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
  const [positions, setPositions] = useState<Record<string, PanelPosition>>(load);
  const serverIdsRef = useRef(serverIds);

  useEffect(() => {
    serverIdsRef.current = serverIds;
  });


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

  // Ensure positions exist for all serverIds — compute missing positions
  // and persist to localStorage + state.
  const completePositions = useMemo(() => {
    // Only keep positions for current servers
    const kept: Record<string, PanelPosition> = {};
    for (const id of serverIds) {
      if (positions[id]) kept[id] = positions[id];
    }

    const missing = serverIds.filter((id) => !kept[id]);
    if (missing.length === 0 && Object.keys(kept).length === Object.keys(positions).length) {
      return positions;
    }
    if (missing.length === 0) return kept;

    const width = typeof window !== "undefined" ? window.innerWidth : 1200;
    const newPositions = Object.keys(kept).length > 0
      ? arrangeNew(missing, kept, width)
      : arrange(serverIds, width);
    const merged = { ...kept, ...newPositions };
    // Defer localStorage write to avoid side-effect in render
    queueMicrotask(() => save(merged));
    return merged;
  }, [positions, serverIds]);

  return useMemo(
    () => ({ positions: completePositions, updatePosition, arrangeAll }),
    [completePositions, updatePosition, arrangeAll]
  );
}
