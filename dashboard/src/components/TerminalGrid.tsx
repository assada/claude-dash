"use client";

import { useState, useRef, useCallback, Fragment } from "react";
import { Reorder, useDragControls } from "framer-motion";
import type { DragControls } from "framer-motion";
import type { WorkspaceLayout, WorkspacePane } from "@/hooks/useWorkspace";

/* ─── Resize Handle ─── */

function ResizeHandle({
  axis,
  onResize,
}: {
  axis: "x" | "y";
  onResize: (delta: number) => void;
}) {
  const [dragging, setDragging] = useState(false);

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(true);
    let last = axis === "x" ? e.clientX : e.clientY;

    const onMove = (me: PointerEvent) => {
      const current = axis === "x" ? me.clientX : me.clientY;
      onResize(current - last);
      last = current;
    };

    const onUp = () => {
      setDragging(false);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return (
    <div
      onPointerDown={onPointerDown}
      className={`shrink-0 transition-colors ${
        axis === "x"
          ? "w-[5px] cursor-col-resize"
          : "h-[5px] cursor-row-resize"
      } ${dragging ? "bg-accent/40" : "hover:bg-accent/20"}`}
    />
  );
}

/* ─── Reorderable Pane Wrapper ─── */

function PaneWrapper({
  pane,
  flex,
  children,
}: {
  pane: WorkspacePane;
  flex: number;
  children: (controls: DragControls) => React.ReactNode;
}) {
  const controls = useDragControls();
  return (
    <Reorder.Item
      value={pane}
      dragListener={false}
      dragControls={controls}
      style={{ flex }}
      className="min-w-0 min-h-0"
      whileDrag={{ opacity: 0.8, scale: 0.98 }}
      transition={{ duration: 0.15 }}
    >
      {children(controls)}
    </Reorder.Item>
  );
}

/* ─── Main Grid ─── */

export function TerminalGrid({
  layout,
  panes,
  onReorder,
  renderPane,
}: {
  layout: WorkspaceLayout;
  panes: WorkspacePane[];
  onReorder: (panes: WorkspacePane[]) => void;
  renderPane: (pane: WorkspacePane, dragControls: DragControls) => React.ReactNode;
}) {
  // Per-pane flex sizes (paneId → ratio). Default 1.
  const [sizes, setSizes] = useState<Record<string, number>>({});
  const containerRef = useRef<HTMLUListElement>(null);

  const getSize = useCallback((id: string) => sizes[id] ?? 1, [sizes]);

  const handleResize = useCallback(
    (leftId: string, rightId: string, delta: number) => {
      const container = containerRef.current;
      if (!container) return;

      setSizes((prev) => {
        const leftSize = prev[leftId] ?? 1;
        const rightSize = prev[rightId] ?? 1;
        const total = leftSize + rightSize;

        // Compute container size in the relevant axis
        const containerSize =
          layout === "columns" ? container.offsetWidth : container.offsetHeight;

        // Total flex units for all panes
        const totalFlex = panes.reduce((s, p) => s + (prev[p.id] ?? 1), 0);
        const pxPerUnit = containerSize / totalFlex;
        const deltaUnits = delta / pxPerUnit;

        const newLeft = Math.max(0.15, leftSize + deltaUnits);
        const newRight = Math.max(0.15, total - newLeft);

        return { ...prev, [leftId]: newLeft, [rightId]: newRight };
      });
    },
    [layout, panes]
  );

  // Grid layout: simple CSS grid, no reorder/resize
  if (layout === "grid") {
    return (
      <div
        className="grid gap-[2px] h-full w-full grid-cols-[repeat(auto-fill,minmax(min(400px,100%),1fr))]"
        style={{ gridAutoRows: "1fr" }}
      >
        {panes.map((pane) => (
          <div key={pane.id} className="min-h-0">
            {renderPane(pane, null!)}
          </div>
        ))}
      </div>
    );
  }

  // Columns / Rows: Reorder + Resize
  const axis = layout === "columns" ? "x" : "y";
  const flexDir = layout === "columns" ? "flex-row" : "flex-col";

  return (
    <Reorder.Group
      ref={containerRef}
      axis={axis}
      values={panes}
      onReorder={onReorder}
      className={`flex ${flexDir} h-full w-full`}
      style={{ gap: 0 }}
    >
      {panes.map((pane, i) => (
        <Fragment key={pane.id}>
          <PaneWrapper pane={pane} flex={getSize(pane.id)}>
            {(controls) => renderPane(pane, controls)}
          </PaneWrapper>
          {i < panes.length - 1 && (
            <ResizeHandle
              axis={axis}
              onResize={(delta) =>
                handleResize(pane.id, panes[i + 1].id, delta)
              }
            />
          )}
        </Fragment>
      ))}
    </Reorder.Group>
  );
}
