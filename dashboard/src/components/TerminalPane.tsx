"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import "@xterm/xterm/css/xterm.css";
import type { SessionState } from "@/lib/types";
import { wsUrl } from "@/lib/format";
import { useIsMobile } from "@/hooks/useIsMobile";

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

/**
 * Hook that manages a terminal instance + WebSocket connection.
 * Returns containerRef (attach to a div), connected state, and sendInput.
 */
export function useTerminalPane({
  serverId,
  sessionId,
  isFocused,
  sessionState,
  terminalOnly = false,
}: {
  serverId: string;
  sessionId: string;
  isFocused: boolean;
  sessionState: SessionState;
  terminalOnly?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const attachedRef = useRef(false);
  const initialStateRef = useRef(sessionState);
  const isMobile = useIsMobile();

  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    if (isFocused) {
      term.focus();
    } else {
      term.blur();
    }
  }, [isFocused]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let term: Terminal | null = null;
    let fitAddon: FitAddon | null = null;
    let disposed = false;
    const mobile = isMobile;
    const MOBILE_MIN_COLS = 80;

    const handleResize = () => {
      if (!fitAddon || !term) return;
      if (mobile) {
        const dims = fitAddon.proposeDimensions();
        if (dims) {
          term.resize(Math.max(dims.cols, MOBILE_MIN_COLS), dims.rows);
        }
      } else {
        fitAddon.fit();
      }
    };

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
    };

    let resizeObserver: ResizeObserver | null = null;

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
        const dims = fitAddon.proposeDimensions();
        if (dims) {
          term.resize(Math.max(dims.cols, MOBILE_MIN_COLS), dims.rows);
        }
      } else {
        fitAddon.fit();
      }

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

      resizeObserver = new ResizeObserver(handleResize);
      resizeObserver.observe(el);

      if (mobile) {
        el.addEventListener("touchstart", onTouchStart, { passive: true });
        el.addEventListener("touchmove", onTouchMove, { passive: false });
      }

      const ws = new WebSocket(wsUrl(terminalOnly ? "/ws?terminal_only=1" : "/ws"));
      wsRef.current = ws;

      const t = term;

      ws.onopen = () => {
        setConnected(true);
        const isDead = initialStateRef.current === "dead";
        if (isDead) {
          t.write("\r\n\x1b[1;31m--- Session ended ---\x1b[0m\r\n");
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
      resizeObserver?.disconnect();
      if (mobile) {
        el.removeEventListener("touchstart", onTouchStart);
        el.removeEventListener("touchmove", onTouchMove);
      }
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "terminal_detach" }));
        ws.close();
      }
      attachedRef.current = false;
      term?.dispose();
      termRef.current = null;
      wsRef.current = null;
    };
  }, [serverId, sessionId, terminalOnly, isMobile]);

  const sendInput = useCallback((data: string) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "terminal_input", data: encodeBase64(data) }));
    }
  }, []);

  return { containerRef, connected, sendInput };
}

/**
 * Simple component wrapper around useTerminalPane for use in JSX.
 */
export function TerminalPaneView({
  serverId,
  sessionId,
  isFocused,
  sessionState,
  terminalOnly = false,
}: {
  serverId: string;
  sessionId: string;
  isFocused: boolean;
  sessionState: SessionState;
  terminalOnly?: boolean;
}) {
  const { containerRef } = useTerminalPane({
    serverId,
    sessionId,
    isFocused,
    sessionState,
    terminalOnly,
  });

  return <div ref={containerRef} className="p-1 h-full w-full" />;
}
