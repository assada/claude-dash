"use client";

import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import "@xterm/xterm/css/xterm.css";
import { StatusIndicator, StateLabel } from "./StatusIndicator";
import { ArrowLeft, X } from "lucide-react";
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
  const attachedRef = useRef(false);
  const initialStateRef = useRef(sessionState);

  useEffect(() => {
    const el = terminalRef.current;
    if (!el) return;

    let term: Terminal | null = null;
    let fitAddon: FitAddon | null = null;
    let disposed = false;

    const handleResize = () => { fitAddon?.fit(); };

    // Wait for layout so the container has real dimensions.
    // xterm.js requires the element to have dimensions when open() is called.
    const rafId = requestAnimationFrame(() => {
      if (disposed) return;

      term = new Terminal({
        cursorBlink: true,
        fontSize: 14,
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
      fitAddon.fit();
      term.focus();

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

  const shortName = sessionName.replace(/^cc-\d+-/, "");

  return (
    <div className="h-screen flex flex-col bg-[#0d1117]">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-2 bg-surface-0 border-b border-surface-1">
        <button onClick={onBack} className="btn-ghost flex items-center gap-1 text-[13px]">
          <ArrowLeft size={14} /> Overview
        </button>
        <span className="text-border">|</span>
        <span className="text-[13px] font-semibold text-text-secondary">{shortName}</span>
        <span className="text-[11px] text-text-faint">@ {serverName}</span>
        <div className="flex items-center gap-2 ml-auto">
          <StatusIndicator state={sessionState} size={8} />
          <StateLabel state={sessionState} />
          {!connected && (
            <span className="text-[11px] text-warn ml-2">disconnected</span>
          )}
        </div>
        <button onClick={onBack} className="btn-ghost p-1" title="Close">
          <X size={14} />
        </button>
      </div>

      {/* Terminal */}
      <div ref={terminalRef} className="flex-1 p-1" />
    </div>
  );
}
