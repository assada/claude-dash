#!/bin/bash
set -e

REPO="assada/claude-dash"
INSTALL_DIR="${INSTALL_DIR:-/usr/local/bin}"
CONFIG_DIR="$HOME/.claude-dashboard"
SCROLLBACK_DIR="$CONFIG_DIR/scrollback"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

info()  { echo -e "${CYAN}==>${NC} $*"; }
ok()    { echo -e "${GREEN}==>${NC} $*"; }
warn()  { echo -e "${YELLOW}==>${NC} $*"; }
err()   { echo -e "${RED}==>${NC} $*" >&2; }

echo -e "${BOLD}"
echo "  ╔══════════════════════════════════════╗"
echo "  ║   Claude Dashboard — Agent Installer ║"
echo "  ╚══════════════════════════════════════╝"
echo -e "${NC}"

# ── Detect platform ──────────────────────────────────────────────

OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)

case "$ARCH" in
    x86_64|amd64) ARCH="amd64" ;;
    aarch64|arm64) ARCH="arm64" ;;
    *) err "Unsupported architecture: $ARCH"; exit 1 ;;
esac

case "$OS" in
    linux|darwin) ;;
    *) err "Unsupported OS: $OS"; exit 1 ;;
esac

PLATFORM="${OS}-${ARCH}"
info "Platform: ${BOLD}${PLATFORM}${NC}"

# ── Check dependencies ───────────────────────────────────────────

if ! command -v tmux &> /dev/null; then
    warn "tmux is not installed!"
    if [ "$OS" = "linux" ]; then
        echo -n "  Install tmux now? [Y/n] "
        read -r ans
        if [ "$ans" != "n" ] && [ "$ans" != "N" ]; then
            if command -v apt-get &> /dev/null; then
                sudo apt-get update -qq && sudo apt-get install -y -qq tmux
            elif command -v yum &> /dev/null; then
                sudo yum install -y tmux
            elif command -v pacman &> /dev/null; then
                sudo pacman -S --noconfirm tmux
            else
                err "Cannot install tmux automatically. Install it manually."
                exit 1
            fi
        else
            err "tmux is required. Aborting."
            exit 1
        fi
    elif [ "$OS" = "darwin" ]; then
        echo -n "  Install tmux via Homebrew? [Y/n] "
        read -r ans
        if [ "$ans" != "n" ] && [ "$ans" != "N" ]; then
            brew install tmux
        else
            err "tmux is required. Aborting."
            exit 1
        fi
    fi
fi

ok "tmux: $(tmux -V)"

# ── Interactive configuration ────────────────────────────────────

echo ""
echo -e "${BOLD}Configuration${NC}"
echo ""

# Port
DEFAULT_PORT=9100
echo -n "  Port [${DEFAULT_PORT}]: "
read -r PORT
PORT="${PORT:-$DEFAULT_PORT}"

# Bind address
echo ""
echo "  Listen on:"
echo "    1) Tailscale only (auto-detect 100.x.x.x) — recommended"
echo "    2) All interfaces (0.0.0.0)"
echo "    3) Localhost only (127.0.0.1)"
echo "    4) Custom IP"
echo -n "  Choose [1]: "
read -r BIND_CHOICE
BIND_CHOICE="${BIND_CHOICE:-1}"

case "$BIND_CHOICE" in
    1) BIND="" ;;  # Agent auto-detects Tailscale
    2) BIND="0.0.0.0" ;;
    3) BIND="127.0.0.1" ;;
    4)
        echo -n "  IP address: "
        read -r BIND
        ;;
    *) BIND="" ;;
esac

# Auth token
echo ""
echo -n "  Auth token (leave empty to auto-generate): "
read -r TOKEN
if [ -z "$TOKEN" ]; then
    TOKEN=$(openssl rand -hex 24 2>/dev/null || head -c 48 /dev/urandom | base64 | tr -d '/+=' | head -c 48)
fi

# Working directories
echo ""
echo -n "  Working directories (comma-separated) [~/projects]: "
read -r WORKDIRS_INPUT
WORKDIRS_INPUT="${WORKDIRS_INPUT:-~/projects}"

# ── Download binary ──────────────────────────────────────────────

echo ""
BINARY_NAME="ccdash-agent-${PLATFORM}"

# Try to get latest release
info "Fetching latest release..."
RELEASE_URL=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" 2>/dev/null | grep "browser_download_url.*${BINARY_NAME}" | head -1 | cut -d '"' -f 4)

if [ -n "$RELEASE_URL" ]; then
    info "Downloading ${BINARY_NAME}..."
    TMPDIR=$(mktemp -d)
    curl -fsSL "$RELEASE_URL" -o "${TMPDIR}/ccdash-agent"
    chmod +x "${TMPDIR}/ccdash-agent"
else
    warn "No release found. Trying to build from source..."
    if ! command -v go &> /dev/null; then
        err "Go is not installed. Install Go or wait for a release."
        exit 1
    fi
    TMPDIR=$(mktemp -d)
    git clone --depth 1 "https://github.com/${REPO}.git" "${TMPDIR}/src"
    cd "${TMPDIR}/src/agent"
    go build -ldflags "-s -w" -o "${TMPDIR}/ccdash-agent" .
    cd - > /dev/null
fi

# ── Install ──────────────────────────────────────────────────────

info "Installing to ${INSTALL_DIR}/ccdash-agent..."
if [ -w "$INSTALL_DIR" ]; then
    cp "${TMPDIR}/ccdash-agent" "$INSTALL_DIR/ccdash-agent"
else
    sudo cp "${TMPDIR}/ccdash-agent" "$INSTALL_DIR/ccdash-agent"
    sudo chmod +x "$INSTALL_DIR/ccdash-agent"
fi
rm -rf "$TMPDIR"

ok "Binary installed: ${INSTALL_DIR}/ccdash-agent"

# ── Config ───────────────────────────────────────────────────────

mkdir -p "$CONFIG_DIR"
mkdir -p "$SCROLLBACK_DIR"

# Build workdirs YAML
WORKDIRS_YAML=""
IFS=',' read -ra DIRS <<< "$WORKDIRS_INPUT"
for dir in "${DIRS[@]}"; do
    dir=$(echo "$dir" | xargs) # trim whitespace
    WORKDIRS_YAML="${WORKDIRS_YAML}  - ${dir}\n"
done

if [ -f "$CONFIG_DIR/agent.yaml" ]; then
    warn "Config already exists: $CONFIG_DIR/agent.yaml"
    echo -n "  Overwrite? [y/N] "
    read -r ans
    if [ "$ans" != "y" ] && [ "$ans" != "Y" ]; then
        info "Keeping existing config."
        SKIP_CONFIG=1
    fi
fi

if [ -z "$SKIP_CONFIG" ]; then
    BIND_LINE=""
    if [ -n "$BIND" ]; then
        BIND_LINE="bind: \"${BIND}\""
    else
        BIND_LINE="bind: \"\"  # auto-detect Tailscale IP"
    fi

    cat > "$CONFIG_DIR/agent.yaml" << ENDCFG
${BIND_LINE}
port: ${PORT}
token: "${TOKEN}"
workdirs:
$(echo -e "$WORKDIRS_YAML")scrollback_dir: ${SCROLLBACK_DIR}
scrollback_dump_interval: 30s
history_limit: 50000
ENDCFG

    ok "Config written: $CONFIG_DIR/agent.yaml"
fi

# ── Autostart ────────────────────────────────────────────────────

echo ""

# Stop existing service
if [ "$OS" = "linux" ] && systemctl is-active --quiet ccdash-agent 2>/dev/null; then
    info "Stopping existing service..."
    sudo systemctl stop ccdash-agent
fi
if [ "$OS" = "darwin" ]; then
    launchctl bootout gui/$(id -u)/com.claude-dashboard.agent 2>/dev/null || true
fi

if [ "$OS" = "linux" ] && command -v systemctl &> /dev/null; then
    info "Setting up systemd service..."
    sudo tee /etc/systemd/system/ccdash-agent.service > /dev/null << ENDSVC
[Unit]
Description=Claude Code Dashboard Agent
After=network.target tailscaled.service

[Service]
Type=simple
User=${USER}
ExecStart=${INSTALL_DIR}/ccdash-agent
Restart=always
RestartSec=5
Environment=HOME=${HOME}

[Install]
WantedBy=multi-user.target
ENDSVC
    sudo systemctl daemon-reload
    sudo systemctl enable ccdash-agent
    sudo systemctl start ccdash-agent
    ok "systemd service started"
    echo ""
    echo "  Manage:"
    echo "    sudo systemctl status ccdash-agent"
    echo "    sudo systemctl restart ccdash-agent"
    echo "    journalctl -u ccdash-agent -f"

elif [ "$OS" = "darwin" ]; then
    PLIST="$HOME/Library/LaunchAgents/com.claude-dashboard.agent.plist"
    mkdir -p "$HOME/Library/LaunchAgents"
    info "Setting up launchd service..."
    cat > "$PLIST" << ENDPLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.claude-dashboard.agent</string>
    <key>ProgramArguments</key>
    <array>
        <string>${INSTALL_DIR}/ccdash-agent</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${CONFIG_DIR}/agent.log</string>
    <key>StandardErrorPath</key>
    <string>${CONFIG_DIR}/agent.err</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>HOME</key>
        <string>${HOME}</string>
        <key>PATH</key>
        <string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string>
    </dict>
</dict>
</plist>
ENDPLIST
    launchctl bootstrap gui/$(id -u) "$PLIST" 2>/dev/null || launchctl load "$PLIST" 2>/dev/null || true
    ok "launchd service started"
    echo ""
    echo "  Manage:"
    echo "    launchctl list | grep claude"
    echo "    tail -f ${CONFIG_DIR}/agent.log"
fi

# ── Summary ──────────────────────────────────────────────────────

echo ""
echo -e "${BOLD}╔══════════════════════════════════════╗${NC}"
echo -e "${BOLD}║         Installation complete!        ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════╝${NC}"
echo ""
echo "  Binary:  ${INSTALL_DIR}/ccdash-agent"
echo "  Config:  ${CONFIG_DIR}/agent.yaml"
echo "  Port:    ${PORT}"
if [ -n "$BIND" ]; then
    echo "  Bind:    ${BIND}"
else
    echo "  Bind:    Tailscale (auto-detect)"
fi
echo ""
echo -e "  ${YELLOW}Auth token: ${TOKEN}${NC}"
echo "  (save this — you'll need it in the dashboard config)"
echo ""
echo "  Test: curl http://localhost:${PORT}/health"
echo ""
