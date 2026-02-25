<p align="center">
  <img src="https://img.shields.io/github/v/release/assada/claude-dash?style=flat-square&color=blue" alt="Release" />
  <img src="https://img.shields.io/github/actions/workflow/status/assada/claude-dash/release.yml?style=flat-square&label=build" alt="Build Status" />
  <img src="https://img.shields.io/github/license/assada/claude-dash?style=flat-square" alt="License" />
  <img src="https://img.shields.io/github/go-mod/go-version/assada/claude-dash?filename=agent%2Fgo.mod&style=flat-square&label=go" alt="Go Version" />
  <img src="https://img.shields.io/badge/next.js-16-black?style=flat-square&logo=next.js" alt="Next.js" />
  <img src="https://img.shields.io/badge/PRs-welcome-brightgreen?style=flat-square" alt="PRs Welcome" />
</p>

# Claude Dash

Real-time web dashboard for monitoring and managing multiple **Claude Code** sessions across machines. Attach to running terminals, create new sessions, and keep track of what every agent is doing — all from a single browser tab.

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://github.com/user-attachments/assets/placeholder-dark.png">
    <img alt="Claude Dash screenshot" width="800">
  </picture>
</p>

---

## Features

- **Multi-server monitoring** — connect to agents running on any machine (bare metal, VPS, Tailscale peers)
- **Live terminal** — full xterm.js terminal with WebGL rendering, search, and scrollback
- **Session management** — create, kill, and archive Claude Code sessions remotely
- **State detection** — idle / working / needs attention indicators per session
- **Draggable panels** — spatial UI with floating server cards
- **Desktop notifications** — get alerted when a session needs attention
- **Real-time WebSocket** — instant updates, no polling
- **GitHub OAuth + Guest login** — configurable auth providers via environment variables
- **PostgreSQL or SQLite** — full database flexibility for any deployment scenario

## Architecture

```
┌─────────────┐     WebSocket      ┌───────────────────┐     WebSocket      ┌─────────────┐
│   Browser    │◄──────────────────►│    Dashboard      │◄──────────────────►│   Agent      │
│  (Next.js)   │   /ws (JWT auth)   │  (Node.js + Next) │  per-server conn   │  (Go binary) │
└─────────────┘                     └───────────────────┘                     └─────────────┘
                                           │                                        │
                                     ┌─────┴─────┐                           ┌──────┴──────┐
                                     │  Database  │                           │  tmux + pty │
                                     │ PG / SQLite│                           │  scrollback │
                                     └───────────┘                           └─────────────┘
```

| Component | Stack | Description |
|-----------|-------|-------------|
| **Dashboard** | Next.js 16, React 19, TypeScript | Web UI + custom HTTP/WebSocket server |
| **Agent** | Go 1.25 | Lightweight binary that manages tmux sessions on each machine |
| **Database** | PostgreSQL 16 or SQLite | User accounts, OAuth links, server configs |

## Quick Start

### 1. Deploy Dashboard

**Docker Compose with PostgreSQL (recommended for teams):**

```bash
git clone https://github.com/assada/claude-dash.git
cd claude-dash

# Configure
cp dashboard/.env.example dashboard/.env
# Edit dashboard/.env with your NEXTAUTH_SECRET, GitHub OAuth creds, etc.

docker compose up -d
```

**Docker Compose with SQLite (zero-dependency self-hosted):**

```bash
docker compose -f docker-compose.sqlite.yml up -d
```

No PostgreSQL, no GitHub OAuth needed — starts with guest login enabled.

### 2. Install Agent on Each Machine

One-line installer:

```bash
curl -fsSL https://raw.githubusercontent.com/assada/claude-dash/master/agent/install.sh | bash
```

The installer will:
- Download the correct binary for your platform (Linux amd64/arm64, macOS arm64)
- Prompt for port, bind address, auth token, and working directories
- Configure and start a systemd/launchd service

**Manual install:**

```bash
# Download from releases
wget https://github.com/assada/claude-dash/releases/latest/download/ccdash-agent-linux-amd64
chmod +x ccdash-agent-linux-amd64
sudo mv ccdash-agent-linux-amd64 /usr/local/bin/ccdash-agent

# Create config
mkdir -p ~/.claude-dashboard
cat > ~/.claude-dashboard/agent.yaml << 'EOF'
bind: ""          # auto-detect Tailscale IP, or set 0.0.0.0
port: 9100
token: "your-secret-token"
workdirs:
  - ~/projects
scrollback_dir: ~/.claude-dashboard/scrollback
EOF

ccdash-agent
```

### 3. Add Server in Dashboard

Open the dashboard → Settings → Add a server with the agent's host, port, and token.

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | — | PostgreSQL or SQLite connection string |
| `NEXTAUTH_SECRET` | — | Secret for JWT encryption (generate with `openssl rand -base64 32`) |
| `NEXTAUTH_URL` | `http://localhost:3000` | Public URL of the dashboard |
| `ENABLE_GITHUB` | `true` | Enable GitHub OAuth login |
| `ENABLE_GUEST` | `true` | Enable guest login (no OAuth setup required) |
| `GITHUB_CLIENT_ID` | — | GitHub OAuth app client ID |
| `GITHUB_CLIENT_SECRET` | — | GitHub OAuth app client secret |

### Database

**PostgreSQL** (default):
```
DATABASE_URL="postgresql://user:pass@localhost:5432/dashboard"
```

**SQLite** (self-hosted):
```
DATABASE_URL="file:/app/data/dashboard.db"
```

When using SQLite with Docker, the build must be invoked with `DATABASE_PROVIDER=sqlite`:

```yaml
build:
  args:
    DATABASE_PROVIDER: sqlite
```

### Auth Modes

| Scenario | Variables |
|----------|-----------|
| GitHub + Guest (default) | `ENABLE_GITHUB=true ENABLE_GUEST=true` |
| GitHub only | `ENABLE_GITHUB=true ENABLE_GUEST=false` |
| Guest only (no OAuth) | `ENABLE_GITHUB=false ENABLE_GUEST=true` |

### Agent Config (`~/.claude-dashboard/agent.yaml`)

```yaml
bind: ""                          # Tailscale auto-detect, or "0.0.0.0"
port: 9100
token: "shared-secret"
workdirs:
  - ~/projects
scrollback_dir: ~/.claude-dashboard/scrollback
scrollback_dump_interval: 30s
history_limit: 50000
```

## Development

```bash
cd dashboard
cp .env.example .env
# Fill in DATABASE_URL, NEXTAUTH_SECRET, GitHub creds

npm install
npx prisma db push
npm run dev
```

Dashboard runs at `http://localhost:3000`.

**Agent:**

```bash
cd agent
go build -o ccdash-agent .
./ccdash-agent --bind 0.0.0.0 --port 9100
```

## Deployment

### Recommended Setup (Tailscale)

1. Install Tailscale on all machines
2. Run agent on each machine — it auto-binds to the Tailscale IP
3. Deploy dashboard anywhere with access to the tailnet
4. Add servers using their Tailscale IPs (100.x.x.x)

### Release Builds

Releases are automated via GitHub Actions. Pushing a version tag triggers:

- Cross-compilation of the Go agent (linux/amd64, linux/arm64, darwin/arm64)
- Docker image build for the dashboard
- GitHub Release with all artifacts + checksums

```bash
git tag v1.1.0
git push origin v1.1.0
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, Next.js 16, Tailwind CSS v4, Framer Motion, xterm.js |
| Backend | Node.js, custom HTTP/WebSocket server |
| Auth | Auth.js v5 (JWT strategy), GitHub OAuth, Credentials provider |
| Database | Prisma 6, PostgreSQL 16 / SQLite |
| Agent | Go, gorilla/websocket, tmux, PTY |
| Infra | Docker, multi-stage builds, GitHub Actions |

## License

[MIT](LICENSE)
