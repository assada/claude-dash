// agent/session_map.go
package main

import (
	"encoding/json"
	"log"
	"os"
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
	filePath string                    // persist path
}

func newSessionMap(filePath string) *SessionMap {
	sm := &SessionMap{
		sessions: make(map[string]sessionMapping),
		filePath: filePath,
	}
	sm.load()
	return sm
}

func (m *SessionMap) Set(tmuxName, claudeUUID, workdir string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.sessions[tmuxName] = sessionMapping{ClaudeUUID: claudeUUID, Workdir: workdir}
	m.saveLocked()
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
	m.saveLocked()
}

// load reads session map from disk. Called once at startup.
func (m *SessionMap) load() {
	if m.filePath == "" {
		return
	}
	data, err := os.ReadFile(m.filePath)
	if err != nil {
		return // file doesn't exist yet, that's fine
	}
	var sessions map[string]sessionMapping
	if err := json.Unmarshal(data, &sessions); err != nil {
		log.Printf("session-map: failed to parse %s: %v", m.filePath, err)
		return
	}
	m.sessions = sessions
	log.Printf("session-map: loaded %d mappings from disk", len(sessions))
}

// saveLocked writes session map to disk. Must be called with mu held.
func (m *SessionMap) saveLocked() {
	if m.filePath == "" {
		return
	}
	data, err := json.Marshal(m.sessions)
	if err != nil {
		return
	}
	os.MkdirAll(filepath.Dir(m.filePath), 0755)
	os.WriteFile(m.filePath, data, 0644)
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
