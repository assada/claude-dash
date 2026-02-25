#!/bin/bash
set -e

INSTALL_DIR="${INSTALL_DIR:-/usr/local/bin}"
CONFIG_DIR="$HOME/.claude-dashboard"
SCROLLBACK_DIR="$CONFIG_DIR/scrollback"

echo "=== ccdash-agent installer ==="

# Detect platform
OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)

case "$ARCH" in
    x86_64|amd64) ARCH="amd64" ;;
    aarch64|arm64) ARCH="arm64" ;;
    *) echo "Unsupported architecture: $ARCH"; exit 1 ;;
esac

BINARY="ccdash-agent-${OS}-${ARCH}"

if [ ! -f "$BINARY" ]; then
    echo "Binary $BINARY not found. Building..."
    make "${OS}-${ARCH}"
    BINARY="ccdash-agent-${OS}-${ARCH}"
fi

# Install binary
echo "Installing $BINARY to $INSTALL_DIR..."
sudo cp "$BINARY" "$INSTALL_DIR/ccdash-agent"
sudo chmod +x "$INSTALL_DIR/ccdash-agent"

# Create config directory
mkdir -p "$CONFIG_DIR"
mkdir -p "$SCROLLBACK_DIR"

# Create default config if it doesn't exist
if [ ! -f "$CONFIG_DIR/agent.yaml" ]; then
    TOKEN=$(openssl rand -hex 24)
    cat > "$CONFIG_DIR/agent.yaml" << EOF
port: 9100
token: "$TOKEN"
workdirs:
  - ~/projects
scrollback_dir: $SCROLLBACK_DIR
scrollback_dump_interval: 30s
history_limit: 50000
EOF
    echo "Created config: $CONFIG_DIR/agent.yaml"
    echo "Auth token: $TOKEN"
else
    echo "Config already exists: $CONFIG_DIR/agent.yaml"
fi

# Create systemd service (Linux)
if [ "$OS" = "linux" ] && command -v systemctl &> /dev/null; then
    echo "Creating systemd service..."
    sudo tee /etc/systemd/system/ccdash-agent.service > /dev/null << EOF
[Unit]
Description=Claude Code Dashboard Agent
After=network.target tailscaled.service

[Service]
Type=simple
User=$USER
ExecStart=$INSTALL_DIR/ccdash-agent
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
    sudo systemctl daemon-reload
    sudo systemctl enable ccdash-agent
    sudo systemctl start ccdash-agent
    echo "Service started: sudo systemctl status ccdash-agent"
fi

# Create launchd plist (macOS)
if [ "$OS" = "darwin" ]; then
    PLIST="$HOME/Library/LaunchAgents/com.claude-dashboard.agent.plist"
    echo "Creating launchd service..."
    cat > "$PLIST" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.claude-dashboard.agent</string>
    <key>ProgramArguments</key>
    <array>
        <string>$INSTALL_DIR/ccdash-agent</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>$CONFIG_DIR/agent.log</string>
    <key>StandardErrorPath</key>
    <string>$CONFIG_DIR/agent.err</string>
</dict>
</plist>
EOF
    launchctl load "$PLIST" 2>/dev/null || true
    echo "Service loaded. Check: launchctl list | grep claude"
fi

echo ""
echo "=== Installation complete ==="
echo "Config: $CONFIG_DIR/agent.yaml"
echo "Binary: $INSTALL_DIR/ccdash-agent"
