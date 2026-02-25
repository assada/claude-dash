# Claude Dashboard

Real-time dashboard for managing Claude Code sessions across multiple servers.

## Architecture

```
Agent (Go)                  Dashboard (Next.js)           Browser
──────────                  ───────────────────           ───────
Runs on each server         Runs in Docker                React SPA
Manages tmux sessions       Connects to agents via WS     Real-time panels
Collects system metrics     Relays state to browser       Terminal attach
Self-updates from GitHub    Auth via GitHub OAuth          Command palette
```

## Quick Start

### 1. Dashboard

```bash
cp .env.example .env  # edit secrets
docker compose up -d
```

Open `http://localhost:3000`.

### 2. Agent (on each server)

```bash
curl -fsSL https://raw.githubusercontent.com/assada/claude-dash/master/agent/install.sh | bash
```

The installer configures port, auth token, working dirs, and sets up autostart (systemd/launchd).

### 3. Connect

In Dashboard Settings, add the server using its Tailscale IP (or hostname) and the auth token from the installer.

> **Docker note:** If the agent runs on the same machine as the dashboard, use `host.docker.internal` as the host address to reach it from inside the container.

## Development

```bash
# Dashboard
cd dashboard && npm install && npm run dev

# Agent
cd agent && go build . && ./ccdash-agent --bind 127.0.0.1
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `NEXTAUTH_SECRET` | Random secret for session encryption |
| `NEXTAUTH_URL` | Dashboard base URL |
| `GITHUB_CLIENT_ID` | GitHub OAuth app client ID |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth app secret |
| `ENABLE_GITHUB` | Enable GitHub OAuth login (`true`/`false`) |
| `ENABLE_GUEST` | Enable guest access without auth (`true`/`false`) |

## Agent Version Management

The agent reports its version to the dashboard. When outdated, an orange indicator appears in the server panel. Use the **Update** button in Settings to trigger a remote self-update (downloads latest release from GitHub and restarts).
