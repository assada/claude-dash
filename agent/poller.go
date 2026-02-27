package main

import (
	"log"
	"sort"
	"sync"
	"time"
)

type SessionInfo struct {
	ID             string       `json:"id"`
	Name           string       `json:"name"`
	State          SessionState `json:"state"`
	Workdir        string       `json:"workdir"`
	Created        int64        `json:"created"`
	StateChangedAt int64        `json:"state_changed_at"`
	LastLine       string       `json:"last_line"`
}

type Poller struct {
	mu       sync.RWMutex
	sessions map[string]*SessionInfo // sessionName -> info
	workdirs map[string]string       // sessionName -> workdir (tracked at creation)
	onChange func(sessions []*SessionInfo)
	stopCh   chan struct{}
}

func newPoller() *Poller {
	return &Poller{
		sessions: make(map[string]*SessionInfo),
		workdirs: make(map[string]string),
		stopCh:   make(chan struct{}),
	}
}

func (p *Poller) TrackSession(name, workdir string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.workdirs[name] = workdir
}

func (p *Poller) Start(interval time.Duration) {
	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				p.poll()
			case <-p.stopCh:
				return
			}
		}
	}()
}

func (p *Poller) Stop() {
	close(p.stopCh)
}

func (p *Poller) GetSessions() []*SessionInfo {
	p.mu.RLock()
	defer p.mu.RUnlock()
	result := make([]*SessionInfo, 0, len(p.sessions))
	for _, s := range p.sessions {
		cp := *s
		result = append(result, &cp)
	}
	sort.Slice(result, func(i, j int) bool {
		return result[i].Name < result[j].Name
	})
	return result
}

func (p *Poller) poll() {
	tmuxSessions, err := listTmuxSessions()
	if err != nil {
		log.Printf("poll: list sessions error: %v", err)
		return
	}

	p.mu.Lock()
	defer p.mu.Unlock()

	now := time.Now().UnixMilli()

	// Build set of current tmux sessions
	currentNames := make(map[string]bool)
	for _, ts := range tmuxSessions {
		currentNames[ts.Name] = true
	}

	// Remove sessions that no longer exist in tmux
	for name := range p.sessions {
		if !currentNames[name] {
			delete(p.sessions, name)
			delete(p.workdirs, name)
		}
	}

	// Update or add sessions
	for _, ts := range tmuxSessions {
		existing, exists := p.sessions[ts.Name]

		var state SessionState
		var lastLine string

		// Capture visible pane for state detection
		paneText, err := capturePaneVisible(ts.Name)
		if err != nil {
			state = StateDead
		} else {
			state = detectState(paneText)
			// Get last non-empty line as preview
			lines := splitNonEmpty(paneText)
			if len(lines) > 0 {
				lastLine = lines[len(lines)-1]
				if len(lastLine) > 120 {
					lastLine = lastLine[:120]
				}
			}
		}

		if exists {
			if existing.State != state {
				existing.State = state
				existing.StateChangedAt = now
			}
			existing.LastLine = lastLine
		} else {
			workdir := p.workdirs[ts.Name]
			p.sessions[ts.Name] = &SessionInfo{
				ID:             ts.Name,
				Name:           ts.Name,
				State:          state,
				Workdir:        workdir,
				Created:        ts.Created,
				StateChangedAt: now,
				LastLine:        lastLine,
			}
		}
	}

	// Notify
	if p.onChange != nil {
		sessions := make([]*SessionInfo, 0, len(p.sessions))
		for _, s := range p.sessions {
			cp := *s
			sessions = append(sessions, &cp)
		}
		sort.Slice(sessions, func(i, j int) bool {
			return sessions[i].Name < sessions[j].Name
		})
		p.onChange(sessions)
	}
}

func splitNonEmpty(s string) []string {
	var result []string
	for _, line := range splitLines(s) {
		trimmed := trimSpace(line)
		if trimmed != "" {
			result = append(result, trimmed)
		}
	}
	return result
}

func splitLines(s string) []string {
	var lines []string
	start := 0
	for i := 0; i < len(s); i++ {
		if s[i] == '\n' {
			lines = append(lines, s[start:i])
			start = i + 1
		}
	}
	if start < len(s) {
		lines = append(lines, s[start:])
	}
	return lines
}

func trimSpace(s string) string {
	start := 0
	end := len(s)
	for start < end && (s[start] == ' ' || s[start] == '\t' || s[start] == '\r') {
		start++
	}
	for end > start && (s[end-1] == ' ' || s[end-1] == '\t' || s[end-1] == '\r') {
		end--
	}
	return s[start:end]
}
