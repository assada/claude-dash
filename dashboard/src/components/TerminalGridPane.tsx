"use client";

import { X, Maximize2, GripVertical } from "lucide-react";
import { StatusIndicator } from "./StatusIndicator";
import { TerminalPaneView } from "./TerminalPane";
import { shortName } from "@/lib/format";
import type { DragControls } from "framer-motion";
import type { SessionState } from "@/lib/types";

export function TerminalGridPane({
  serverId,
  sessionId,
  sessionName,
  workdir,
  serverName,
  sessionState,
  isFocused,
  dragControls,
  onFocus,
  onClose,
  onFullscreen,
}: {
  serverId: string;
  sessionId: string;
  sessionName: string;
  workdir?: string;
  serverName: string;
  sessionState: SessionState;
  isFocused: boolean;
  dragControls?: DragControls;
  onFocus: () => void;
  onClose: () => void;
  onFullscreen: () => void;
}) {
  return (
    <div
      className={`group/pane flex flex-col min-h-0 h-full bg-[#0d1117] rounded-sm overflow-hidden ${
        isFocused ? "ring-1 ring-accent/50" : "ring-1 ring-transparent"
      }`}
      onMouseDown={onFocus}
    >
      {/* Compact header — drag handle for reorder */}
      <div
        className="flex items-center gap-1.5 px-2 py-1 bg-surface-0 border-b border-surface-1 shrink-0 select-none"
        onPointerDown={(e) => {
          if (dragControls) {
            // Only start reorder drag from header, not buttons
            const target = e.target as HTMLElement;
            if (target.closest("button")) return;
            dragControls.start(e);
          }
        }}
        style={{ cursor: dragControls ? "grab" : undefined, touchAction: "none" }}
      >
        {dragControls && (
          <GripVertical size={10} className="text-text-faint shrink-0" />
        )}
        <StatusIndicator state={sessionState} size={6} />
        <span
          className="text-[11px] font-medium text-text-secondary truncate flex-1"
          style={{ direction: "rtl", textAlign: "left" }}
        >
          {shortName(sessionName, workdir)}
        </span>
        <span className="text-[10px] text-text-faint truncate max-w-[80px]">
          {serverName}
        </span>
        <button
          onClick={(e) => { e.stopPropagation(); onFullscreen(); }}
          className={`btn-ghost p-0.5 transition-opacity ${isFocused ? "opacity-60" : "opacity-0 group-hover/pane:opacity-40 hover:!opacity-80"}`}
          data-tooltip="Fullscreen"
        >
          <Maximize2 size={10} />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onClose(); }}
          className={`btn-ghost p-0.5 transition-opacity ${isFocused ? "opacity-60" : "opacity-0 group-hover/pane:opacity-40 hover:!opacity-80"}`}
          data-tooltip="Close (Ctrl+Shift+W)"
        >
          <X size={10} />
        </button>
      </div>

      {/* Terminal */}
      <div className="flex-1 min-h-0">
        <TerminalPaneView
          serverId={serverId}
          sessionId={sessionId}
          isFocused={isFocused}
          sessionState={sessionState}
          terminalOnly
        />
      </div>
    </div>
  );
}
