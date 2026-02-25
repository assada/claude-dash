package main

import (
	"fmt"
	"os/exec"
	"strings"
	"time"
)

type TmuxSession struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Created   int64  `json:"created"`
	Windows   int    `json:"windows"`
	Attached  bool   `json:"attached"`
	Width     int    `json:"width"`
	Height    int    `json:"height"`
}

func tmuxAvailable() bool {
	_, err := exec.LookPath("tmux")
	return err == nil
}

func createTmuxSession(name, workdir string, historyLimit int) (string, error) {
	sessionID := fmt.Sprintf("cc-%d-%s", time.Now().UnixMilli(), sanitizeName(name))

	// Create tmux session
	cmd := exec.Command("tmux", "new-session", "-d",
		"-s", sessionID,
		"-c", workdir,
		"-x", "200",
		"-y", "50",
	)
	if out, err := cmd.CombinedOutput(); err != nil {
		return "", fmt.Errorf("tmux new-session: %s: %w", string(out), err)
	}

	// Set history limit
	cmd = exec.Command("tmux", "set-option", "-t", sessionID, "history-limit", fmt.Sprintf("%d", historyLimit))
	if out, err := cmd.CombinedOutput(); err != nil {
		return "", fmt.Errorf("tmux set-option: %s: %w", string(out), err)
	}

	// Start Claude Code inside
	cmd = exec.Command("tmux", "send-keys", "-t", sessionID, "claude", "Enter")
	if out, err := cmd.CombinedOutput(); err != nil {
		return "", fmt.Errorf("tmux send-keys: %s: %w", string(out), err)
	}

	return sessionID, nil
}

func listTmuxSessions() ([]TmuxSession, error) {
	cmd := exec.Command("tmux", "list-sessions", "-F",
		"#{session_id}:#{session_name}:#{session_created}:#{session_windows}:#{session_attached}:#{session_width}:#{session_height}")
	out, err := cmd.CombinedOutput()
	if err != nil {
		outStr := string(out)
		if strings.Contains(outStr, "no server running") ||
			strings.Contains(outStr, "no sessions") ||
			strings.Contains(outStr, "error connecting to") {
			return nil, nil
		}
		return nil, fmt.Errorf("tmux list-sessions: %s: %w", string(out), err)
	}

	var sessions []TmuxSession
	for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
		if line == "" {
			continue
		}
		parts := strings.SplitN(line, ":", 7)
		if len(parts) < 7 {
			continue
		}

		name := parts[1]
		// Only include sessions that start with "cc-"
		if !strings.HasPrefix(name, "cc-") {
			continue
		}

		var created int64
		fmt.Sscanf(parts[2], "%d", &created)
		var windows int
		fmt.Sscanf(parts[3], "%d", &windows)
		var width, height int
		fmt.Sscanf(parts[5], "%d", &width)
		fmt.Sscanf(parts[6], "%d", &height)

		sessions = append(sessions, TmuxSession{
			ID:       parts[0],
			Name:     name,
			Created:  created,
			Windows:  windows,
			Attached: parts[4] == "1",
			Width:    width,
			Height:   height,
		})
	}
	return sessions, nil
}

func killTmuxSession(sessionID string) error {
	cmd := exec.Command("tmux", "kill-session", "-t", sessionID)
	if out, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("tmux kill-session: %s: %w", string(out), err)
	}
	return nil
}

func hasTmuxSession(sessionID string) bool {
	cmd := exec.Command("tmux", "has-session", "-t", sessionID)
	return cmd.Run() == nil
}

func capturePaneVisible(sessionID string) (string, error) {
	cmd := exec.Command("tmux", "capture-pane", "-t", sessionID, "-p", "-J")
	out, err := cmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("tmux capture-pane: %s: %w", string(out), err)
	}
	return string(out), nil
}

func capturePaneScrollback(sessionID string) (string, error) {
	cmd := exec.Command("tmux", "capture-pane", "-t", sessionID, "-p", "-J", "-S", "-50000")
	out, err := cmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("tmux capture-pane scrollback: %s: %w", string(out), err)
	}
	return string(out), nil
}

func sanitizeName(name string) string {
	var b strings.Builder
	for _, r := range name {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '-' || r == '_' {
			b.WriteRune(r)
		}
	}
	s := b.String()
	if s == "" {
		s = "session"
	}
	if len(s) > 32 {
		s = s[:32]
	}
	return s
}
