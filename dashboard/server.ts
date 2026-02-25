import { createServer, IncomingMessage } from "http";
import { parse } from "url";
import next from "next";
import { WebSocketServer, WebSocket } from "ws";
import { jwtDecrypt } from "jose";
import { hkdf } from "crypto";
import { promisify } from "util";
import { agentManager } from "./src/lib/agent-manager";
import { prisma } from "./src/lib/prisma";

const dev = process.env.NODE_ENV !== "production";
const hostname = "0.0.0.0";
const port = parseInt(process.env.PORT || "3000");

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

// Auth.js v5 encrypts JWT (JWE) with key derived via HKDF.
// Salt = cookie name, info includes salt, key length = 64 for A256CBC-HS512.
const hkdfAsync = promisify(hkdf);
const keyCache = new Map<string, Uint8Array>();

async function getEncryptionKey(cookieName: string): Promise<Uint8Array> {
  if (keyCache.has(cookieName)) return keyCache.get(cookieName)!;
  const derived = await hkdfAsync(
    "sha256",
    process.env.NEXTAUTH_SECRET!,
    cookieName,
    `Auth.js Generated Encryption Key (${cookieName})`,
    64
  );
  const key = new Uint8Array(derived);
  keyCache.set(cookieName, key);
  return key;
}

interface BrowserMessage {
  type: string;
  serverId?: string;
  sessionId?: string;
  workdir?: string;
  name?: string;
  data?: string;
  cols?: number;
  rows?: number;
  dangerouslySkipPermissions?: boolean;
}

function parseCookie(header: string): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const pair of header.split(";")) {
    const [key, ...rest] = pair.trim().split("=");
    if (key) cookies[key] = rest.join("=");
  }
  return cookies;
}

async function getUserId(req: IncomingMessage): Promise<string | null> {
  const cookies = parseCookie(req.headers.cookie || "");

  // Try both cookie names — Auth.js uses the cookie name as HKDF salt
  const candidates: [string, string][] = [
    ["authjs.session-token", cookies["authjs.session-token"]],
    ["__Secure-authjs.session-token", cookies["__Secure-authjs.session-token"]],
  ];

  for (const [cookieName, token] of candidates) {
    if (!token) continue;
    try {
      const key = await getEncryptionKey(cookieName);
      const { payload } = await jwtDecrypt(token, key);
      return (payload.sub as string) || null;
    } catch (e) {
      console.error(`[ws-auth] Failed to decrypt ${cookieName}:`, (e as Error).message);
    }
  }
  return null;
}

app.prepare().then(() => {
  const server = createServer((req, res) => {
    const parsedUrl = parse(req.url!, true);
    handle(req, res, parsedUrl);
  });

  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", async (request, socket, head) => {
    const { pathname } = parse(request.url!, true);

    if (pathname === "/ws") {
      const userId = await getUserId(request);
      if (!userId) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }

      // Attach userId to request for use in connection handler
      (request as IncomingMessage & { userId: string }).userId = userId;

      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit("connection", ws, request);
      });
    }
    // Let Next.js handle HMR WebSocket upgrades for other paths
  });

  wss.on("connection", (ws, request) => {
    const userId = (request as IncomingMessage & { userId: string }).userId;

    let terminalProxy: {
      sendInput: (data: string) => void;
      resize: (cols: number, rows: number) => void;
      detach: () => void;
      close: () => void;
    } | null = null;

    // Queue messages until async init completes
    const messageQueue: string[] = [];
    let ready = false;

    function handleMessage(rawStr: string) {
      let msg: BrowserMessage;
      try {
        msg = JSON.parse(rawStr);
      } catch {
        return;
      }

      switch (msg.type) {
        case "subscribe":
          break;

        case "create_session":
          if (msg.serverId && msg.workdir) {
            agentManager.createSession(
              userId,
              msg.serverId,
              msg.workdir,
              msg.name || "session",
              msg.dangerouslySkipPermissions
            );
          }
          break;

        case "kill_session":
          if (msg.serverId && msg.sessionId) {
            agentManager.killSession(userId, msg.serverId, msg.sessionId);
          }
          break;

        case "clear_dead_sessions":
          if (msg.serverId) {
            agentManager.clearDeadSessions(userId, msg.serverId);
          }
          break;

        case "terminal_attach":
          if (msg.serverId && msg.sessionId) {
            if (terminalProxy) {
              terminalProxy.close();
              terminalProxy = null;
            }

            const conn = agentManager.getConnection(userId, msg.serverId);
            console.log(`[terminal] attach serverId=${msg.serverId} conn=${conn ? "found" : "NOT FOUND"} online=${conn?.online}`);
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
            const conn = agentManager.getConnection(userId, msg.serverId);
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
    }

    // Register message handler SYNCHRONOUSLY — before any await
    ws.on("message", (raw) => {
      const str = raw.toString();
      if (!ready) {
        messageQueue.push(str);
        return;
      }
      handleMessage(str);
    });

    let unsubscribe = () => {};

    ws.on("close", () => {
      unsubscribe();
      if (terminalProxy) {
        terminalProxy.detach();
        terminalProxy.close();
        terminalProxy = null;
      }
      agentManager.trackUserDisconnect(userId);
    });

    // Async init — load servers, set up subscriptions
    (async () => {
      const dbServers = await prisma.server.findMany({ where: { userId } });
      const serverConfigs = dbServers.map((s) => ({
        id: s.serverId,
        name: s.name,
        host: s.host,
        port: s.port,
        token: s.token,
      }));

      agentManager.ensureUserConnections(userId, serverConfigs);
      agentManager.trackUserConnect(userId);

      // Send initial state
      const servers = agentManager.getServersForUser(userId);
      ws.send(JSON.stringify({ type: "state_update", servers }));

      // Subscribe to state updates
      unsubscribe = agentManager.onUserStateChange(userId, (serverList) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "state_update", servers: serverList }));
        }
      });

      // Now process any messages that arrived during init
      ready = true;
      for (const msg of messageQueue) {
        handleMessage(msg);
      }
      messageQueue.length = 0;
    })();
  });

  server.listen(port, hostname, () => {
    console.log(`> Dashboard ready on http://${hostname}:${port}`);
  });
});
