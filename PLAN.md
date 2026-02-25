# Claude Code Dashboard — Project Plan

## Overview

Приватний веб-дашборд для моніторингу та керування множинними інтерактивними сесіями Claude Code, розкиданими по macOS та Linux серверах. Всі машини з'єднані через Tailscale mesh VPN.

Головний UX: карточки сесій з кольоровими індикаторами стану → double-click → повноцінний веб-термінал з рідним TUI Claude Code.

## Architecture

```
                    ┌─────────────────────────────┐
                    │     Dashboard (Next.js)      │
                    │   robot-components UI         │
                    │   xterm.js terminals          │
                    │   Tailscale IP: 100.x.y.z    │
                    │   Port: 443 (HTTPS)           │
                    └──────────┬──────────────────┘
                               │
                    Tailscale mesh (WireGuard)
                    (encrypted, authenticated)
                               │
            ┌──────────────────┼──────────────────┐
            │                  │                  │
     ┌──────▼──────┐   ┌──────▼──────┐   ┌──────▼──────┐
     │  Agent (Go)  │   │  Agent (Go)  │   │  Agent (Go)  │
     │  MacBook Pro │   │  Server 1    │   │  Server 2    │
     │  100.a.b.c   │   │  100.d.e.f   │   │  100.g.h.i   │
     │  :9100       │   │  :9100       │   │  :9100       │
     └──────────────┘   └──────────────┘   └──────────────┘
```

Agent слухає ТІЛЬКИ на Tailscale інтерфейсі (100.x.x.x:9100). Зовнішній інтернет не має доступу. Tailscale забезпечує взаємну автентифікацію вузлів.

## Tech Stack

| Component | Technology | Why |
|-----------|-----------|-----|
| Agent | Go 1.25 | Один бінарник, крос-компіляція, без залежностей |
| Dashboard | Next.js 15 (App Router) | SSR, API routes, WebSocket support |
| UI Components | robot-components (TaskPanel, Node Editor) | Фізика, drag, анімації — гарно для карточок |
| Terminal | @xterm/xterm + @xterm/addon-fit + @xterm/addon-webgl | Рендер терміналу в браузері |
| Styling | Tailwind CSS 4 + framer-motion | Peer deps robot-components |
| Auth | Simple token auth (cookie) | Dashboard доступний тільки через Tailscale + пароль |
| Networking | Tailscale mesh VPN | Zero config, mutual auth, encrypted |

## Agent (Go)

### Location
`/agent` directory in repo

### Responsibilities
1. Manage tmux sessions (create, list, kill)
2. Poll session states every 500ms via `tmux capture-pane`
3. Serve terminal WebSocket connections (attach to tmux)
4. Report machine info (hostname, OS, available working dirs)
5. Store full tmux scrollback history for playback

### API (WebSocket on :9100)

Agent exposes a single WebSocket endpoint on the Tailscale interface.

#### Protocol
All messages are JSON:
```jsonc
// Client → Agent
{ "type": "list_sessions" }
{ "type": "create_session", "workdir": "/home/user/project", "name": "api-fix" }
{ "type": "kill_session", "session_id": "cc-1234567890" }
{ "type": "attach", "session_id": "cc-1234567890" }
{ "type": "detach" }
{ "type": "input", "data": "base64-encoded-terminal-input" }
{ "type": "resize", "cols": 120, "rows": 40 }
{ "type": "get_scrollback", "session_id": "cc-1234567890" }
{ "type": "machine_info" }

// Agent → Client
{ "type": "sessions", "sessions": [...] }  // response to list + periodic broadcast
{ "type": "session_created", "session_id": "...", "name": "..." }
{ "type": "output", "data": "base64-encoded-terminal-output" }  // terminal stream
{ "type": "scrollback", "data": "base64-encoded-full-history" }
{ "type": "machine_info", "hostname": "...", "os": "...", "dirs": [...] }
{ "type": "error", "message": "..." }
```

#### Session State Detection

Agent polls each tmux session every 500ms using:
```bash
tmux capture-pane -t <session> -p -J -S -5000
```

The `-S -5000` captures last 5000 lines of scrollback (important for history).

State detection logic (Go):
```go
type SessionState string
const (
    StateIdle           SessionState = "idle"           // 🟢 waiting for user input
    StateWorking        SessionState = "working"        // 🟡 Claude is thinking/executing
    StateNeedsAttention SessionState = "needs_attention" // 🔴 permission prompt, error, diff review
    StateStarting       SessionState = "starting"       // ⚪ Claude Code is loading
    StateDead           SessionState = "dead"           // ⚫ process exited
)
```

Detection rules (check in this order):
1. **Dead**: tmux session doesn't exist or has no processes → `dead`
2. **Needs attention** (🔴): Last 8 lines of visible pane contain any of:
   - `Do you want to` / `Allow` / `Deny` / `Yes` / `(y/n)` — permission prompts
   - `Accept` / `Reject` — diff review
   - `Do you want to proceed` — dangerous action confirmation
   - `error` / `Error` / `ERROR` at start of line — errors
   - `exceeded` / `rate limit` — API issues
   - `Would you like` — any interactive question
3. **Working** (🟡): Last 8 lines contain:
   - Spinner chars: `⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏`
   - `Thinking` / `Reading` / `Writing` / `Searching` / `Running` / `Executing`
   - `Tool:` / `bash:` / `Edit:` / `MultiEdit:`
   - Progress indicators
4. **Starting** (⚪): Last lines contain Claude Code startup text / logo
5. **Idle** (🟢): Default — Claude Code prompt is waiting for input (usually ends with `>` or empty prompt line)

IMPORTANT: Claude Code has "pager" mode where long outputs are shown in a scrollable view. Detection:
- If screen contains `(j/k to scroll, q to quit)` or similar → `working` state (still showing output)
- If screen shows `Press q to exit` → `needs_attention` (user needs to dismiss)

#### tmux Session Management

Create session:
```bash
# Create tmux session with generous scrollback
tmux new-session -d -s <session_id> -c <workdir> -x 200 -y 50
tmux set-option -t <session_id> history-limit 50000

# Start Claude Code inside
tmux send-keys -t <session_id> 'claude' Enter
```

Session naming convention: `cc-<timestamp>-<sanitized-name>`

#### Scrollback / History

When user double-clicks a card for a session that ran hours ago, they need to see what happened.

tmux keeps scrollback buffer (we set history-limit 50000). On `get_scrollback`:
```bash
tmux capture-pane -t <session> -p -J -S -50000
```

This captures the ENTIRE scrollback buffer as plain text — all Claude Code output, commands, results. Send to client as base64.

Additionally, agent should persist scrollback to disk periodically:
```
~/.claude-dashboard/scrollback/<session_id>.log
```

This way even if tmux session is killed, history survives. Agent writes scrollback dump every 30 seconds and on session exit.

#### Terminal Attach (for interactive use)

When client sends `attach`, agent:
1. Opens a PTY (using `github.com/creack/pty`)
2. Runs `tmux attach-session -t <session_id>` in that PTY
3. Streams PTY output → WebSocket as `output` messages (base64)
4. Receives `input` messages from WebSocket → writes to PTY
5. Handles `resize` messages → `pty.Setsize()`
6. On `detach`: sends tmux detach key (Ctrl-B D) and closes PTY

This gives the browser a full interactive terminal — scrolling, colors, Claude Code TUI, permission prompts, pager mode — everything works because it IS the real terminal.

#### Startup & Configuration

Agent reads config from `~/.claude-dashboard/agent.yaml`:
```yaml
# Which Tailscale IP to bind to (auto-detect if empty)
bind: ""  
port: 9100

# Auth token (must match dashboard config)
token: "random-secret-here"

# Working directories to expose in UI
workdirs:
  - ~/projects
  - ~/deploy
  
# Scrollback persistence  
scrollback_dir: ~/.claude-dashboard/scrollback
scrollback_dump_interval: 30s
```

Agent binary: single `ccdash-agent` file. Install = copy binary + create config.

#### Build targets
- `linux/amd64` (servers)
- `darwin/arm64` (MacBook M-series)
- `darwin/amd64` (older Macs)

### Key Go Dependencies
- `github.com/gorilla/websocket` — WebSocket server
- `github.com/creack/pty` — PTY allocation for tmux attach
- `gopkg.in/yaml.v3` — config parsing
- Standard library for the rest (os/exec for tmux commands)

---

## Dashboard (Next.js)

### Location
`/dashboard` directory in repo

### Pages

#### 1. Overview Page (`/`)

Main screen. Shows all servers and their sessions as cards.

Layout:
```
┌─────────────────────────────────────────────────────────┐
│  Claude Dashboard                    [+ New Session]  ⚙ │
│─────────────────────────────────────────────────────────│
│                                                         │
│  🖥 MacBook Pro (online)                                │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐          │
│  │ 🟢 api-srv │ │ 🔴 frontend│ │ 🟡 migrate │          │
│  │ idle 3m    │ │ NEEDS YOU  │ │ working... │          │
│  │ ~/proj/api │ │ ~/proj/web │ │ ~/deploy   │          │
│  └────────────┘ └────────────┘ └────────────┘          │
│                                                         │
│  🖥 Production (online)                                 │
│  ┌────────────┐ ┌────────────┐                         │
│  │ 🟢 tests   │ │ ⚫ old-fix  │                         │
│  │ idle 12m   │ │ exited     │                         │
│  │ ~/tests    │ │ ~/hotfix   │                         │
│  └────────────┘ └────────────┘                         │
│                                                         │
│  🖥 Staging (offline ⚠️)                                │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

**Session cards** — use robot-components TaskPanel concept but adapted:
- Each card shows: name, server, working dir, state icon+color, time in state, last line of output preview
- States: 🟢 idle, 🟡 working, 🔴 needs attention (PULSING animation!), ⚫ dead, ⚪ starting
- 🔴 cards should have a pulsing glow/border animation to grab attention
- Cards are grouped by server
- Double-click card → navigate to terminal view for that session
- Right-click → context menu: kill session, rename, show scrollback
- Cards can use framer-motion for smooth state transitions

**Server sections:**
- Each server shows: hostname, online/offline status, Tailscale IP
- Offline servers greyed out with warning icon
- Server header has [+] button to create new session on that server

**Top bar:**
- [+ New Session] button → modal to pick server + workdir + optional name
- Settings gear → server management page
- Optional: notification badge count for 🔴 sessions

#### 2. Terminal Page (`/terminal/[serverId]/[sessionId]`)

Full-screen terminal view with session context.

```
┌─────────────────────────────────────────────────────────┐
│ ← Overview    api-srv @ MacBook Pro    🟢 idle    [✕]   │
│─────────────────────────────────────────────────────────│
│                                                         │
│  ╔═══════════════════════════════════════════════════╗   │
│  ║                                                   ║   │
│  ║   xterm.js — full Claude Code TUI                 ║   │
│  ║                                                   ║   │
│  ║   Everything interactive: permissions, pager,     ║   │
│  ║   scrolling, vim mode — all works natively        ║   │
│  ║                                                   ║   │
│  ╚═══════════════════════════════════════════════════╝   │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

Behavior:
- On mount: connect WebSocket to agent, send `attach` for the session
- First, send `get_scrollback` to load history into terminal (so user sees what happened before)
- Then attach for live interactive use
- xterm.js addons: fit (auto-resize), webgl (performance), search (Ctrl+F in scrollback)
- On navigate away: send `detach` — session keeps running in tmux
- Status indicator in header updates in real-time
- [✕] button detaches and returns to overview (does NOT kill session)
- Keyboard shortcut: Escape or Ctrl+` to go back to overview

**Scrollback / History playback:**
When opening a terminal for a session that has been running (or finished), the flow is:
1. Request `get_scrollback` from agent
2. Write entire scrollback to xterm.js terminal (user sees full history)
3. If session is alive, then `attach` for live interaction
4. If session is dead, just show the scrollback (read-only mode, show banner "Session ended")

#### 3. Settings Page (`/settings`)

Manage servers:
```
Servers
┌──────────────────────────────────────────────┐
│ MacBook Pro    100.64.1.10    ✅ online       │ [edit] [remove]
│ Production     100.64.1.20    ✅ online       │ [edit] [remove]  
│ Staging        100.64.1.30    ❌ offline      │ [edit] [remove]
└──────────────────────────────────────────────┘
[+ Add Server]

Add Server modal:
  Name: ___________
  Tailscale IP: 100.___.___.___
  Agent port: 9100 (default)
  Auth token: ___________
  [Test Connection]  [Save]
```

Dashboard preferences:
- Poll interval (default 500ms)
- Notification sound for 🔴 state changes
- Theme (dark/light)
- Default terminal size

Server config stored in `dashboard-config.yaml` or SQLite for simplicity.

### Dashboard ↔ Agent Communication

Dashboard server (Next.js API routes) maintains WebSocket connections to all agents.

```
Browser ←→ Next.js server ←→ Agent (via Tailscale)
```

Two types of WebSocket connections per agent:

1. **Control channel** (always open): receives session state broadcasts, sends management commands
2. **Terminal channels** (on demand): one per active terminal view, carries PTY I/O

### Key Frontend Dependencies
- `robot-components` — TaskPanel base for cards
- `@xterm/xterm` + `@xterm/addon-fit` + `@xterm/addon-webgl` + `@xterm/addon-search`
- `framer-motion` — animations (peer dep of robot-components)
- `lucide-react` — icons (peer dep of robot-components)
- `tailwindcss` 4 — styling

---

## Detailed Implementation Plan

### Phase 1: Agent Core

**Goal**: Go binary that manages tmux sessions and exposes WebSocket API.

Files:
```
agent/
├── main.go              # Entry point, config loading, bind to Tailscale IP
├── config.go            # Config struct + YAML parsing
├── tmux.go              # tmux operations: create, list, kill, capture-pane
├── state.go             # Session state detection (regex-based analysis of pane text)
├── poller.go            # Goroutine: poll all sessions every 500ms, broadcast state
├── server.go            # WebSocket server, message routing
├── terminal.go          # PTY management for attach/detach
├── scrollback.go        # Scrollback persistence to disk
├── auth.go              # Token-based auth middleware (check token on WS upgrade)
├── go.mod
└── go.sum
```

Key implementation details:

**tmux.go**:
```go
func CreateSession(name, workdir string) (string, error)
func ListSessions() ([]TmuxSession, error)      // parses `tmux list-sessions`
func KillSession(id string) error
func CapturePaneVisible(id string) (string, error)  // last ~50 lines on screen
func CapturePaneScrollback(id string) (string, error) // full 50000 line history
func SendKeys(id string, keys string) error
```

**state.go**:
```go
func DetectState(paneText string) SessionState
// Uses compiled regexps, checks last 8 lines of visible pane
// Returns: idle, working, needs_attention, starting, dead
```

Regexps to compile at init (these are the patterns to match Claude Code's TUI):
```go
var needsAttentionPatterns = []*regexp.Regexp{
    regexp.MustCompile(`(?i)do you want to proceed`),
    regexp.MustCompile(`(?i)\(y\/?n\)`),
    regexp.MustCompile(`(?i)^(allow|deny)`),
    regexp.MustCompile(`(?i)accept.*reject|reject.*accept`),
    regexp.MustCompile(`(?i)press.*to continue`),
    regexp.MustCompile(`(?i)would you like`),
    regexp.MustCompile(`(?i)^error:|^ERROR`),
    regexp.MustCompile(`(?i)rate.?limit|exceeded`),
    regexp.MustCompile(`(?i)permission`),
}

var workingPatterns = []*regexp.Regexp{
    regexp.MustCompile(`[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]`),   // spinner
    regexp.MustCompile(`(?i)thinking|reasoning`),
    regexp.MustCompile(`(?i)reading|writing|searching|running|executing`),
    regexp.MustCompile(`(?i)^(bash|edit|multiedit|read|write|glob|grep|todoread|todowrite):`),
    regexp.MustCompile(`(?i)tool:|using tool`),
}

var pagerPatterns = []*regexp.Regexp{
    regexp.MustCompile(`(?i)j/k.*scroll|q.*quit|q.*exit`),
    regexp.MustCompile(`(?i)press q`),
    regexp.MustCompile(`(?i)more|less|page`),
}
```

**terminal.go**:
```go
type TerminalSession struct {
    pty     *os.File
    cmd     *exec.Cmd
    mu      sync.Mutex
}

func (t *TerminalSession) Attach(sessionID string) error
// Spawns: tmux attach-session -t <sessionID>
// in a PTY via github.com/creack/pty

func (t *TerminalSession) Write(data []byte) (int, error)
func (t *TerminalSession) Read(buf []byte) (int, error)  
func (t *TerminalSession) Resize(cols, rows uint16) error
func (t *TerminalSession) Detach() error
```

**auth.go**:
Agent checks `Authorization: Bearer <token>` header on WebSocket upgrade request. Token is configured in `agent.yaml` and must match the one in dashboard config for this server.

**Tailscale binding**:
```go
// Detect Tailscale IP automatically
func getTailscaleIP() (string, error) {
    // Option 1: parse `tailscale ip -4`
    // Option 2: look for interface with 100.x.x.x address
}
```

Agent MUST bind to Tailscale IP only:
```go
listener, err := net.Listen("tcp", fmt.Sprintf("%s:%d", tailscaleIP, config.Port))
```

### Phase 2: Dashboard Backend

**Goal**: Next.js API layer that connects to agents and proxies to browser.

Files:
```
dashboard/
├── app/
│   ├── layout.tsx
│   ├── page.tsx                      # Overview page (SSR + client)
│   ├── terminal/
│   │   └── [serverId]/
│   │       └── [sessionId]/
│   │           └── page.tsx          # Terminal page
│   ├── settings/
│   │   └── page.tsx                  # Settings page
│   └── api/
│       ├── sessions/
│       │   └── route.ts              # GET: all sessions across all servers
│       ├── servers/
│       │   ├── route.ts              # CRUD servers
│       │   └── [serverId]/
│       │       └── sessions/
│       │           └── route.ts      # POST: create session on specific server
│       └── ws/
│           └── route.ts              # WebSocket upgrade endpoint for browser
├── lib/
│   ├── agent-manager.ts              # Manages WS connections to all agents
│   ├── session-store.ts              # In-memory state of all sessions (updated by agents)
│   ├── config.ts                     # Server list, tokens, settings
│   └── auth.ts                       # Simple session auth for browser
├── components/
│   ├── SessionCard.tsx               # Card component with state indicator
│   ├── ServerGroup.tsx               # Group of cards under server header
│   ├── TerminalView.tsx              # xterm.js wrapper
│   ├── NewSessionModal.tsx           # Create session dialog
│   ├── StatusIndicator.tsx           # Pulsing dot component
│   └── ScrollbackViewer.tsx          # Read-only terminal for dead sessions
├── hooks/
│   ├── useSessionState.ts            # Subscribe to session updates
│   ├── useTerminal.ts                # Terminal WebSocket + xterm.js lifecycle
│   └── useNotification.ts            # Sound/visual alerts for 🔴 states
├── public/
│   └── sounds/
│       └── attention.mp3             # Alert sound
├── next.config.js
├── tailwind.config.ts
├── package.json
└── tsconfig.json
```

**agent-manager.ts** — core orchestration:
```typescript
class AgentManager {
  private connections: Map<string, WebSocket>;  // serverId → WS to agent
  private sessionStates: Map<string, SessionInfo[]>;  // serverId → sessions
  
  // Connect to all configured agents on startup
  async connectAll(): Promise<void>;
  
  // Reconnect with exponential backoff
  private reconnect(serverId: string): void;
  
  // Forward commands to specific agent
  async createSession(serverId: string, opts: CreateSessionOpts): Promise<void>;
  async killSession(serverId: string, sessionId: string): Promise<void>;
  
  // Get aggregated state for UI
  getAllSessions(): Map<string, SessionInfo[]>;
  
  // Terminal proxy: browser WS ↔ agent WS
  proxyTerminal(serverId: string, sessionId: string, browserWs: WebSocket): void;
}
```

**WebSocket endpoint for browser** (`/api/ws`):

Single WS connection from browser to dashboard server. Multiplexes:
- Session state updates (push from server → browser)
- Terminal I/O (bidirectional, tagged with sessionId)
- Commands (browser → server → agent)

Protocol:
```jsonc
// Browser → Dashboard
{ "type": "subscribe" }  // start receiving state updates
{ "type": "create_session", "serverId": "...", "workdir": "...", "name": "..." }
{ "type": "kill_session", "serverId": "...", "sessionId": "..." }
{ "type": "terminal_attach", "serverId": "...", "sessionId": "..." }
{ "type": "terminal_input", "data": "base64..." }
{ "type": "terminal_resize", "cols": 120, "rows": 40 }
{ "type": "terminal_detach" }
{ "type": "get_scrollback", "serverId": "...", "sessionId": "..." }

// Dashboard → Browser
{ "type": "state_update", "servers": { ... } }  // full state snapshot
{ "type": "terminal_output", "data": "base64..." }
{ "type": "scrollback", "data": "base64..." }
{ "type": "session_created", "serverId": "...", "sessionId": "..." }
{ "type": "error", "message": "..." }
```

### Phase 3: Dashboard Frontend

**Goal**: Beautiful, responsive UI with robot-components.

**SessionCard.tsx** — the core UI element:
```tsx
interface SessionCardProps {
  session: {
    id: string;
    name: string;
    serverId: string;
    workdir: string;
    state: 'idle' | 'working' | 'needs_attention' | 'starting' | 'dead';
    stateChangedAt: number;  // timestamp
    lastLine: string;        // preview of last output line
  };
  onDoubleClick: () => void;
  onKill: () => void;
}
```

Card visual states:
- `idle` → green border/dot, calm
- `working` → yellow border/dot, subtle pulse
- `needs_attention` → RED border, STRONG PULSING GLOW, this must be very noticeable
- `starting` → grey border, spinner
- `dead` → muted/greyed out, with "exited" label

Use framer-motion for:
- Card appear/disappear (layout animation)
- State transitions (color morphs)
- Pulsing glow on needs_attention (infinite animation)
- Double-click → zoom into terminal (shared layout animation or page transition)

**TerminalView.tsx** — xterm.js integration:
```tsx
interface TerminalViewProps {
  serverId: string;
  sessionId: string;
  sessionState: SessionState;
  onBack: () => void;
}
```

Lifecycle:
1. Component mounts
2. Initialize xterm.js Terminal with theme matching dashboard
3. Request scrollback → write to terminal (user sees history immediately)
4. If session alive: attach → bidirectional I/O
5. If session dead: show "Session ended" banner, terminal is read-only (just scrollback)
6. Fit addon: resize terminal on window resize, send resize to agent
7. Component unmounts: detach, cleanup

IMPORTANT xterm.js config:
```typescript
const term = new Terminal({
  cursorBlink: true,
  fontSize: 14,
  fontFamily: 'JetBrains Mono, Menlo, monospace',
  theme: {
    background: '#0d1117',
    foreground: '#e6edf3',
    cursor: '#58a6ff',
    // ... match dark theme
  },
  scrollback: 50000,        // match agent's tmux scrollback
  allowProposedApi: true,    // for webgl addon
});
```

**Notification system:**
- When any session enters `needs_attention` → play sound + browser notification
- Badge count in tab title: `(3) Claude Dashboard` = 3 sessions need attention
- Optional: desktop notification via Notification API

### Phase 4: Polish & Extra Features

After core works:

1. **Session rename** — right-click card → rename
2. **Quick actions** — for `needs_attention` state, show overlay buttons: "Accept (y)" / "Reject (n)" without opening full terminal — sends keystrokes via agent
3. **Session templates** — save workdir + initial prompt combinations for quick launch
4. **Multi-terminal view** — split screen with 2-4 terminals at once (like tmux panes but in browser)
5. **Resource monitoring** — agent reports CPU/memory, show in server header
6. **Mobile support** — responsive cards, terminal might be hard but overview works
7. **Export session log** — download scrollback as text file
8. **Auto-restart** — option to restart Claude Code if it crashes
9. **Sound per server** — different alert sounds per server for audio-only monitoring

---

## File Structure

```
claude-dashboard/
├── agent/
│   ├── main.go
│   ├── config.go
│   ├── tmux.go
│   ├── state.go
│   ├── poller.go
│   ├── server.go
│   ├── terminal.go
│   ├── scrollback.go
│   ├── auth.go
│   ├── go.mod
│   ├── go.sum
│   ├── Makefile            # build for all platforms
│   └── install.sh          # install agent + create config + systemd/launchd service
├── dashboard/
│   ├── app/                # Next.js app router
│   ├── lib/                # Backend logic
│   ├── components/         # React components  
│   ├── hooks/              # Custom hooks
│   ├── public/
│   ├── next.config.js
│   ├── tailwind.config.ts
│   ├── package.json
│   └── tsconfig.json
├── README.md
└── docker-compose.yml      # optional: run dashboard in Docker
```

---

## Implementation Order

Do it in this exact order so each step is testable:

### Step 1: Agent — tmux management
- `tmux.go`: CreateSession, ListSessions, KillSession, CapturePaneVisible, CapturePaneScrollback
- `config.go`: parse YAML config
- `main.go`: basic startup, read config
- **Test**: Run agent, manually verify tmux operations

### Step 2: Agent — state detection  
- `state.go`: DetectState() with all regex patterns
- `poller.go`: goroutine that polls sessions and prints state
- **Test**: Start a Claude Code in tmux manually, verify state detection works for all states (idle, working, needs_attention)

### Step 3: Agent — WebSocket server
- `server.go`: WebSocket endpoint with auth
- `auth.go`: token verification
- Wire up: list_sessions, create_session, kill_session, state broadcasts
- Bind to Tailscale interface only
- **Test**: Connect with wscat, send commands, see state broadcasts

### Step 4: Agent — terminal proxy
- `terminal.go`: PTY-based tmux attach/detach
- Wire up: attach, detach, input, output, resize messages
- **Test**: Connect with wscat, attach to session, send keys, see output

### Step 5: Agent — scrollback
- `scrollback.go`: periodic dump to disk, serve on request
- **Test**: Request scrollback, verify full history returned

### Step 6: Dashboard — backend
- Setup Next.js project with robot-components
- `lib/agent-manager.ts`: connect to agents, maintain connections
- `lib/config.ts`: server list config
- API routes: /api/sessions, /api/servers, /api/ws
- **Test**: Dashboard connects to agent, shows session data in console

### Step 7: Dashboard — overview page
- `SessionCard.tsx` with state indicators and animations
- `ServerGroup.tsx` grouping
- Overview page with real-time updates
- Pulsing glow animation for needs_attention
- **Test**: See live session states updating on page

### Step 8: Dashboard — terminal page
- `TerminalView.tsx` with xterm.js
- Scrollback loading → live attach flow
- Resize handling
- Navigation: double-click card → terminal → back
- **Test**: Full interactive Claude Code in browser, including permissions and pager

### Step 9: Dashboard — session management
- New session modal (pick server, workdir, name)
- Kill session (right-click → confirm → kill)
- Settings page for server management
- **Test**: Full CRUD workflow from browser

### Step 10: Dashboard — notifications & polish
- Sound alerts for needs_attention
- Browser notifications
- Tab badge count
- Framer-motion transitions
- Dark/light theme
- Dead session scrollback viewer (read-only)
- **Test**: Everything smooth and polished

---

## Critical Edge Cases to Handle

1. **Agent disconnects**: Dashboard should show server as "offline", grey out cards, auto-reconnect with backoff
2. **tmux session dies unexpectedly**: Agent detects via `tmux has-session`, marks as dead, preserves last scrollback
3. **Multiple browser tabs**: Dashboard WS should handle multiple subscribers, terminal attach should warn if already attached elsewhere
4. **Claude Code pager mode**: The scrollable output view — terminal proxy handles this natively since we're proxying the real PTY
5. **Claude Code interactive prompts**: All handled natively through PTY — permission dialogs, y/n, text input — everything passes through
6. **Large scrollback**: Base64 encoding can be large. Consider chunked transfer for scrollback > 1MB
7. **MacBook sleep**: Agent should detect tmux sessions survived sleep, re-poll on wake
8. **Long-running sessions**: tmux scrollback has a limit (50000 lines). For very long sessions, disk persistence is the backup.

---

## Security Summary

1. **Network**: All agent communication over Tailscale only (WireGuard encrypted, mutual node authentication)
2. **Agent binding**: Agent binds to Tailscale IP only (100.x.x.x), not 0.0.0.0
3. **Agent auth**: Bearer token on WebSocket upgrade (protects against other Tailscale users if shared tailnet)
4. **Dashboard access**: HTTPS + cookie-based auth (password login)
5. **No ports exposed to internet**: Zero public attack surface
6. **tmux isolation**: Each Claude Code session runs as the local user, standard Unix permissions

---

## Config Examples

### Agent config (`~/.claude-dashboard/agent.yaml`)
```yaml
port: 9100
token: "your-secret-token-here"
workdirs:
  - ~/projects
  - ~/deploy
  - ~/experiments
scrollback_dir: ~/.claude-dashboard/scrollback
scrollback_dump_interval: 30s
history_limit: 50000
```

### Dashboard config (`dashboard/config.yaml`)
```yaml
auth:
  password_hash: "$2b$12$..."   # bcrypt hash

servers:
  - id: macbook
    name: "MacBook Pro"
    host: "100.64.1.10"
    port: 9100
    token: "token-for-macbook"
    
  - id: production
    name: "Production"
    host: "100.64.1.20"
    port: 9100
    token: "token-for-production"
    
  - id: staging
    name: "Staging"
    host: "100.64.1.30"
    port: 9100
    token: "token-for-staging"

ui:
  poll_interval_ms: 500
  notification_sound: true
  theme: dark
```
