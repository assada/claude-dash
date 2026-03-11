// agent/jsonl_parser_test.go
package main

import (
	"testing"
)

func TestParseJSONLEntry_AssistantWithToolUse(t *testing.T) {
	line := `{"type":"assistant","requestId":"req_1","model":"claude-opus-4-6","message":{"role":"assistant","content":[{"type":"tool_use","id":"toolu_1","name":"Read","input":{"file_path":"/src/main.go"}}]},"usage":{"input_tokens":1000,"output_tokens":200,"cache_creation_input_tokens":50,"cache_read_input_tokens":500}}`

	entry, err := parseJSONLLine([]byte(line))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if entry.Type != "assistant" {
		t.Errorf("expected type assistant, got %s", entry.Type)
	}
	if entry.RequestID != "req_1" {
		t.Errorf("expected requestId req_1, got %s", entry.RequestID)
	}
	if entry.Model != "claude-opus-4-6" {
		t.Errorf("expected model claude-opus-4-6, got %s", entry.Model)
	}
	if entry.Usage.InputTokens != 1000 {
		t.Errorf("expected input_tokens 1000, got %d", entry.Usage.InputTokens)
	}
	if len(entry.ContentBlocks) != 1 {
		t.Fatalf("expected 1 content block, got %d", len(entry.ContentBlocks))
	}
	if entry.ContentBlocks[0].Type != "tool_use" {
		t.Errorf("expected tool_use block, got %s", entry.ContentBlocks[0].Type)
	}
	if entry.ContentBlocks[0].Name != "Read" {
		t.Errorf("expected tool name Read, got %s", entry.ContentBlocks[0].Name)
	}
}

func TestParseJSONLEntry_UserToolResult(t *testing.T) {
	line := `{"type":"user","isMeta":true,"message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_1","content":"file contents","is_error":false}]}}`

	entry, err := parseJSONLLine([]byte(line))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if entry.Type != "user" {
		t.Errorf("expected type user, got %s", entry.Type)
	}
	if !entry.IsMeta {
		t.Error("expected isMeta true")
	}
	if len(entry.ContentBlocks) != 1 {
		t.Fatalf("expected 1 content block, got %d", len(entry.ContentBlocks))
	}
	if entry.ContentBlocks[0].IsError {
		t.Error("expected is_error false")
	}
}

func TestParseJSONLEntry_UserToolResultWithError(t *testing.T) {
	line := `{"type":"user","isMeta":true,"message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_2","content":"command failed: exit code 1","is_error":true}]}}`

	entry, err := parseJSONLLine([]byte(line))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !entry.ContentBlocks[0].IsError {
		t.Error("expected is_error true")
	}
}

func TestParseJSONLEntry_Summary(t *testing.T) {
	line := `{"type":"summary","summary":"conversation summary","isCompactSummary":true}`

	entry, err := parseJSONLLine([]byte(line))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if entry.Type != "summary" {
		t.Errorf("expected type summary, got %s", entry.Type)
	}
	if !entry.IsCompactSummary {
		t.Error("expected isCompactSummary true")
	}
}

func TestParseJSONLEntry_ThinkingBlock(t *testing.T) {
	line := `{"type":"assistant","requestId":"req_2","model":"claude-opus-4-6","message":{"role":"assistant","content":[{"type":"thinking","thinking":"Let me analyze..."}]},"usage":{"input_tokens":500,"output_tokens":100,"cache_creation_input_tokens":0,"cache_read_input_tokens":0}}`

	entry, err := parseJSONLLine([]byte(line))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if entry.ContentBlocks[0].Type != "thinking" {
		t.Errorf("expected thinking block, got %s", entry.ContentBlocks[0].Type)
	}
}

func TestParseJSONLEntry_TextBlock(t *testing.T) {
	line := `{"type":"assistant","requestId":"req_3","model":"claude-opus-4-6","message":{"role":"assistant","content":[{"type":"text","text":"Here is the answer."}]},"usage":{"input_tokens":600,"output_tokens":50,"cache_creation_input_tokens":0,"cache_read_input_tokens":0}}`

	entry, err := parseJSONLLine([]byte(line))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if entry.ContentBlocks[0].Type != "text" {
		t.Errorf("expected text block, got %s", entry.ContentBlocks[0].Type)
	}
}

func TestParseJSONLEntry_MalformedJSON(t *testing.T) {
	line := `{broken json`
	_, err := parseJSONLLine([]byte(line))
	if err == nil {
		t.Error("expected error for malformed JSON")
	}
}

func TestParseJSONLEntry_SystemEntry(t *testing.T) {
	line := `{"type":"system","turnDurationMs":12345}`
	entry, err := parseJSONLLine([]byte(line))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if entry.Type != "system" {
		t.Errorf("expected type system, got %s", entry.Type)
	}
}

func TestDeduplicator_KeepsLatest(t *testing.T) {
	d := newDeduplicator()

	e1 := &JSONLEntry{RequestID: "req_1", Usage: UsageData{InputTokens: 100, OutputTokens: 10}}
	e2 := &JSONLEntry{RequestID: "req_1", Usage: UsageData{InputTokens: 100, OutputTokens: 50}}
	e3 := &JSONLEntry{RequestID: "req_2", Usage: UsageData{InputTokens: 200, OutputTokens: 30}}

	d.Add(e1)
	d.Add(e2) // replaces e1 (same requestId)
	d.Add(e3)

	input, output, _, _ := d.SessionTotals()
	// req_1: 100+200=300 input, 50+30=80 output
	if input != 300 {
		t.Errorf("expected input 300, got %d", input)
	}
	if output != 80 {
		t.Errorf("expected output 80, got %d", output)
	}
}

func TestDeduplicator_ContextTokens(t *testing.T) {
	d := newDeduplicator()

	e1 := &JSONLEntry{RequestID: "req_1", Usage: UsageData{InputTokens: 50000}}
	e2 := &JSONLEntry{RequestID: "req_2", Usage: UsageData{
		InputTokens:              3,
		CacheReadInputTokens:     10000,
		CacheCreationInputTokens: 13000,
	}}

	d.Add(e1)
	d.Add(e2)

	ctx := d.ContextTokens()
	// Context = input + cache_read + cache_creation from last entry
	if ctx != 23003 {
		t.Errorf("expected context tokens 23003, got %d", ctx)
	}
}
