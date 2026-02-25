"use client";

import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import "@xterm/xterm/css/xterm.css";
import { StatusIndicator, StateLabel } from "./StatusIndicator";
import { ArrowLeft, X } from "lucide-react";
import type { SessionState } from "@/lib/types";

// Proper binary-safe base64 encode/decode for terminal data
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

  // Terminal setup — runs ONCE on mount
  useEffect(() => {
    if (!terminalRef.current) return;

    const term = new Terminal({
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

    const fitAddon = new FitAddon();
    const searchAddon = new SearchAddon();

    term.loadAddon(fitAddon);
    term.loadAddon(searchAddon);

    term.open(terminalRef.current);

    // Small delay to ensure container has real dimensions before fit
    requestAnimationFrame(() => {
      fitAddon.fit();
    });

    termRef.current = term;
    fitRef.current = fitAddon;

    // Handle terminal input — send raw bytes to PTY
    term.onData((data) => {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            type: "terminal_input",
            data: encodeBase64(data),
          })
        );
      }
    });

    // Also handle binary data (for special keys)
    term.onBinary((data) => {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        // data is already a binary string, encode directly
        ws.send(
          JSON.stringify({
            type: "terminal_input",
            data: btoa(data),
          })
        );
      }
    });

    // Handle window resize
    const handleResize = () => {
      fitAddon.fit();
    };

    // When xterm resizes, tell the agent
    term.onResize(({ cols, rows }) => {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "terminal_resize", cols, rows }));
      }
    });

    window.addEventListener("resize", handleResize);

    // Connect WebSocket
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);

      const isDead = initialStateRef.current === "dead";

      if (isDead) {
        // Dead session: just get scrollback (read-only)
        ws.send(
          JSON.stringify({
            type: "get_scrollback",
            serverId,
            sessionId,
          })
        );
      } else {
        // Live session: attach directly — tmux will redraw the screen
        const cols = term.cols || 200;
        const rows = term.rows || 50;
        ws.send(
          JSON.stringify({
            type: "terminal_attach",
            serverId,
            sessionId,
            cols,
            rows,
          })
        );
        attachedRef.current = true;
      }
    };

    ws.onmessage = (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }

      if (msg.type === "scrollback" && msg.data) {
        const bytes = decodeBase64(msg.data);
        const decoded = new TextDecoder().decode(bytes);
        term.write(decoded);

        if (initialStateRef.current === "dead") {
          term.write("\r\n\x1b[1;31m--- Session ended ---\x1b[0m\r\n");
        }
      }

      if (msg.type === "terminal_output" && msg.data) {
        // Raw PTY output — write as binary Uint8Array to preserve all bytes
        const bytes = decodeBase64(msg.data);
        term.write(bytes);
      }

      if (msg.type === "error" && msg.message) {
        term.write(`\r\n\x1b[1;31mError: ${msg.message}\x1b[0m\r\n`);
      }
    };

    ws.onclose = () => {
      setConnected(false);
      attachedRef.current = false;
    };

    ws.onerror = () => {
      setConnected(false);
    };

    return () => {
      window.removeEventListener("resize", handleResize);
      // Send detach before closing
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "terminal_detach" }));
        ws.close();
      }
      attachedRef.current = false;
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
      wsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverId, sessionId]); // Only re-run if server/session changes

  const shortName = sessionName.replace(/^cc-\d+-/, "");

  return (
    <div className="h-screen flex flex-col bg-[#0d1117]">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-2 bg-zinc-900 border-b border-zinc-800">
        <button
          onClick={onBack}
          className="flex items-center gap-1 text-zinc-400 hover:text-zinc-200 text-sm"
        >
          <ArrowLeft size={16} /> Overview
        </button>
        <span className="text-zinc-600">|</span>
        <span className="text-sm font-semibold text-zinc-200">
          {shortName}
        </span>
        <span className="text-xs text-zinc-500">@ {serverName}</span>
        <div className="flex items-center gap-2 ml-auto">
          <StatusIndicator state={sessionState} size={8} />
          <StateLabel state={sessionState} />
          {!connected && (
            <span className="text-xs text-red-500 ml-2">disconnected</span>
          )}
        </div>
        <button
          onClick={onBack}
          className="p-1 hover:bg-zinc-800 rounded text-zinc-400"
          title="Close"
        >
          <X size={16} />
        </button>
      </div>

      {/* Terminal */}
      <div ref={terminalRef} className="flex-1 p-1" />
    </div>
  );
}
