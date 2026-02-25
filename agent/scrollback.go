package main

import (
	"log"
	"os"
	"path/filepath"
	"sync"
	"time"
)

type ScrollbackManager struct {
	dir      string
	interval time.Duration
	mu       sync.Mutex
	stopCh   chan struct{}
}

func newScrollbackManager(dir string, interval time.Duration) *ScrollbackManager {
	return &ScrollbackManager{
		dir:      dir,
		interval: interval,
		stopCh:   make(chan struct{}),
	}
}

func (sm *ScrollbackManager) Start() error {
	if err := os.MkdirAll(sm.dir, 0700); err != nil {
		return err
	}

	go func() {
		ticker := time.NewTicker(sm.interval)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				sm.dumpAll()
			case <-sm.stopCh:
				return
			}
		}
	}()
	return nil
}

func (sm *ScrollbackManager) Stop() {
	close(sm.stopCh)
	sm.dumpAll() // Final dump
}

func (sm *ScrollbackManager) dumpAll() {
	sessions, err := listTmuxSessions()
	if err != nil {
		return
	}

	for _, s := range sessions {
		sm.dumpSession(s.Name)
	}
}

func (sm *ScrollbackManager) dumpSession(sessionID string) {
	scrollback, err := capturePaneScrollback(sessionID)
	if err != nil {
		return
	}

	sm.mu.Lock()
	defer sm.mu.Unlock()

	path := filepath.Join(sm.dir, sessionID+".log")
	if err := os.WriteFile(path, []byte(scrollback), 0600); err != nil {
		log.Printf("scrollback dump %s: %v", sessionID, err)
	}
}

func (sm *ScrollbackManager) GetScrollback(sessionID string) (string, error) {
	// Try live tmux first
	if hasTmuxSession(sessionID) {
		return capturePaneScrollback(sessionID)
	}

	// Fall back to persisted file
	path := filepath.Join(sm.dir, sessionID+".log")
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	return string(data), nil
}
