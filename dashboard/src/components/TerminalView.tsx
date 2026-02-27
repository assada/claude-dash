"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import "@xterm/xterm/css/xterm.css";
import { StatusIndicator, StateLabel } from "./StatusIndicator";
import { ArrowLeft, X, SendHorizontal } from "lucide-react";
import { useIsMobile } from "@/hooks/useIsMobile";
import { shortName as formatShortName } from "@/lib/format";
import type { SessionState } from "@/lib/types";

function encodeBase64(str: string): string {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(str);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function decodeBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

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
  const terminalRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [mobileInput, setMobileInput] = useState("");
  const attachedRef = useRef(false);
  const initialStateRef = useRef(sessionState);
  const isMobile = useIsMobile();

  useEffect(() => {
    const el = terminalRef.current;
    if (!el) return;

    let term: Terminal | null = null;
    let fitAddon: FitAddon | null = null;
    let disposed = false;
    const mobile = window.matchMedia("(max-width: 767px)").matches;

    const MOBILE_MIN_COLS = 80;

    const handleResize = () => {
      if (!fitAddon || !term) return;
      if (mobile) {
        // On mobile: fit rows to container height, keep cols >= 80
        const dims = fitAddon.proposeDimensions();
        if (dims) {
          const cols = Math.max(dims.cols, MOBILE_MIN_COLS);
          term.resize(cols, dims.rows);
        }
      } else {
        fitAddon.fit();
      }
    };

    // Block pull-to-refresh on iOS — must be on html/body to work
    if (mobile) {
      document.documentElement.style.overscrollBehavior = "none";
      document.body.style.overscrollBehavior = "none";
      document.body.style.overflow = "hidden";
    }

    // Touch scroll for xterm (direction-locked: vertical → scrollLines, horizontal → native)
    let touchStartX = 0;
    let touchStartY = 0;
    let scrollDir: "v" | "h" | null = null;

    const onTouchStart = (e: TouchEvent) => {
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
      scrollDir = null;
    };
    const onTouchMove = (e: TouchEvent) => {
      const cx = e.touches[0].clientX;
      const cy = e.touches[0].clientY;
      const dx = cx - touchStartX;
      const dy = cy - touchStartY;

      if (!scrollDir) {
        if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 3) scrollDir = "v";
        else if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 3) scrollDir = "h";
        else return;
      }

      if (scrollDir === "v") {
        e.preventDefault();
        const delta = touchStartY - cy;
        touchStartY = cy;
        // Dispatch synthetic wheel on xterm's viewport element —
        // that's where xterm.js listens for wheel events
        const viewport = el.querySelector(".xterm-viewport");
        if (viewport) {
          viewport.dispatchEvent(new WheelEvent("wheel", {
            deltaY: delta * 3,
            deltaMode: WheelEvent.DOM_DELTA_PIXEL,
            bubbles: true,
            cancelable: true,
          }));
        }
      }
      // horizontal: do nothing, native overflow-x scroll handles it
    };

    // Wait for layout so the container has real dimensions.
    // xterm.js requires the element to have dimensions when open() is called.
    const rafId = requestAnimationFrame(() => {
      if (disposed) return;

      term = new Terminal({
        cursorBlink: true,
        fontSize: mobile ? 11 : 14,
        fontFamily: "JetBrains Mono NF, JetBrains Mono, Menlo, Consolas, monospace",
        theme: {
          background: "#0d1117",
          foreground: "#e6edf3",
          cursor: "#58a6ff",
          selectionBackground: "#264f78",
          black: "#0d1117",
          red: "#ff7b72",
          green: "#3fb950",
          yellow: "#d29922",
          blue: "#58a6ff",
          magenta: "#bc8cff",
          cyan: "#39d353",
          white: "#e6edf3",
          brightBlack: "#484f58",
          brightRed: "#ffa198",
          brightGreen: "#56d364",
          brightYellow: "#e3b341",
          brightBlue: "#79c0ff",
          brightMagenta: "#d2a8ff",
          brightCyan: "#56d364",
          brightWhite: "#f0f6fc",
        },
        scrollback: 50000,
        allowProposedApi: true,
      });

      fitAddon = new FitAddon();
      const searchAddon = new SearchAddon();
      term.loadAddon(fitAddon);
      term.loadAddon(searchAddon);

      term.open(el);
      if (mobile) {
        // Fit rows to container, but ensure min 80 cols for horizontal scroll
        const dims = fitAddon.proposeDimensions();
        if (dims) {
          term.resize(Math.max(dims.cols, MOBILE_MIN_COLS), dims.rows);
        }
      } else {
        fitAddon.fit();
      }
      if (!mobile) term.focus();

      // Shift+Enter: xterm.js doesn't produce a distinct sequence by default.
      // Send CSI u encoding (\x1b[13;2u) so Claude Code can detect it.
      term.attachCustomKeyEventHandler((e: KeyboardEvent) => {
        if (e.key === "Enter" && e.shiftKey && e.type === "keydown") {
          const ws = wsRef.current;
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "terminal_input", data: encodeBase64("\x1b[13;2u") }));
          }
          return false;
        }
        return true;
      });

      termRef.current = term;
      fitRef.current = fitAddon;

      term.onData((data) => {
        const ws = wsRef.current;
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "terminal_input", data: encodeBase64(data) }));
        }
      });

      term.onBinary((data) => {
        const ws = wsRef.current;
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "terminal_input", data: btoa(data) }));
        }
      });

      term.onResize(({ cols, rows }) => {
        const ws = wsRef.current;
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "terminal_resize", cols, rows }));
        }
      });

      window.addEventListener("resize", handleResize);

      if (mobile) {
        el.addEventListener("touchstart", onTouchStart, { passive: true });
        el.addEventListener("touchmove", onTouchMove, { passive: false });
      }

      // Connect WS after terminal is fully initialized
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
      wsRef.current = ws;

      const t = term; // capture for closure

      ws.onopen = () => {
        setConnected(true);
        const isDead = initialStateRef.current === "dead";
        if (isDead) {
          ws.send(JSON.stringify({ type: "get_scrollback", serverId, sessionId }));
        } else {
          const cols = t.cols || 200;
          const rows = t.rows || 50;
          ws.send(JSON.stringify({ type: "terminal_attach", serverId, sessionId, cols, rows }));
          attachedRef.current = true;
        }
      };

      ws.onmessage = (event) => {
        let msg;
        try { msg = JSON.parse(event.data); } catch { return; }

        if (msg.type === "scrollback" && msg.data) {
          const bytes = decodeBase64(msg.data);
          t.write(new TextDecoder().decode(bytes));
          if (initialStateRef.current === "dead") {
            t.write("\r\n\x1b[1;31m--- Session ended ---\x1b[0m\r\n");
          }
        }
        if (msg.type === "terminal_output" && msg.data) {
          t.write(decodeBase64(msg.data));
        }
        if (msg.type === "error" && msg.message) {
          t.write(`\r\n\x1b[1;31mError: ${msg.message}\x1b[0m\r\n`);
        }
      };

      ws.onclose = () => { setConnected(false); attachedRef.current = false; };
      ws.onerror = () => { setConnected(false); };
    });

    return () => {
      disposed = true;
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", handleResize);
      if (mobile) {
        el.removeEventListener("touchstart", onTouchStart);
        el.removeEventListener("touchmove", onTouchMove);
        document.documentElement.style.overscrollBehavior = "";
        document.body.style.overscrollBehavior = "";
        document.body.style.overflow = "";
      }
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "terminal_detach" }));
        ws.close();
      }
      attachedRef.current = false;
      term?.dispose();
      termRef.current = null;
      fitRef.current = null;
      wsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverId, sessionId]);

  const shortName = formatShortName(sessionName);

  const sendInput = useCallback((data: string) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "terminal_input", data: encodeBase64(data) }));
    }
  }, []);

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
        <button onClick={onBack} className="btn-ghost p-1" title="Close">
          <X size={14} />
        </button>
      </div>

      {/* Terminal — horizontal scroll on mobile */}
      <div className={`flex-1 min-h-0 ${isMobile ? "overflow-x-auto" : ""}`}>
        <div ref={terminalRef} className={`p-1 h-full ${isMobile ? "w-max min-w-full" : ""}`} />
      </div>

      {/* Mobile input bar */}
      {isMobile && (
        <div className="flex items-center gap-2 px-2 py-1.5 bg-surface-0 border-t border-surface-1 safe-bottom">
          {/* Shortcut keys */}
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

          {/* Input + Send group */}
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
