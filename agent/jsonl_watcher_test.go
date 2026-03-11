// agent/jsonl_watcher_test.go
package main

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestIncrementalReader_ReadsNewLines(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "test.jsonl")

	// Write initial content
	f, _ := os.Create(path)
	f.WriteString(`{"type":"assistant","requestId":"r1","model":"claude-opus-4-6","message":{"role":"assistant","content":[{"type":"thinking","thinking":"hmm"}]},"usage":{"input_tokens":100,"output_tokens":10,"cache_creation_input_tokens":0,"cache_read_input_tokens":0}}` + "\n")
	f.Close()

	reader := newIncrementalReader(path)
	entries, err := reader.ReadNew()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(entries) != 1 {
		t.Fatalf("expected 1 entry, got %d", len(entries))
	}
	if entries[0].Type != "assistant" {
		t.Errorf("expected assistant, got %s", entries[0].Type)
	}

	// Append more content
	f, _ = os.OpenFile(path, os.O_APPEND|os.O_WRONLY, 0644)
	f.WriteString(`{"type":"summary","isCompactSummary":true}` + "\n")
	f.Close()

	entries, err = reader.ReadNew()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(entries) != 1 {
		t.Fatalf("expected 1 new entry, got %d", len(entries))
	}
	if entries[0].Type != "summary" {
		t.Errorf("expected summary, got %s", entries[0].Type)
	}
}

func TestIncrementalReader_HandlesPartialLine(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "test.jsonl")

	// Write partial line (no newline at end)
	f, _ := os.Create(path)
	f.WriteString(`{"type":"assis`)
	f.Close()

	reader := newIncrementalReader(path)
	entries, err := reader.ReadNew()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(entries) != 0 {
		t.Fatalf("expected 0 entries for partial line, got %d", len(entries))
	}

	// Complete the line
	f, _ = os.OpenFile(path, os.O_APPEND|os.O_WRONLY, 0644)
	f.WriteString(`tant","requestId":"r1","model":"m","message":{"role":"assistant","content":[]},"usage":{"input_tokens":0,"output_tokens":0,"cache_creation_input_tokens":0,"cache_read_input_tokens":0}}` + "\n")
	f.Close()

	entries, err = reader.ReadNew()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(entries) != 1 {
		t.Fatalf("expected 1 entry after completing line, got %d", len(entries))
	}
}

func TestIncrementalReader_HandlesTruncation(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "test.jsonl")

	f, _ := os.Create(path)
	f.WriteString(`{"type":"assistant","requestId":"r1","model":"claude-opus-4-6","message":{"role":"assistant","content":[{"type":"text","text":"hello world"}]},"usage":{"input_tokens":100,"output_tokens":10,"cache_creation_input_tokens":0,"cache_read_input_tokens":0}}` + "\n")
	f.WriteString(`{"type":"assistant","requestId":"r2","model":"claude-opus-4-6","message":{"role":"assistant","content":[{"type":"text","text":"hello again"}]},"usage":{"input_tokens":200,"output_tokens":20,"cache_creation_input_tokens":0,"cache_read_input_tokens":0}}` + "\n")
	f.Close()

	reader := newIncrementalReader(path)
	reader.ReadNew() // read initial

	// Truncate file with shorter content (simulate rotation)
	os.WriteFile(path, []byte(`{"type":"summary","isCompactSummary":true}`+"\n"), 0644)

	entries, err := reader.ReadNew()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(entries) != 1 {
		t.Fatalf("expected 1 entry after truncation, got %d", len(entries))
	}
	if entries[0].Type != "summary" {
		t.Errorf("expected summary, got %s", entries[0].Type)
	}
}

func TestJSONLWatcher_DetectsNewFile(t *testing.T) {
	dir := t.TempDir()

	eventCh := make(chan []JSONLEvent, 10)
	// Errata E12: no dir parameter
	w, err := newJSONLWatcher(func(events []JSONLEvent) {
		eventCh <- events
	})
	if err != nil {
		t.Fatalf("failed to create watcher: %v", err)
	}
	defer w.Stop()

	// Add dir via WatchSession (Errata E12)
	jsonlPath := filepath.Join(dir, "test-uuid.jsonl")
	w.WatchSession(jsonlPath)

	// Give watcher time to register the directory
	time.Sleep(100 * time.Millisecond)

	// Create a JSONL file
	f, _ := os.Create(jsonlPath)
	f.WriteString(`{"type":"assistant","requestId":"r1","model":"claude-opus-4-6","message":{"role":"assistant","content":[{"type":"text","text":"hi"}]},"usage":{"input_tokens":100,"output_tokens":10,"cache_creation_input_tokens":0,"cache_read_input_tokens":0}}` + "\n")
	f.Close()

	// Wait for event
	select {
	case events := <-eventCh:
		if len(events) == 0 {
			t.Fatal("expected events")
		}
	case <-time.After(3 * time.Second):
		t.Fatal("timeout waiting for file event")
	}
}
