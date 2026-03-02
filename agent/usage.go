package main

import (
	"bufio"
	"encoding/json"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// UsageEntry is a flat struct sent over WebSocket to the dashboard.
type UsageEntry struct {
	SessionID                string `json:"session_id"`
	RequestID                string `json:"request_id"`
	UUID                     string `json:"uuid"`
	Timestamp                string `json:"timestamp"`
	Model                    string `json:"model"`
	Workdir                  string `json:"workdir"`
	InputTokens              int    `json:"input_tokens"`
	OutputTokens             int    `json:"output_tokens"`
	CacheCreationInputTokens int    `json:"cache_creation_input_tokens"`
	CacheReadInputTokens     int    `json:"cache_read_input_tokens"`
}

// jsonlLine mirrors the on-disk JSONL structure written by Claude Code.
type jsonlLine struct {
	Type      string `json:"type"`
	SessionID string `json:"sessionId"`
	RequestID string `json:"requestId"`
	UUID      string `json:"uuid"`
	Timestamp string `json:"timestamp"`
	Message   *struct {
		Model string `json:"model"`
		Usage *struct {
			InputTokens              int `json:"input_tokens"`
			OutputTokens             int `json:"output_tokens"`
			CacheCreationInputTokens int `json:"cache_creation_input_tokens"`
			CacheReadInputTokens     int `json:"cache_read_input_tokens"`
		} `json:"usage"`
	} `json:"message"`
}

type UsageScanner struct {
	mu          sync.RWMutex
	fileOffsets map[string]int64
	poller      *Poller
	onChange    func([]UsageEntry) // called with NEW entries only
	stopCh      chan struct{}
}

func newUsageScanner(poller *Poller) *UsageScanner {
	return &UsageScanner{
		fileOffsets: make(map[string]int64),
		poller:      poller,
		stopCh:      make(chan struct{}),
	}
}

func (u *UsageScanner) Start(interval time.Duration) {
	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				u.scan()
			case <-u.stopCh:
				return
			}
		}
	}()
}

func (u *UsageScanner) Stop() {
	close(u.stopCh)
}

// RescanAll resets file offsets so the next scan re-reads everything.
// Used when a new subscriber connects to ensure it gets all historical data.
func (u *UsageScanner) RescanAll() {
	u.mu.Lock()
	count := len(u.fileOffsets)
	u.fileOffsets = make(map[string]int64)
	u.mu.Unlock()
	log.Printf("usage: RescanAll — reset %d file offsets, triggering scan", count)
	go u.scan()
}

func (u *UsageScanner) scan() {
	sessions := u.poller.GetSessions()

	// Collect unique workdirs.
	workdirSet := make(map[string]bool)
	for _, s := range sessions {
		if s.Workdir != "" {
			workdirSet[s.Workdir] = true
		}
	}

	home, err := os.UserHomeDir()
	if err != nil {
		return
	}

	var allNew []UsageEntry
	for workdir := range workdirSet {
		folder := workdirToFolder(workdir)
		base := filepath.Join(home, ".claude", "projects", folder)

		newEntries := u.scanDir(base, workdir)
		allNew = append(allNew, newEntries...)
	}

	log.Printf("usage: scan found %d entries from %d workdirs", len(allNew), len(workdirSet))

	if len(allNew) == 0 {
		return
	}

	if u.onChange != nil {
		u.onChange(allNew)
	}
}

func (u *UsageScanner) scanDir(base, workdir string) []UsageEntry {
	var result []UsageEntry

	// Top-level *.jsonl
	topFiles, _ := filepath.Glob(filepath.Join(base, "*.jsonl"))
	for _, f := range topFiles {
		result = append(result, u.scanFile(f, workdir)...)
	}

	// Subagent files: {session-uuid}/subagents/agent-*.jsonl
	subDirs, _ := filepath.Glob(filepath.Join(base, "*", "subagents"))
	for _, subDir := range subDirs {
		subFiles, _ := filepath.Glob(filepath.Join(subDir, "*.jsonl"))
		for _, f := range subFiles {
			result = append(result, u.scanFile(f, workdir)...)
		}
	}

	return result
}

func (u *UsageScanner) scanFile(path, workdir string) []UsageEntry {
	u.mu.Lock()
	offset := u.fileOffsets[path]
	u.mu.Unlock()

	info, err := os.Stat(path)
	if err != nil {
		return nil
	}

	// File truncated/rotated — reset offset. Dedup protects against re-reads.
	if info.Size() < offset {
		offset = 0
	}

	// Nothing new to read.
	if info.Size() == offset {
		return nil
	}

	f, err := os.Open(path)
	if err != nil {
		return nil
	}
	defer f.Close()

	if offset > 0 {
		if _, err := f.Seek(offset, 0); err != nil {
			return nil
		}
	}

	var entries []UsageEntry
	scanner := bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 256*1024), 1024*1024)

	for scanner.Scan() {
		line := scanner.Bytes()
		if len(line) == 0 {
			continue
		}

		var jl jsonlLine
		if err := json.Unmarshal(line, &jl); err != nil {
			continue
		}

		if jl.Type != "assistant" || jl.Message == nil || jl.Message.Usage == nil {
			continue
		}

		entries = append(entries, UsageEntry{
			SessionID:                jl.SessionID,
			RequestID:                jl.RequestID,
			UUID:                     jl.UUID,
			Timestamp:                jl.Timestamp,
			Model:                    jl.Message.Model,
			Workdir:                  workdir,
			InputTokens:              jl.Message.Usage.InputTokens,
			OutputTokens:             jl.Message.Usage.OutputTokens,
			CacheCreationInputTokens: jl.Message.Usage.CacheCreationInputTokens,
			CacheReadInputTokens:     jl.Message.Usage.CacheReadInputTokens,
		})
	}

	if err := scanner.Err(); err != nil {
		log.Printf("usage: scan error %s: %v", path, err)
	}

	// Update offset to current file position.
	newOffset, err := f.Seek(0, 1) // SEEK_CUR
	if err == nil {
		u.mu.Lock()
		u.fileOffsets[path] = newOffset
		u.mu.Unlock()
	}

	return entries
}

func workdirToFolder(workdir string) string {
	return strings.ReplaceAll(workdir, "/", "-")
}
