// agent/session_map.go
package main

import (
	"path/filepath"
	"strings"
	"sync"
)

type sessionMapping struct {
	ClaudeUUID string
	Workdir    string
}

type SessionMap struct {
	mu       sync.RWMutex
	sessions map[string]sessionMapping // tmuxName -> mapping
}

func newSessionMap() *SessionMap {
	return &SessionMap{
		sessions: make(map[string]sessionMapping),
	}
}

func (m *SessionMap) Set(tmuxName, claudeUUID, workdir string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.sessions[tmuxName] = sessionMapping{ClaudeUUID: claudeUUID, Workdir: workdir}
}

func (m *SessionMap) Get(tmuxName string) (claudeUUID, workdir string, ok bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	s, ok := m.sessions[tmuxName]
	if !ok {
		return "", "", false
	}
	return s.ClaudeUUID, s.Workdir, true
}

func (m *SessionMap) Delete(tmuxName string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.sessions, tmuxName)
}

// JSONLPath returns the expected JSONL file path for a tmux session.
func (m *SessionMap) JSONLPath(tmuxName, homeDir string) string {
	m.mu.RLock()
	defer m.mu.RUnlock()
	s, ok := m.sessions[tmuxName]
	if !ok {
		return ""
	}
	encoded := encodeWorkdir(s.Workdir)
	return filepath.Join(homeDir, ".claude", "projects", encoded, s.ClaudeUUID+".jsonl")
}

// AllJSONLPaths returns all tracked JSONL paths.
func (m *SessionMap) AllJSONLPaths(homeDir string) map[string]string {
	m.mu.RLock()
	defer m.mu.RUnlock()
	paths := make(map[string]string, len(m.sessions))
	for name, s := range m.sessions {
		encoded := encodeWorkdir(s.Workdir)
		paths[name] = filepath.Join(homeDir, ".claude", "projects", encoded, s.ClaudeUUID+".jsonl")
	}
	return paths
}

// PathPrefixMap returns a map of JSONL path prefixes to tmux session names.
func (m *SessionMap) PathPrefixMap(homeDir string) map[string]string {
	m.mu.RLock()
	defer m.mu.RUnlock()
	result := make(map[string]string, len(m.sessions))
	for name, s := range m.sessions {
		encoded := encodeWorkdir(s.Workdir)
		prefix := filepath.Join(homeDir, ".claude", "projects", encoded, s.ClaudeUUID)
		result[prefix] = name
	}
	return result
}

// encodeWorkdir converts a workdir path to Claude Code's encoded format.
// /Users/me/projects/cp -> -Users-me-projects-cp
func encodeWorkdir(workdir string) string {
	return strings.ReplaceAll(workdir, "/", "-")
}

// defaultContextLimit is 200k — safe assumption for all models.
// Claude 4.6 models CAN have 1M context, but the [1m] suffix is NOT stored in JSONL.
// We detect 1M dynamically: if input_tokens ever exceeds 200k, it's definitely 1M.
const defaultContextLimit = 200_000

// getContextLimit returns the context window size.
// maxObservedInputTokens is the highest input_tokens seen in any entry for this session.
// If it exceeds 200k, the session is using 1M context (auto-detected).
func getContextLimit(maxObservedInputTokens int) int {
	if maxObservedInputTokens > defaultContextLimit {
		return 1_000_000
	}
	return defaultContextLimit
}
