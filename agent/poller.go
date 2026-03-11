package main

import (
	"log"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
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
	mu          sync.RWMutex
	sessions    map[string]*SessionInfo // sessionName -> info
	workdirs    map[string]string       // sessionName -> workdir (tracked at creation)
	onChange    func(sessions []*SessionInfo)
	stateMerger func(tmuxName string, tmuxState SessionState) SessionState
	stopCh      chan struct{}
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

func (p *Poller) RemoveSession(name string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	delete(p.sessions, name)
	delete(p.workdirs, name)
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
			if p.stateMerger != nil {
				state = p.stateMerger(ts.Name, state)
			}
			lastLine = extractContentLine(paneText)
			// Fallback: if smart extraction filtered everything out,
			// show the raw last non-empty line — junk is better than nothing.
			if lastLine == "" {
				if raw := splitNonEmpty(paneText); len(raw) > 0 {
					lastLine = truncateUTF8(raw[len(raw)-1], 120)
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
			if workdir == "" {
				// Recover workdir from tmux for pre-existing sessions
				if wd, err := getPaneWorkdir(ts.Name); err == nil && wd != "" {
					workdir = wd
					p.workdirs[ts.Name] = workdir
				}
			}
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

// Chrome lines to skip when extracting content from Claude Code terminal.
var (
	// skipContaining — skip lines that contain any of these substrings.
	skipContaining = []string{
		"⏵",        // permission mode indicator
		"shift+tab", // mode cycling hint
		"esc to interrupt",
	}

	// skipPrefixes — skip lines starting with any of these.
	skipPrefixes = []string{
		"⎿", // sub-item continuation (tips, file lists, etc.)
	}
)

// extractContentLine extracts the meaningful content line from Claude Code's
// terminal output, skipping the bottom UI chrome (status bar, input box, tips).
//
// Claude Code terminal layout (bottom to top):
//
//	status bar:  ⏵⏵ bypass permissions on (shift+tab to cycle)
//	border:      ──────────────────────────────────
//	input box:   ❯ Press up to edit queued messages
//	border:      ──────────────────────────────────
//	junk:        ⎿  Tip: Use /agents to optimize...
//	content:     · Booping… (thinking)   ← we want this
func extractContentLine(paneText string) string {
	lines := splitLines(paneText)

	for i := len(lines) - 1; i >= 0; i-- {
		trimmed := trimSpace(lines[i])

		if trimmed == "" {
			continue
		}

		// Skip input box: everything between two border lines (inclusive).
		if isBorderLine(trimmed) {
			for i--; i >= 0; i-- {
				if isBorderLine(trimSpace(lines[i])) {
					break
				}
			}
			continue
		}

		if shouldSkipLine(trimmed) {
			continue
		}

		// Found a content line.
		return truncateUTF8(trimmed, 120)
	}

	return ""
}

func shouldSkipLine(line string) bool {
	for _, s := range skipContaining {
		if strings.Contains(line, s) {
			return true
		}
	}
	for _, p := range skipPrefixes {
		if strings.HasPrefix(line, p) {
			return true
		}
	}
	return false
}

// isBorderLine checks if a line is a horizontal border (──────).
func isBorderLine(line string) bool {
	count, total := 0, 0
	for _, r := range line {
		total++
		if r == '─' || r == '━' || r == '═' {
			count++
		}
	}
	return total >= 5 && count*100/total > 60
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

// truncateUTF8 truncates s to at most maxRunes runes without breaking multi-byte characters.
func truncateUTF8(s string, maxRunes int) string {
	if utf8.RuneCountInString(s) <= maxRunes {
		return s
	}
	runes := 0
	for i := range s {
		if runes == maxRunes {
			return s[:i]
		}
		runes++
	}
	return s
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
