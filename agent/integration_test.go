package main

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestFullFlow_JSONLWriteToStateDetection(t *testing.T) {
	dir := t.TempDir()

	sm := newSessionMap()
	sm.Set("cc-test-session", "test-uuid", "/tmp/project")

	encodedDir := filepath.Join(dir, encodeWorkdir("/tmp/project"))
	os.MkdirAll(encodedDir, 0755)
	jsonlPath := filepath.Join(encodedDir, "test-uuid.jsonl")

	var receivedEvents []JSONLEvent
	eventCh := make(chan struct{}, 10)

	w, err := newJSONLWatcher(func(events []JSONLEvent) {
		receivedEvents = append(receivedEvents, events...)
		eventCh <- struct{}{}
	})
	if err != nil {
		t.Fatalf("watcher error: %v", err)
	}
	defer w.Stop()
	w.WatchSession(jsonlPath)

	// Give watcher time to register the directory
	time.Sleep(100 * time.Millisecond)

	// Write thinking entry (should = working)
	f, _ := os.Create(jsonlPath)
	f.WriteString(`{"type":"assistant","requestId":"r1","model":"claude-opus-4-6","message":{"role":"assistant","content":[{"type":"thinking","thinking":"analyzing..."}]},"usage":{"input_tokens":50000,"output_tokens":100,"cache_creation_input_tokens":0,"cache_read_input_tokens":0}}` + "\n")
	f.Close()

	select {
	case <-eventCh:
	case <-time.After(3 * time.Second):
		t.Fatal("timeout waiting for event")
	}

	if len(receivedEvents) == 0 {
		t.Fatal("no events received")
	}

	entries := make([]*JSONLEntry, len(receivedEvents))
	for i, e := range receivedEvents {
		entries[i] = e.Entry
	}
	state := detectJSONLState(entries)
	if state != StateWorking {
		t.Errorf("expected working state, got %s", state)
	}

	if entries[0].Model != "claude-opus-4-6" {
		t.Errorf("expected opus-4-6 model, got %s", entries[0].Model)
	}
	if entries[0].Usage.InputTokens != 50000 {
		t.Errorf("expected 50000 input tokens, got %d", entries[0].Usage.InputTokens)
	}
}
