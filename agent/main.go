package main

import (
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
)

var version = "dev"

func main() {
	configPath := flag.String("config", "", "Path to config file")
	bindFlag := flag.String("bind", "", "Override bind address (e.g. 0.0.0.0 for local testing)")
	portFlag := flag.Int("port", 0, "Override port")
	flag.Parse()

	// Determine config path
	cfgPath := *configPath
	if cfgPath == "" {
		home, _ := os.UserHomeDir()
		cfgPath = filepath.Join(home, ".claude-dashboard", "agent.yaml")
	}

	config, err := loadConfig(cfgPath)
	if err != nil {
		log.Fatalf("Failed to load config: %v", err)
	}

	// Apply flag overrides
	if *bindFlag != "" {
		config.Bind = *bindFlag
	}
	if *portFlag != 0 {
		config.Port = *portFlag
	}

	// Check tmux
	if !tmuxAvailable() {
		log.Fatal("tmux is not installed or not in PATH")
	}

	// Determine bind address
	bindAddr := config.Bind
	if bindAddr == "" {
		ip, err := getTailscaleIP()
		if err != nil {
			log.Printf("WARNING: Could not detect Tailscale IP: %v", err)
			log.Printf("Binding to 127.0.0.1 (local only). Use --bind to override.")
			bindAddr = "127.0.0.1"
		} else {
			bindAddr = ip
		}
	}

	listenAddr := fmt.Sprintf("%s:%d", bindAddr, config.Port)

	// Start scrollback manager
	scrollback := newScrollbackManager(config.GetScrollbackDir(), config.GetDumpInterval())
	if err := scrollback.Start(); err != nil {
		log.Fatalf("Failed to start scrollback manager: %v", err)
	}

	// Start poller
	poller := newPoller()
	poller.Start(500 * 1000000) // 500ms

	// Create server
	srv := newServer(config, poller, scrollback)

	// Start HTTP server
	listener, err := net.Listen("tcp", listenAddr)
	if err != nil {
		log.Fatalf("Failed to listen on %s: %v", listenAddr, err)
	}

	log.Printf("ccdash-agent %s listening on %s", version, listenAddr)
	if config.Token != "" {
		log.Printf("Auth token configured")
	} else {
		log.Printf("WARNING: No auth token configured")
	}
	log.Printf("Scrollback dir: %s", config.GetScrollbackDir())

	// Graceful shutdown
	go func() {
		sigCh := make(chan os.Signal, 1)
		signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
		<-sigCh
		log.Println("Shutting down...")
		poller.Stop()
		scrollback.Stop()
		listener.Close()
		os.Exit(0)
	}()

	if err := http.Serve(listener, srv.Handler()); err != nil {
		log.Fatalf("HTTP serve: %v", err)
	}
}

func getTailscaleIP() (string, error) {
	// Try `tailscale ip -4`
	cmd := exec.Command("tailscale", "ip", "-4")
	out, err := cmd.Output()
	if err == nil {
		ip := strings.TrimSpace(string(out))
		if ip != "" && strings.HasPrefix(ip, "100.") {
			return ip, nil
		}
	}

	// Fallback: look through network interfaces for 100.x.x.x
	ifaces, err := net.Interfaces()
	if err != nil {
		return "", fmt.Errorf("listing interfaces: %w", err)
	}

	for _, iface := range ifaces {
		addrs, err := iface.Addrs()
		if err != nil {
			continue
		}
		for _, addr := range addrs {
			var ip net.IP
			switch v := addr.(type) {
			case *net.IPNet:
				ip = v.IP
			case *net.IPAddr:
				ip = v.IP
			}
			if ip != nil && ip.To4() != nil && strings.HasPrefix(ip.String(), "100.") {
				return ip.String(), nil
			}
		}
	}

	return "", fmt.Errorf("no Tailscale interface found")
}
