import { createServer } from "http";
import { parse } from "url";
import next from "next";
import { WebSocketServer, WebSocket } from "ws";
import { agentManager } from "./src/lib/agent-manager";

const dev = process.env.NODE_ENV !== "production";
const hostname = "0.0.0.0";
const port = parseInt(process.env.PORT || "3000");

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

interface BrowserMessage {
  type: string;
  serverId?: string;
  sessionId?: string;
  workdir?: string;
  name?: string;
  data?: string;
  cols?: number;
  rows?: number;
}

app.prepare().then(() => {
  agentManager.init();

  const server = createServer((req, res) => {
    const parsedUrl = parse(req.url!, true);
    handle(req, res, parsedUrl);
  });

  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request, socket, head) => {
    const { pathname } = parse(request.url!, true);

    if (pathname === "/ws") {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit("connection", ws, request);
      });
    } else {
      // Let Next.js handle HMR WebSocket upgrades
      // Don't destroy the socket for other paths
    }
  });

  wss.on("connection", (ws) => {
    let terminalProxy: {
      sendInput: (data: string) => void;
      resize: (cols: number, rows: number) => void;
      detach: () => void;
      close: () => void;
    } | null = null;

    // Send initial state
    const servers = agentManager.getServers();
    ws.send(JSON.stringify({ type: "state_update", servers }));

    // Subscribe to state updates
    const unsubscribe = agentManager.onStateChange((serverList) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "state_update", servers: serverList }));
      }
    });

    ws.on("message", (raw) => {
      let msg: BrowserMessage;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      switch (msg.type) {
        case "subscribe":
          // Already subscribed on connect
          break;

        case "create_session":
          if (msg.serverId && msg.workdir) {
            agentManager.createSession(
              msg.serverId,
              msg.workdir,
              msg.name || "session"
            );
          }
          break;

        case "kill_session":
          if (msg.serverId && msg.sessionId) {
            agentManager.killSession(msg.serverId, msg.sessionId);
          }
          break;

        case "terminal_attach":
          if (msg.serverId && msg.sessionId) {
            // Close existing terminal proxy
            if (terminalProxy) {
              terminalProxy.close();
              terminalProxy = null;
            }

            const conn = agentManager.getConnection(msg.serverId);
            if (!conn) {
              ws.send(
                JSON.stringify({ type: "error", message: "Server not found" })
              );
              break;
            }

            terminalProxy = conn.createTerminalProxy(
              msg.sessionId,
              (data) => {
                if (ws.readyState === WebSocket.OPEN) {
                  ws.send(
                    JSON.stringify({ type: "terminal_output", data })
                  );
                }
              },
              (data) => {
                if (ws.readyState === WebSocket.OPEN) {
                  ws.send(JSON.stringify({ type: "scrollback", data }));
                }
              },
              (errMsg) => {
                if (ws.readyState === WebSocket.OPEN) {
                  ws.send(
                    JSON.stringify({ type: "error", message: errMsg })
                  );
                }
              },
              msg.cols,
              msg.rows
            );
          }
          break;

        case "terminal_input":
          if (terminalProxy && msg.data) {
            terminalProxy.sendInput(msg.data);
          }
          break;

        case "terminal_resize":
          if (terminalProxy && msg.cols && msg.rows) {
            terminalProxy.resize(msg.cols, msg.rows);
          }
          break;

        case "terminal_detach":
          if (terminalProxy) {
            terminalProxy.detach();
            terminalProxy.close();
            terminalProxy = null;
          }
          break;

        case "get_scrollback":
          if (msg.serverId && msg.sessionId) {
            const conn = agentManager.getConnection(msg.serverId);
            if (conn) {
              conn.getScrollback(msg.sessionId, (data) => {
                if (ws.readyState === WebSocket.OPEN) {
                  ws.send(JSON.stringify({ type: "scrollback", data }));
                }
              });
            }
          }
          break;
      }
    });

    ws.on("close", () => {
      unsubscribe();
      if (terminalProxy) {
        terminalProxy.detach();
        terminalProxy.close();
        terminalProxy = null;
      }
    });
  });

  server.listen(port, hostname, () => {
    console.log(`> Dashboard ready on http://${hostname}:${port}`);
  });
});
