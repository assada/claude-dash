"use client";

import { useState, useCallback } from "react";
import { StatusIndicator, StateLabel } from "./StatusIndicator";
import { ArrowLeft, X, SendHorizontal } from "lucide-react";
import { useIsMobile } from "@/hooks/useIsMobile";
import { shortName as formatShortName } from "@/lib/format";
import { useTerminalPane } from "./TerminalPane";
import type { SessionState } from "@/lib/types";

export function TerminalView({
  serverId,
  sessionId,
  sessionName,
  serverName,
  sessionState,
  onBack,
}: {
  serverId: string;
  sessionId: string;
  sessionName: string;
  serverName: string;
  sessionState: SessionState;
  onBack: () => void;
}) {
  const isMobile = useIsMobile();
  const [mobileInput, setMobileInput] = useState("");

  const { containerRef, connected, sendInput } = useTerminalPane({
    serverId,
    sessionId,
    isFocused: true,
    sessionState,
  });

  const shortName = formatShortName(sessionName);

  const handleMobileSubmit = useCallback(() => {
    if (mobileInput) {
      sendInput(mobileInput);
      setMobileInput("");
    }
    sendInput("\r");
  }, [mobileInput, sendInput]);

  return (
    <div className="h-dvh flex flex-col bg-[#0d1117]">
      {/* Header */}
      <div className="flex items-center gap-2 md:gap-3 px-3 md:px-4 py-2 bg-surface-0 border-b border-surface-1">
        <button onClick={onBack} className="btn-ghost flex items-center gap-1 text-[13px]">
          <ArrowLeft size={14} />{!isMobile && " Overview"}
        </button>
        <span className="text-border hidden md:inline">|</span>
        <span className="text-[13px] font-semibold text-text-secondary truncate">{shortName}</span>
        <span className="text-[11px] text-text-faint hidden md:inline">@ {serverName}</span>
        <div className="flex items-center gap-2 ml-auto">
          <StatusIndicator state={sessionState} size={8} />
          {!isMobile && <StateLabel state={sessionState} />}
          {!connected && (
            <span className="text-[11px] text-warn ml-2">disconnected</span>
          )}
        </div>
        <button onClick={onBack} className="btn-ghost p-1" data-tooltip="Close">
          <X size={14} />
        </button>
      </div>

      {/* Terminal */}
      <div className={`flex-1 min-h-0 ${isMobile ? "overflow-x-auto" : ""}`}>
        <div ref={containerRef} className={`p-1 h-full ${isMobile ? "w-max min-w-full" : ""}`} />
      </div>

      {/* Mobile input bar */}
      {isMobile && (
        <div className="flex items-center gap-2 px-2 py-1.5 bg-surface-0 border-t border-surface-1 safe-bottom">
          <div className="flex gap-1 shrink-0">
            <button
              onClick={() => sendInput("\x03")}
              className="h-[34px] px-2.5 rounded-md bg-surface-2 border border-border-subtle text-[11px] font-mono text-warn"
            >
              C-c
            </button>
            <button
              onClick={() => sendInput("\t")}
              className="h-[34px] px-2.5 rounded-md bg-surface-2 border border-border-subtle text-[11px] font-mono text-text-muted"
            >
              Tab
            </button>
            <button
              onClick={() => sendInput("\x1b")}
              className="h-[34px] px-2.5 rounded-md bg-surface-2 border border-border-subtle text-[11px] font-mono text-text-muted"
            >
              Esc
            </button>
          </div>

          <div className="flex flex-1 min-w-0 items-center bg-[rgba(10,10,10,0.3)] border border-border rounded-lg h-[34px]">
            <input
              type="text"
              value={mobileInput}
              onChange={(e) => setMobileInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleMobileSubmit();
                }
              }}
              placeholder="Type here..."
              className="flex-1 min-w-0 bg-transparent px-2.5 text-[16px] text-text-primary placeholder:text-text-faint outline-none"
              autoCapitalize="off"
              autoCorrect="off"
              autoComplete="off"
              spellCheck={false}
            />
            <button
              onClick={handleMobileSubmit}
              className="shrink-0 w-[34px] h-[34px] flex items-center justify-center rounded-r-lg bg-accent text-white"
            >
              <SendHorizontal size={15} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
