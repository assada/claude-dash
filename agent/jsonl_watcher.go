// agent/jsonl_watcher.go
package main

import (
	"bytes"
	"io"
	"log"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
)

// JSONLEvent represents a parsed event from JSONL file changes.
type JSONLEvent struct {
	FilePath string
	Entry    *JSONLEntry
}

// IncrementalReader reads only new bytes from a file since last read.
type IncrementalReader struct {
	path          string
	lastOffset    int64
	pendingBuffer []byte
}

func newIncrementalReader(path string) *IncrementalReader {
	return &IncrementalReader{path: path}
}

func (r *IncrementalReader) ReadNew() ([]*JSONLEntry, error) {
	f, err := os.Open(r.path)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	info, err := f.Stat()
	if err != nil {
		return nil, err
	}

	// Detect truncation
	if info.Size() < r.lastOffset {
		r.lastOffset = 0
		r.pendingBuffer = nil
	}

	if info.Size() == r.lastOffset {
		return nil, nil // no new data
	}

	// Seek to last position
	if _, err := f.Seek(r.lastOffset, io.SeekStart); err != nil {
		return nil, err
	}

	newData, err := io.ReadAll(f)
	if err != nil {
		return nil, err
	}

	r.lastOffset = info.Size()

	// Prepend any pending buffer from last read
	if len(r.pendingBuffer) > 0 {
		newData = append(r.pendingBuffer, newData...)
		r.pendingBuffer = nil
	}

	// Split into lines
	lines := bytes.Split(newData, []byte("\n"))

	// If last chunk doesn't end with newline, buffer it
	if len(newData) > 0 && newData[len(newData)-1] != '\n' {
		r.pendingBuffer = lines[len(lines)-1]
		lines = lines[:len(lines)-1]
	}

	var entries []*JSONLEntry
	for _, line := range lines {
		line = bytes.TrimSpace(line)
		if len(line) == 0 {
			continue
		}
		entry, err := parseJSONLLine(line)
		if err != nil {
			continue // skip malformed lines
		}
		entries = append(entries, entry)
	}

	return entries, nil
}

// uuidPattern matches UUID-formatted directory names (e.g., a1b2c3d4-e5f6-7890-abcd-ef1234567890).
var uuidPattern = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

// JSONLWatcher watches directories for JSONL file changes.
// Errata E12: starts empty, directories added only via WatchSession().
type JSONLWatcher struct {
	mu       sync.Mutex
	watcher  *fsnotify.Watcher
	readers  map[string]*IncrementalReader
	onEvents func([]JSONLEvent)
	stopCh   chan struct{}
	debounce map[string]*time.Timer
}

// newJSONLWatcher creates a new watcher that starts empty.
// Directories are added only via WatchSession(). (Errata E12)
func newJSONLWatcher(onEvents func([]JSONLEvent)) (*JSONLWatcher, error) {
	fsw, err := fsnotify.NewWatcher()
	if err != nil {
		return nil, err
	}

	w := &JSONLWatcher{
		watcher:  fsw,
		readers:  make(map[string]*IncrementalReader),
		onEvents: onEvents,
		stopCh:   make(chan struct{}),
		debounce: make(map[string]*time.Timer),
	}

	go w.loop()
	go w.catchUpLoop()

	return w, nil
}

func (w *JSONLWatcher) loop() {
	for {
		select {
		case event, ok := <-w.watcher.Events:
			if !ok {
				return
			}
			if !strings.HasSuffix(event.Name, ".jsonl") {
				// Check if it's a new directory being created (subagent dirs)
				if event.Has(fsnotify.Create) {
					w.tryWatchSubdir(event.Name)
				}
				continue
			}
			if event.Has(fsnotify.Write) || event.Has(fsnotify.Create) {
				w.debouncedProcess(event.Name)
			}

		case err, ok := <-w.watcher.Errors:
			if !ok {
				return
			}
			log.Printf("jsonl watcher error: %v", err)

		case <-w.stopCh:
			return
		}
	}
}

// tryWatchSubdir watches newly created directories that are UUID-named session
// directories (which may contain a subagents subfolder) or subagent directories.
func (w *JSONLWatcher) tryWatchSubdir(path string) {
	info, err := os.Stat(path)
	if err != nil || !info.IsDir() {
		return
	}

	base := filepath.Base(path)

	// Watch "subagents" directories directly
	if base == "subagents" {
		w.watcher.Add(path)
		return
	}

	// Watch UUID-formatted directories (session UUID dirs that contain subagents)
	if uuidPattern.MatchString(base) {
		w.watcher.Add(path)
		// Also check if subagents subdir already exists
		subagentDir := filepath.Join(path, "subagents")
		if si, err := os.Stat(subagentDir); err == nil && si.IsDir() {
			w.watcher.Add(subagentDir)
		}
		return
	}
}

func (w *JSONLWatcher) debouncedProcess(path string) {
	w.mu.Lock()
	defer w.mu.Unlock()

	if timer, exists := w.debounce[path]; exists {
		timer.Stop()
	}
	w.debounce[path] = time.AfterFunc(100*time.Millisecond, func() {
		w.processFile(path)
	})
}

func (w *JSONLWatcher) processFile(path string) {
	w.mu.Lock()
	reader, exists := w.readers[path]
	if !exists {
		reader = newIncrementalReader(path)
		w.readers[path] = reader
	}
	w.mu.Unlock()

	entries, err := reader.ReadNew()
	if err != nil {
		log.Printf("jsonl read error %s: %v", filepath.Base(path), err)
		return
	}
	if len(entries) == 0 {
		return
	}

	events := make([]JSONLEvent, len(entries))
	for i, e := range entries {
		events[i] = JSONLEvent{FilePath: path, Entry: e}
	}
	w.onEvents(events)
}

func (w *JSONLWatcher) catchUpLoop() {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			w.mu.Lock()
			paths := make([]string, 0, len(w.readers))
			for p := range w.readers {
				paths = append(paths, p)
			}
			w.mu.Unlock()

			for _, path := range paths {
				w.processFile(path)
			}
		case <-w.stopCh:
			return
		}
	}
}

// WatchSession adds a specific JSONL file's directory to the watcher.
func (w *JSONLWatcher) WatchSession(jsonlPath string) {
	dir := filepath.Dir(jsonlPath)
	log.Printf("[jsonl-watcher] WatchSession: path=%s dir=%s", jsonlPath, dir)
	if err := w.watcher.Add(dir); err != nil {
		log.Printf("[jsonl-watcher] WatchSession failed to add dir %s: %v", dir, err)
	}

	// Also watch for subagent directory
	sessionUUID := strings.TrimSuffix(filepath.Base(jsonlPath), ".jsonl")
	subagentDir := filepath.Join(dir, sessionUUID, "subagents")
	if info, err := os.Stat(subagentDir); err == nil && info.IsDir() {
		w.watcher.Add(subagentDir)
	}
}

func (w *JSONLWatcher) Stop() {
	close(w.stopCh)
	w.watcher.Close()
}
