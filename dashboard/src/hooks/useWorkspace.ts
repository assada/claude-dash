"use client";

import { useState, useCallback, useMemo } from "react";

export type WorkspaceLayout = "grid" | "columns" | "rows";

export interface WorkspacePane {
  id: string; // "serverId:sessionId"
  serverId: string;
  sessionId: string;
}

interface WorkspaceInternalState {
  panes: WorkspacePane[];
  focusedPaneId: string | null;
  layout: WorkspaceLayout;
  visible: boolean;
}

const MAX_PANES = 10;
const LS_LAYOUT_KEY = "workspace-layout";
const LS_PANES_KEY = "workspace-panes";

function readLayout(): WorkspaceLayout {
  if (typeof window === "undefined") return "columns";
  const v = localStorage.getItem(LS_LAYOUT_KEY);
  if (v === "columns" || v === "rows" || v === "grid") return v;
  return "columns";
}

function readPanes(): WorkspacePane[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(LS_PANES_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter(
      (p: unknown): p is WorkspacePane =>
        typeof p === "object" && p !== null &&
        typeof (p as WorkspacePane).id === "string" &&
        typeof (p as WorkspacePane).serverId === "string" &&
        typeof (p as WorkspacePane).sessionId === "string"
    ).slice(0, MAX_PANES);
  } catch {
    return [];
  }
}

function savePanes(panes: WorkspacePane[]) {
  if (typeof window === "undefined") return;
  if (panes.length === 0) {
    localStorage.removeItem(LS_PANES_KEY);
  } else {
    localStorage.setItem(LS_PANES_KEY, JSON.stringify(panes));
  }
}

export function useWorkspace() {
  const [state, setState] = useState<WorkspaceInternalState>(() => {
    const panes = readPanes();
    return {
      panes,
      focusedPaneId: panes.length > 0 ? panes[0].id : null,
      layout: readLayout(),
      visible: false,
    };
  });

  const openPane = useCallback((serverId: string, sessionId: string) => {
    const id = `${serverId}:${sessionId}`;
    setState((prev) => {
      const existing = prev.panes.find((p) => p.id === id);
      if (existing) {
        return { ...prev, focusedPaneId: id, visible: true };
      }
      if (prev.panes.length >= MAX_PANES) {
        return { ...prev, focusedPaneId: prev.panes[prev.panes.length - 1].id, visible: true };
      }
      const newPanes = [...prev.panes, { id, serverId, sessionId }];
      savePanes(newPanes);
      return {
        ...prev,
        panes: newPanes,
        focusedPaneId: id,
        visible: true,
      };
    });
  }, []);

  const closePane = useCallback((id: string) => {
    setState((prev) => {
      const idx = prev.panes.findIndex((p) => p.id === id);
      if (idx === -1) return prev;
      const newPanes = prev.panes.filter((p) => p.id !== id);
      savePanes(newPanes);
      let newFocused = prev.focusedPaneId;
      if (prev.focusedPaneId === id) {
        if (newPanes.length === 0) {
          newFocused = null;
        } else if (idx >= newPanes.length) {
          newFocused = newPanes[newPanes.length - 1].id;
        } else {
          newFocused = newPanes[idx].id;
        }
      }
      return {
        ...prev,
        panes: newPanes,
        focusedPaneId: newFocused,
        // Auto-hide when last pane closed
        visible: newPanes.length > 0 ? prev.visible : false,
      };
    });
  }, []);

  const focusPane = useCallback((id: string) => {
    setState((prev) => ({ ...prev, focusedPaneId: id }));
  }, []);

  const setLayout = useCallback((layout: WorkspaceLayout) => {
    localStorage.setItem(LS_LAYOUT_KEY, layout);
    setState((prev) => ({ ...prev, layout }));
  }, []);

  const closeAll = useCallback(() => {
    savePanes([]);
    setState((prev) => ({ ...prev, panes: [], focusedPaneId: null, visible: false }));
  }, []);

  const hideWorkspace = useCallback(() => {
    setState((prev) => ({ ...prev, visible: false }));
  }, []);

  const showWorkspace = useCallback(() => {
    setState((prev) => {
      if (prev.panes.length === 0) return prev;
      return { ...prev, visible: true };
    });
  }, []);

  const focusNext = useCallback(() => {
    setState((prev) => {
      if (prev.panes.length <= 1) return prev;
      const idx = prev.panes.findIndex((p) => p.id === prev.focusedPaneId);
      const nextIdx = (idx + 1) % prev.panes.length;
      return { ...prev, focusedPaneId: prev.panes[nextIdx].id };
    });
  }, []);

  const reorderPanes = useCallback((newPanes: WorkspacePane[]) => {
    setState((prev) => {
      savePanes(newPanes);
      return { ...prev, panes: newPanes };
    });
  }, []);

  const focusPrev = useCallback(() => {
    setState((prev) => {
      if (prev.panes.length <= 1) return prev;
      const idx = prev.panes.findIndex((p) => p.id === prev.focusedPaneId);
      const prevIdx = idx <= 0 ? prev.panes.length - 1 : idx - 1;
      return { ...prev, focusedPaneId: prev.panes[prevIdx].id };
    });
  }, []);

  const hasPanes = state.panes.length > 0;

  return useMemo(() => ({
    panes: state.panes,
    focusedPaneId: state.focusedPaneId,
    layout: state.layout,
    visible: state.visible,
    hasPanes,
    openPane,
    closePane,
    focusPane,
    setLayout,
    closeAll,
    hideWorkspace,
    showWorkspace,
    reorderPanes,
    focusNext,
    focusPrev,
  }), [state, hasPanes, openPane, closePane, focusPane, setLayout, closeAll, hideWorkspace, showWorkspace, reorderPanes, focusNext, focusPrev]);
}
