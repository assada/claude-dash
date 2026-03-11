# v2.0.0 JSONL-Powered Observability — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add JSONL-based session monitoring to the Go agent and Context Window Tracker UI to the dashboard, replacing regex-based state detection with activity analysis.

**Architecture:** Go agent gains a JSONL file watcher that incrementally parses Claude Code's session logs, extracts state/context/activity data, and sends it via new WS message types. Dashboard receives, persists snapshots, and renders a sub-header strip with context bar + hover tooltip. Tmux stays for terminal I/O only.

**Tech Stack:** Go 1.25 + fsnotify, Next.js 16 + React 19 + Tailwind 4 + Framer Motion 12, PostgreSQL + Prisma

**Spec:** `docs/superpowers/specs/2026-03-11-v2-jsonl-observability-design.md`

---

## Chunk 0: Branch & CI Setup

### Task 0.1: Create release/v2 branch

**Files:**
- Create: `.github/workflows/ci-v2.yml`

- [ ] **Step 1: Create and push release/v2 branch**

```bash
git checkout master
git checkout -b release/v2
git push -u origin release/v2
```

- [ ] **Step 2: Create CI workflow for release/v2**

```yaml
# .github/workflows/ci-v2.yml
name: CI v2

on:
  push:
    branches: [release/v2]

jobs:
  build-agent:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with:
          go-version: '1.24'
      - name: Test
        working-directory: agent
        run: go test ./...
      - name: Build
        working-directory: agent
        env:
          GOOS: linux
          GOARCH: amd64
          CGO_ENABLED: 0
        run: go build -ldflags "-s -w -X main.version=v2-dev" -o ccdash-agent .

  build-dashboard:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - name: Build (no push)
        uses: docker/build-push-action@v6
        with:
          context: ./dashboard
          push: false
          build-args: AGENT_VERSION=v2-dev
          cache-from: type=gha
          cache-to: type=gha,mode=max
```

- [ ] **Step 3: Commit and push**

```bash
git add .github/workflows/ci-v2.yml
git commit -m "ci: add CI workflow for release/v2 branch"
git push
```

---

## Chunk 1: Agent — JSONL Parser & Session Mapping

### Task 1.1: Add fsnotify dependency

**Files:**
- Modify: `agent/go.mod`

- [ ] **Step 1: Add fsnotify**

```bash
cd agent && go get github.com/fsnotify/fsnotify@latest
```

- [ ] **Step 2: Add uuid library**

```bash
go get github.com/google/uuid@latest
```

- [ ] **Step 3: Verify**

```bash
go mod tidy && cat go.mod
```

Expected: `github.com/fsnotify/fsnotify` and `github.com/google/uuid` in require block.

- [ ] **Step 4: Commit**

```bash
git add go.mod go.sum
git commit -m "deps: add fsnotify and uuid libraries for v2 JSONL watcher"
```

### Task 1.2: JSONL entry types and parser

**Files:**
- Create: `agent/jsonl_parser.go`
- Create: `agent/jsonl_parser_test.go`

- [ ] **Step 1: Write tests for JSONL parsing**

```go
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
	e2 := &JSONLEntry{RequestID: "req_2", Usage: UsageData{InputTokens: 80000}}

	d.Add(e1)
	d.Add(e2)

	ctx := d.ContextTokens()
	// Should be the input_tokens from the LAST added entry (most recent API call)
	if ctx != 80000 {
		t.Errorf("expected context tokens 80000, got %d", ctx)
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd agent && go test -v -run TestParse ./...
```

Expected: compilation error — `parseJSONLLine`, `JSONLEntry`, `newDeduplicator` not defined.

- [ ] **Step 3: Implement JSONL parser**

```go
// agent/jsonl_parser.go
package main

import (
	"encoding/json"
	"strings"
)

// JSONLEntry represents a parsed line from Claude Code's JSONL session log.
type JSONLEntry struct {
	Type              string         `json:"type"` // "assistant", "user", "summary", "system"
	SessionID         string         `json:"sessionId"`
	RequestID         string         `json:"requestId"`
	Model             string         `json:"model"`
	CWD               string         `json:"cwd"`
	IsMeta            bool           `json:"isMeta"`
	IsCompactSummary  bool           `json:"isCompactSummary"`
	Usage             UsageData      `json:"usage"`
	ContentBlocks     []ContentBlock // extracted from message.content
	ToolUseResult     string         `json:"-"` // extracted from user meta content
}

type UsageData struct {
	InputTokens              int `json:"input_tokens"`
	OutputTokens             int `json:"output_tokens"`
	CacheCreationInputTokens int `json:"cache_creation_input_tokens"`
	CacheReadInputTokens     int `json:"cache_read_input_tokens"`
}

type ContentBlock struct {
	Type      string                 `json:"type"` // "text", "thinking", "tool_use", "tool_result"
	Text      string                 `json:"text,omitempty"`
	Thinking  string                 `json:"thinking,omitempty"`
	Name      string                 `json:"name,omitempty"`      // tool name
	ID        string                 `json:"id,omitempty"`        // tool_use id
	ToolUseID string                 `json:"tool_use_id,omitempty"`
	Content   string                 `json:"-"`                    // tool_result content (string or extracted)
	IsError   bool                   `json:"is_error,omitempty"`
	Input     map[string]interface{} `json:"input,omitempty"` // tool_use input params
}

// rawJSONLEntry is the raw JSON structure for intermediate parsing.
type rawJSONLEntry struct {
	Type             string          `json:"type"`
	SessionID        string          `json:"sessionId"`
	RequestID        string          `json:"requestId"`
	Model            string          `json:"model"`
	CWD              string          `json:"cwd"`
	IsMeta           bool            `json:"isMeta"`
	IsCompactSummary bool            `json:"isCompactSummary"`
	Usage            UsageData       `json:"usage"`
	Message          json.RawMessage `json:"message"`
}

type rawMessage struct {
	Role    string            `json:"role"`
	Content json.RawMessage   `json:"content"`
}

func parseJSONLLine(line []byte) (*JSONLEntry, error) {
	var raw rawJSONLEntry
	if err := json.Unmarshal(line, &raw); err != nil {
		return nil, err
	}

	entry := &JSONLEntry{
		Type:             raw.Type,
		SessionID:        raw.SessionID,
		RequestID:        raw.RequestID,
		Model:            raw.Model,
		CWD:              raw.CWD,
		IsMeta:           raw.IsMeta,
		IsCompactSummary: raw.IsCompactSummary,
		Usage:            raw.Usage,
	}

	if len(raw.Message) == 0 {
		return entry, nil
	}

	var msg rawMessage
	if err := json.Unmarshal(raw.Message, &msg); err != nil {
		return entry, nil // non-fatal: entry without parseable message
	}

	if len(msg.Content) == 0 {
		return entry, nil
	}

	// Content can be a string (user message) or array (content blocks)
	var blocks []ContentBlock
	if err := json.Unmarshal(msg.Content, &blocks); err != nil {
		// Try as string (plain user message)
		var s string
		if err2 := json.Unmarshal(msg.Content, &s); err2 == nil {
			blocks = []ContentBlock{{Type: "text", Text: s}}
		}
	}

	// Extract string content from tool_result blocks (can be string or array)
	for i := range blocks {
		if blocks[i].Type == "tool_result" {
			// Re-parse to get content which might be string
			extractToolResultContent(&blocks[i], msg.Content, i)
		}
	}

	entry.ContentBlocks = blocks
	return entry, nil
}

func extractToolResultContent(block *ContentBlock, rawContent json.RawMessage, idx int) {
	// Parse the array to get the raw tool_result object
	var rawBlocks []json.RawMessage
	if err := json.Unmarshal(rawContent, &rawBlocks); err != nil || idx >= len(rawBlocks) {
		return
	}
	var rawBlock struct {
		Content json.RawMessage `json:"content"`
	}
	if err := json.Unmarshal(rawBlocks[idx], &rawBlock); err != nil {
		return
	}
	// Content can be a string
	var s string
	if err := json.Unmarshal(rawBlock.Content, &s); err == nil {
		block.Content = s
		return
	}
	// Or a text content block array
	var textBlocks []struct {
		Type string `json:"type"`
		Text string `json:"text"`
	}
	if err := json.Unmarshal(rawBlock.Content, &textBlocks); err == nil {
		var parts []string
		for _, tb := range textBlocks {
			if tb.Text != "" {
				parts = append(parts, tb.Text)
			}
		}
		block.Content = strings.Join(parts, "\n")
	}
}

// Deduplicator keeps only the last entry per requestId for accurate token counts.
type Deduplicator struct {
	lastByRequestID map[string]*JSONLEntry
	order           []string // insertion order of requestIds
}

func newDeduplicator() *Deduplicator {
	return &Deduplicator{
		lastByRequestID: make(map[string]*JSONLEntry),
	}
}

func (d *Deduplicator) Add(entry *JSONLEntry) {
	if entry.RequestID == "" {
		return
	}
	if _, exists := d.lastByRequestID[entry.RequestID]; !exists {
		d.order = append(d.order, entry.RequestID)
	}
	d.lastByRequestID[entry.RequestID] = entry
}

func (d *Deduplicator) SessionTotals() (input, output, cacheRead, cacheCreate int) {
	for _, e := range d.lastByRequestID {
		input += e.Usage.InputTokens
		output += e.Usage.OutputTokens
		cacheRead += e.Usage.CacheReadInputTokens
		cacheCreate += e.Usage.CacheCreationInputTokens
	}
	return
}

// ContextTokens returns input_tokens from the most recent API call.
func (d *Deduplicator) ContextTokens() int {
	if len(d.order) == 0 {
		return 0
	}
	lastReqID := d.order[len(d.order)-1]
	return d.lastByRequestID[lastReqID].Usage.InputTokens
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd agent && go test -v -run "TestParse|TestDedup" ./...
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add agent/jsonl_parser.go agent/jsonl_parser_test.go
git commit -m "feat(agent): add JSONL parser with entry types and deduplicator"
```

### Task 1.3: Activity-based state detection

**Files:**
- Create: `agent/jsonl_state.go`
- Create: `agent/jsonl_state_test.go`

- [ ] **Step 1: Write tests for state detection and activity derivation**

```go
// agent/jsonl_state_test.go
package main

import (
	"testing"
)

func TestDetectJSONLState_WorkingOnToolUse(t *testing.T) {
	entries := []*JSONLEntry{
		{Type: "assistant", ContentBlocks: []ContentBlock{{Type: "tool_use", Name: "Read", Input: map[string]interface{}{"file_path": "/src/main.go"}}}},
	}
	state := detectJSONLState(entries)
	if state != StateWorking {
		t.Errorf("expected working, got %s", state)
	}
}

func TestDetectJSONLState_WorkingOnThinking(t *testing.T) {
	entries := []*JSONLEntry{
		{Type: "assistant", ContentBlocks: []ContentBlock{{Type: "thinking", Thinking: "Let me think..."}}},
	}
	state := detectJSONLState(entries)
	if state != StateWorking {
		t.Errorf("expected working, got %s", state)
	}
}

func TestDetectJSONLState_IdleAfterTextOutput(t *testing.T) {
	entries := []*JSONLEntry{
		{Type: "assistant", ContentBlocks: []ContentBlock{{Type: "tool_use", Name: "Read"}}},
		{Type: "user", IsMeta: true, ContentBlocks: []ContentBlock{{Type: "tool_result"}}},
		{Type: "assistant", ContentBlocks: []ContentBlock{{Type: "text", Text: "Done."}}},
	}
	state := detectJSONLState(entries)
	if state != StateIdle {
		t.Errorf("expected idle, got %s", state)
	}
}

func TestDetectJSONLState_WorkingToolUseAfterText(t *testing.T) {
	entries := []*JSONLEntry{
		{Type: "assistant", ContentBlocks: []ContentBlock{{Type: "text", Text: "Let me check..."}}},
		{Type: "assistant", ContentBlocks: []ContentBlock{{Type: "tool_use", Name: "Bash"}}},
	}
	state := detectJSONLState(entries)
	if state != StateWorking {
		t.Errorf("expected working, got %s", state)
	}
}

func TestDetectJSONLState_IdleOnUserRejection(t *testing.T) {
	entries := []*JSONLEntry{
		{Type: "assistant", ContentBlocks: []ContentBlock{{Type: "tool_use", Name: "Bash"}}},
		{Type: "user", IsMeta: true, ContentBlocks: []ContentBlock{{Type: "tool_result", Content: "User rejected tool use"}}},
	}
	state := detectJSONLState(entries)
	if state != StateIdle {
		t.Errorf("expected idle, got %s", state)
	}
}

func TestDetectJSONLState_IdleOnExitPlanMode(t *testing.T) {
	entries := []*JSONLEntry{
		{Type: "assistant", ContentBlocks: []ContentBlock{{Type: "tool_use", Name: "ExitPlanMode"}}},
	}
	state := detectJSONLState(entries)
	if state != StateIdle {
		t.Errorf("expected idle, got %s", state)
	}
}

func TestDetectJSONLState_EmptyEntries(t *testing.T) {
	state := detectJSONLState(nil)
	if state != "" {
		t.Errorf("expected empty state, got %s", state)
	}
}

func TestDeriveActivity_ReadTool(t *testing.T) {
	block := ContentBlock{Type: "tool_use", Name: "Read", Input: map[string]interface{}{"file_path": "/src/lib/agent.ts"}}
	activity, toolName := deriveActivity(block)
	if activity != "Reading src/lib/agent.ts" {
		t.Errorf("unexpected activity: %s", activity)
	}
	if toolName != "Read" {
		t.Errorf("unexpected tool: %s", toolName)
	}
}

func TestDeriveActivity_BashTool(t *testing.T) {
	block := ContentBlock{Type: "tool_use", Name: "Bash", Input: map[string]interface{}{"command": "npm run test -- --watch"}}
	activity, _ := deriveActivity(block)
	if activity != "Running npm run test -- --watch" {
		t.Errorf("unexpected activity: %s", activity)
	}
}

func TestDeriveActivity_EditTool(t *testing.T) {
	block := ContentBlock{Type: "tool_use", Name: "Edit", Input: map[string]interface{}{"file_path": "/src/components/App.tsx"}}
	activity, _ := deriveActivity(block)
	if activity != "Editing src/components/App.tsx" {
		t.Errorf("unexpected activity: %s", activity)
	}
}

func TestDeriveActivity_Thinking(t *testing.T) {
	block := ContentBlock{Type: "thinking"}
	activity, toolName := deriveActivity(block)
	if activity != "Thinking..." {
		t.Errorf("unexpected activity: %s", activity)
	}
	if toolName != "" {
		t.Errorf("expected empty tool name, got %s", toolName)
	}
}

func TestDeriveActivity_TaskTool(t *testing.T) {
	block := ContentBlock{Type: "tool_use", Name: "Task"}
	activity, _ := deriveActivity(block)
	if activity != "Running subagent" {
		t.Errorf("unexpected activity: %s", activity)
	}
}

func TestDeriveActivity_AgentTool(t *testing.T) {
	block := ContentBlock{Type: "tool_use", Name: "Agent"}
	activity, _ := deriveActivity(block)
	if activity != "Running subagent" {
		t.Errorf("unexpected activity: %s", activity)
	}
}

func TestDeriveActivity_UnknownTool(t *testing.T) {
	block := ContentBlock{Type: "tool_use", Name: "CustomTool"}
	activity, _ := deriveActivity(block)
	if activity != "Using CustomTool" {
		t.Errorf("unexpected activity: %s", activity)
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd agent && go test -v -run "TestDetect|TestDerive" ./...
```

Expected: compilation error — functions not defined.

- [ ] **Step 3: Implement state detection and activity derivation**

```go
// agent/jsonl_state.go
package main

import (
	"fmt"
	"path/filepath"
	"strings"
)

// detectJSONLState analyzes JSONL entries to determine session state.
// Returns StateWorking, StateIdle, or "" (unknown/no data).
func detectJSONLState(entries []*JSONLEntry) SessionState {
	if len(entries) == 0 {
		return ""
	}

	// Walk entries tracking last ending event and last ongoing event positions
	lastEndingIdx := -1
	lastOngoingIdx := -1

	for i, entry := range entries {
		for _, block := range entry.ContentBlocks {
			classification := classifyBlock(entry, block)
			switch classification {
			case "ending":
				lastEndingIdx = i
			case "ongoing":
				lastOngoingIdx = i
			}
		}
	}

	if lastOngoingIdx > lastEndingIdx {
		return StateWorking
	}
	if lastEndingIdx >= 0 {
		return StateIdle
	}
	// No recognizable events
	return ""
}

func classifyBlock(entry *JSONLEntry, block ContentBlock) string {
	switch block.Type {
	case "text":
		if entry.Type == "assistant" {
			return "ending"
		}
	case "thinking":
		return "ongoing"
	case "tool_use":
		if block.Name == "ExitPlanMode" {
			return "ending"
		}
		return "ongoing"
	case "tool_result":
		if block.Content == "User rejected tool use" {
			return "ending"
		}
		return "ongoing"
	}
	return ""
}

// deriveActivity returns a human-readable activity string and tool name
// from the most recent content block.
func deriveActivity(block ContentBlock) (activity string, toolName string) {
	switch block.Type {
	case "thinking":
		return "Thinking...", ""
	case "text":
		return "", ""
	case "tool_use":
		toolName = block.Name
		activity = toolActivity(block)
		return
	default:
		return "", ""
	}
}

func toolActivity(block ContentBlock) string {
	getStr := func(key string) string {
		if v, ok := block.Input[key]; ok {
			if s, ok := v.(string); ok {
				return s
			}
		}
		return ""
	}

	switch block.Name {
	case "Read":
		return "Reading " + shortenPath(getStr("file_path"))
	case "Edit", "MultiEdit":
		return "Editing " + shortenPath(getStr("file_path"))
	case "Write":
		return "Writing " + shortenPath(getStr("file_path"))
	case "Bash":
		cmd := getStr("command")
		if len(cmd) > 40 {
			cmd = cmd[:40]
		}
		return "Running " + cmd
	case "Glob":
		return "Searching " + truncateStr(getStr("pattern"), 40)
	case "Grep":
		return "Searching for " + truncateStr(getStr("pattern"), 30)
	case "Agent", "Task":
		return "Running subagent"
	case "WebFetch":
		return "Fetching " + truncateStr(getStr("url"), 40)
	case "WebSearch":
		return "Searching web"
	case "TodoWrite":
		return "Updating todos"
	case "TodoRead":
		return "Reading todos"
	default:
		return fmt.Sprintf("Using %s", block.Name)
	}
}

func shortenPath(p string) string {
	if p == "" {
		return ""
	}
	// Remove leading / and common prefixes
	p = strings.TrimPrefix(p, "/")
	// If the path is long, show only last 2 components
	parts := strings.Split(p, "/")
	if len(parts) > 2 {
		return strings.Join(parts[len(parts)-2:], "/")
	}
	return filepath.Base(p)
}

func truncateStr(s string, max int) string {
	if len(s) <= max {
		return s
	}
	return s[:max]
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd agent && go test -v -run "TestDetect|TestDerive" ./...
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add agent/jsonl_state.go agent/jsonl_state_test.go
git commit -m "feat(agent): add JSONL activity-based state detection and activity derivation"
```

### Task 1.4: Session mapping and path encoding

**Files:**
- Create: `agent/session_map.go`
- Create: `agent/session_map_test.go`

- [ ] **Step 1: Write tests**

```go
// agent/session_map_test.go
package main

import (
	"testing"
)

func TestEncodeWorkdir(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"/Users/me/projects/cp", "-Users-me-projects-cp"},
		{"/home/user/work", "-home-user-work"},
		{"/opt/app", "-opt-app"},
	}
	for _, tc := range tests {
		result := encodeWorkdir(tc.input)
		if result != tc.expected {
			t.Errorf("encodeWorkdir(%q) = %q, want %q", tc.input, result, tc.expected)
		}
	}
}

func TestSessionMap_StoreAndRetrieve(t *testing.T) {
	sm := newSessionMap()
	sm.Set("cc-123-proj", "a1b2c3d4-uuid", "/home/user/proj")

	uuid, workdir, ok := sm.Get("cc-123-proj")
	if !ok {
		t.Fatal("expected to find mapping")
	}
	if uuid != "a1b2c3d4-uuid" {
		t.Errorf("expected uuid a1b2c3d4-uuid, got %s", uuid)
	}
	if workdir != "/home/user/proj" {
		t.Errorf("expected workdir /home/user/proj, got %s", workdir)
	}
}

func TestSessionMap_JSONLPath(t *testing.T) {
	sm := newSessionMap()
	sm.Set("cc-123-proj", "a1b2c3d4-uuid", "/Users/me/projects/cp")

	path := sm.JSONLPath("cc-123-proj", "/Users/me")
	expected := "/Users/me/.claude/projects/-Users-me-projects-cp/a1b2c3d4-uuid.jsonl"
	if path != expected {
		t.Errorf("expected %s, got %s", expected, path)
	}
}

func TestSessionMap_NotFound(t *testing.T) {
	sm := newSessionMap()
	_, _, ok := sm.Get("nonexistent")
	if ok {
		t.Error("expected not found")
	}
}

func TestSessionMap_Delete(t *testing.T) {
	sm := newSessionMap()
	sm.Set("cc-123-proj", "uuid", "/work")
	sm.Delete("cc-123-proj")
	_, _, ok := sm.Get("cc-123-proj")
	if ok {
		t.Error("expected not found after delete")
	}
}

func TestModelContextLimit(t *testing.T) {
	if getContextLimit("claude-opus-4-6") != 1_000_000 {
		t.Error("opus-4-6 should be 1M")
	}
	if getContextLimit("claude-sonnet-4-5") != 200_000 {
		t.Error("sonnet-4-5 should be 200k")
	}
	if getContextLimit("unknown-model") != 200_000 {
		t.Error("unknown should default to 200k")
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd agent && go test -v -run "TestEncode|TestSession|TestModel" ./...
```

- [ ] **Step 3: Implement session map**

```go
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

// encodeWorkdir converts a workdir path to Claude Code's encoded format.
// /Users/me/projects/cp → -Users-me-projects-cp
func encodeWorkdir(workdir string) string {
	return strings.ReplaceAll(workdir, "/", "-")
}

// Model context limits
var modelContextLimits = map[string]int{
	"claude-opus-4-6":   1_000_000,
	"claude-opus-4-5":   200_000,
	"claude-sonnet-4-6": 1_000_000,
	"claude-sonnet-4-5": 200_000,
	"claude-sonnet-4":   200_000,
	"claude-haiku-4-5":  200_000,
	"claude-haiku-3-5":  200_000,
}

func getContextLimit(model string) int {
	// Try exact match first
	if limit, ok := modelContextLimits[model]; ok {
		return limit
	}
	// Try prefix matching (handles versions like claude-opus-4-6[1m])
	for name, limit := range modelContextLimits {
		if strings.HasPrefix(model, name) {
			return limit
		}
	}
	return 200_000
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd agent && go test -v -run "TestEncode|TestSession|TestModel" ./...
```

- [ ] **Step 5: Commit**

```bash
git add agent/session_map.go agent/session_map_test.go
git commit -m "feat(agent): add session mapping (tmux ↔ claude UUID) and path encoding"
```

### Task 1.5: Modify createTmuxSession to use --session-id

**Files:**
- Modify: `agent/tmux.go:26-76`
- Modify: `agent/server.go` (call site and ServerMessage)

- [ ] **Step 1: Update createTmuxSession signature and implementation**

In `agent/tmux.go`, change the function to generate UUID and pass `--session-id`:

```go
// Replace the entire createTmuxSession function
func createTmuxSession(name, workdir string, historyLimit int, dangerouslySkipPermissions bool) (sessionID string, claudeUUID string, err error) {
	sessionID = fmt.Sprintf("cc-%d-%s", time.Now().UnixMilli(), sanitizeName(name))
	claudeUUID = uuid.New().String()

	cmd := exec.Command("tmux", "new-session", "-d",
		"-s", sessionID,
		"-c", workdir,
		"-x", "200",
		"-y", "50",
	)
	if out, err := cmd.CombinedOutput(); err != nil {
		return "", "", fmt.Errorf("tmux new-session: %s: %w", string(out), err)
	}

	opts := map[string]string{
		"history-limit":      fmt.Sprintf("%d", historyLimit),
		"mouse":              "on",
		"status":             "off",
		"escape-time":        "0",
		"focus-events":       "on",
		"default-terminal":   "xterm-256color",
		"set-clipboard":      "on",
		"exit-unattached":    "off",
		"destroy-unattached": "off",
		"allow-passthrough":  "on",
		"extended-keys":      "on",
		"visual-activity":    "off",
		"visual-bell":        "off",
		"visual-silence":     "off",
	}
	for k, v := range opts {
		cmd = exec.Command("tmux", "set-option", "-t", sessionID, k, v)
		if out, err := cmd.CombinedOutput(); err != nil {
			log.Printf("tmux set-option %s: %s", k, strings.TrimSpace(string(out)))
		}
	}

	claudeCmd := fmt.Sprintf("claude --session-id %s", claudeUUID)
	if dangerouslySkipPermissions {
		claudeCmd += " --dangerously-skip-permissions"
	}
	cmd = exec.Command("tmux", "send-keys", "-t", sessionID, claudeCmd, "Enter")
	if out, err := cmd.CombinedOutput(); err != nil {
		return "", "", fmt.Errorf("tmux send-keys: %s: %w", string(out), err)
	}

	return sessionID, claudeUUID, nil
}
```

- [ ] **Step 2: Add uuid import to tmux.go**

Add `"github.com/google/uuid"` to the import block in `tmux.go`.

- [ ] **Step 3: Update ServerMessage struct in server.go**

Add `ClaudeSessionID` field:

```go
// In ServerMessage struct, add after Name field:
ClaudeSessionID string `json:"claude_session_id,omitempty"`
```

- [ ] **Step 4: Update create_session handler in server.go**

Find the `case "create_session":` block and update to handle new return values and store mapping:

The call site needs to receive `claudeUUID` and include it in the response message, plus register the mapping with the session map. (The session map will be wired in Task 2.1.)

- [ ] **Step 5: Run build to verify compilation**

```bash
cd agent && go build ./...
```

Expected: compiles successfully.

- [ ] **Step 6: Commit**

```bash
git add agent/tmux.go agent/server.go
git commit -m "feat(agent): pass --session-id UUID when creating tmux sessions"
```

---

## Chunk 2: Agent — JSONL Watcher & WS Integration

### Task 2.1: JSONL file watcher

**Files:**
- Create: `agent/jsonl_watcher.go`
- Create: `agent/jsonl_watcher_test.go`

- [ ] **Step 1: Write tests for incremental reading**

```go
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
	f.WriteString(`{"type":"system"}` + "\n")
	f.WriteString(`{"type":"system"}` + "\n")
	f.Close()

	reader := newIncrementalReader(path)
	reader.ReadNew() // read initial

	// Truncate file (simulate rotation)
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
	w, err := newJSONLWatcher(dir, func(events []JSONLEvent) {
		eventCh <- events
	})
	if err != nil {
		t.Fatalf("failed to create watcher: %v", err)
	}
	defer w.Stop()

	// Create a JSONL file
	path := filepath.Join(dir, "test-uuid.jsonl")
	f, _ := os.Create(path)
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd agent && go test -v -run "TestIncremental|TestJSONLWatcher" ./...
```

- [ ] **Step 3: Implement watcher**

```go
// agent/jsonl_watcher.go
package main

import (
	"bytes"
	"io"
	"log"
	"os"
	"path/filepath"
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

// JSONLWatcher watches a directory for JSONL file changes.
type JSONLWatcher struct {
	mu       sync.Mutex
	dir      string
	watcher  *fsnotify.Watcher
	readers  map[string]*IncrementalReader
	onEvents func([]JSONLEvent)
	stopCh   chan struct{}
	debounce map[string]*time.Timer
}

func newJSONLWatcher(dir string, onEvents func([]JSONLEvent)) (*JSONLWatcher, error) {
	fsw, err := fsnotify.NewWatcher()
	if err != nil {
		return nil, err
	}

	w := &JSONLWatcher{
		dir:      dir,
		watcher:  fsw,
		readers:  make(map[string]*IncrementalReader),
		onEvents: onEvents,
		stopCh:   make(chan struct{}),
		debounce: make(map[string]*time.Timer),
	}

	if err := fsw.Add(dir); err != nil {
		fsw.Close()
		return nil, err
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
				// Check if it's a subagent directory being created
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

func (w *JSONLWatcher) tryWatchSubdir(path string) {
	info, err := os.Stat(path)
	if err != nil || !info.IsDir() {
		return
	}
	// Watch subagent directories
	if strings.HasSuffix(path, "subagents") || filepath.Base(filepath.Dir(path)) == "subagents" {
		w.watcher.Add(path)
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

// WatchSession adds a specific JSONL file path to the watcher.
func (w *JSONLWatcher) WatchSession(jsonlPath string) {
	dir := filepath.Dir(jsonlPath)
	w.watcher.Add(dir)

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
```

- [ ] **Step 4: Run tests**

```bash
cd agent && go test -v -run "TestIncremental|TestJSONLWatcher" ./...
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add agent/jsonl_watcher.go agent/jsonl_watcher_test.go
git commit -m "feat(agent): add JSONL file watcher with incremental parsing"
```

### Task 2.2: Wire JSONL watcher into server

**Files:**
- Modify: `agent/server.go`
- Modify: `agent/main.go`
- Modify: `agent/poller.go`

This task wires everything together: session map, JSONL watcher, state merging, new WS message types.

- [ ] **Step 1: Add SessionMap and JSONLWatcher fields to Server**

In `server.go`, add to Server struct:

```go
type Server struct {
	// existing fields...
	sessionMap   *SessionMap
	jsonlWatcher *JSONLWatcher
	jsonlStates  map[string]*JSONLSessionState // tmuxName -> accumulated state
	jsonlMu      sync.RWMutex
}
```

Add new types for accumulated session state:

```go
type JSONLSessionState struct {
	Entries       []*JSONLEntry  // last N entries for state detection (ring buffer)
	Dedup         *Deduplicator
	State         SessionState
	Activity      string
	ToolName      string
	Model         string
	CompactCount  int
	ErrorDetected bool
	RateLimited   bool
}
```

- [ ] **Step 2: Add session_state and session_event message types**

Add new broadcast functions in `server.go`:

```go
func (s *Server) broadcastSessionState(tmuxName string, state *JSONLSessionState) {
	claudeUUID, _, _ := s.sessionMap.Get(tmuxName)

	input, output, cacheRead, cacheCreate := state.Dedup.SessionTotals()
	contextTokens := state.Dedup.ContextTokens()

	msg := ServerMessage{
		Type:            "session_state",
		Session:         tmuxName,
		ClaudeSessionID: claudeUUID,
		SessionState:    string(state.State),
		Activity:        state.Activity,
		ToolName:        state.ToolName,
		Model:           state.Model,
		ContextTokens:   contextTokens,
		ContextLimit:    getContextLimit(state.Model),
		CompactionCount: state.CompactCount,
		InputTokens:     input,
		OutputTokens:    output,
		CacheReadTokens: cacheRead,
		CacheCreateTokens: cacheCreate,
	}
	// broadcast to all subscribers (same pattern as broadcastSessions)
}

func (s *Server) broadcastSessionEvent(tmuxName string, event, message string) {
	msg := ServerMessage{
		Type:    "session_event",
		Session: tmuxName,
		Event:   event,
		Message: message,
	}
	// broadcast to all subscribers
}
```

- [ ] **Step 3: Add new fields to ServerMessage struct**

```go
// Add these fields to ServerMessage:
SessionState      string `json:"session_state,omitempty"`
Activity          string `json:"activity,omitempty"`
ToolName          string `json:"tool_name,omitempty"`
Event             string `json:"event,omitempty"`
ContextTokens     int    `json:"context_tokens,omitempty"`
ContextLimit      int    `json:"context_limit,omitempty"`
CompactionCount   int    `json:"compaction_count,omitempty"`
InputTokens       int    `json:"input_tokens,omitempty"`
OutputTokens      int    `json:"output_tokens,omitempty"`
CacheReadTokens   int    `json:"cache_read_tokens,omitempty"`
CacheCreateTokens int    `json:"cache_create_tokens,omitempty"`
```

- [ ] **Step 4: Wire JSONL watcher in main.go**

In `main.go`, after creating server and poller:

```go
// Create session map
sessionMap := newSessionMap()
server.sessionMap = sessionMap
server.jsonlStates = make(map[string]*JSONLSessionState)

// Determine home dir
homeDir, _ := os.UserHomeDir()

// JSONL event handler
handleJSONLEvents := func(events []JSONLEvent) {
    // Match events to sessions, update state, broadcast
    // (implementation in server.go method)
    server.handleJSONLEvents(events, homeDir)
}

// Note: watcher directories will be added per-session via WatchSession()
// The base claude projects dir might not exist yet
claudeProjectsDir := filepath.Join(homeDir, ".claude", "projects")
os.MkdirAll(claudeProjectsDir, 0755)

jsonlWatcher, err := newJSONLWatcher(claudeProjectsDir, handleJSONLEvents)
if err != nil {
    log.Printf("JSONL watcher failed to start: %v", err)
} else {
    server.jsonlWatcher = jsonlWatcher
    defer jsonlWatcher.Stop()
}
```

- [ ] **Step 5: Implement handleJSONLEvents in server.go**

```go
func (s *Server) handleJSONLEvents(events []JSONLEvent, homeDir string) {
	// Group events by session
	bySession := make(map[string][]*JSONLEntry)

	s.sessionMap.mu.RLock()
	// Build reverse map: jsonl path prefix -> tmux session name
	pathToSession := make(map[string]string)
	for name, mapping := range s.sessionMap.sessions {
		encoded := encodeWorkdir(mapping.Workdir)
		prefix := filepath.Join(homeDir, ".claude", "projects", encoded, mapping.ClaudeUUID)
		pathToSession[prefix] = name
	}
	s.sessionMap.mu.RUnlock()

	for _, evt := range events {
		// Match file path to session
		for prefix, tmuxName := range pathToSession {
			if strings.HasPrefix(evt.FilePath, prefix) {
				bySession[tmuxName] = append(bySession[tmuxName], evt.Entry)
				break
			}
		}
	}

	for tmuxName, entries := range bySession {
		s.processSessionEntries(tmuxName, entries)
	}
}

func (s *Server) processSessionEntries(tmuxName string, entries []*JSONLEntry) {
	s.jsonlMu.Lock()
	state, exists := s.jsonlStates[tmuxName]
	if !exists {
		state = &JSONLSessionState{
			Dedup: newDeduplicator(),
		}
		s.jsonlStates[tmuxName] = state
	}

	for _, entry := range entries {
		// Track model
		if entry.Model != "" {
			state.Model = entry.Model
		}

		// Deduplication for token tracking
		if entry.RequestID != "" {
			state.Dedup.Add(entry)
		}

		// Compaction detection
		if entry.IsCompactSummary {
			state.CompactCount++
			s.jsonlMu.Unlock()
			s.broadcastSessionEvent(tmuxName, "compaction", "Context was compacted")
			s.jsonlMu.Lock()
		}

		// Error detection
		for _, block := range entry.ContentBlocks {
			if block.Type == "tool_result" && block.IsError {
				state.ErrorDetected = true
				s.jsonlMu.Unlock()
				s.broadcastSessionEvent(tmuxName, "error", truncateStr(block.Content, 100))
				s.jsonlMu.Lock()
			}
			// Rate limit detection
			if block.Type == "tool_result" && containsRateLimit(block.Content) {
				state.RateLimited = true
				s.jsonlMu.Unlock()
				s.broadcastSessionEvent(tmuxName, "rate_limit", "Rate limit detected")
				s.jsonlMu.Lock()
			}
		}

		// Keep last 20 entries for state detection
		state.Entries = append(state.Entries, entry)
		if len(state.Entries) > 20 {
			state.Entries = state.Entries[len(state.Entries)-20:]
		}
	}

	// Detect state from accumulated entries
	newState := detectJSONLState(state.Entries)
	if newState != "" {
		state.State = newState
	}

	// Derive activity from last entry's last content block
	if last := entries[len(entries)-1]; len(last.ContentBlocks) > 0 {
		lastBlock := last.ContentBlocks[len(last.ContentBlocks)-1]
		state.Activity, state.ToolName = deriveActivity(lastBlock)
	}

	s.jsonlMu.Unlock()

	s.broadcastSessionState(tmuxName, state)
}

func containsRateLimit(content string) bool {
	lower := strings.ToLower(content)
	return strings.Contains(lower, "rate limit") || strings.Contains(lower, "rate_limit") ||
		(strings.Contains(lower, "exceeded") && strings.Contains(lower, "limit"))
}
```

- [ ] **Step 6: Update create_session handler to register session mapping and watch**

In `server.go`, in the `case "create_session":` block, update to use new return values:

```go
sessionID, claudeUUID, err := createTmuxSession(name, workdir, config.HistoryLimit, msg.DangerouslySkipPermissions)
if err != nil {
    // ... error handling ...
}
s.sessionMap.Set(sessionID, claudeUUID, workdir)

// Start watching JSONL file for this session
homeDir, _ := os.UserHomeDir()
jsonlPath := s.sessionMap.JSONLPath(sessionID, homeDir)
if s.jsonlWatcher != nil {
    s.jsonlWatcher.WatchSession(jsonlPath)
}

s.sendMessage(conn, ServerMessage{
    Type:            "session_created",
    Session:         sessionID,
    Name:            name,
    ClaudeSessionID: claudeUUID,
})
```

- [ ] **Step 7: Update state merging in poller**

In `poller.go`, modify the poll function to merge JSONL state with tmux state. The poller needs access to the server's jsonlStates:

Add a merger callback to Poller:

```go
// In Poller struct, add:
stateMerger func(tmuxName string, tmuxState SessionState) SessionState
```

In `poll()`, after `detectState(paneText)`:

```go
if p.stateMerger != nil {
    state = p.stateMerger(ts.Name, state)
}
```

In `main.go`, set the merger:

```go
poller.stateMerger = func(tmuxName string, tmuxState SessionState) SessionState {
    server.jsonlMu.RLock()
    jsonlState, exists := server.jsonlStates[tmuxName]
    server.jsonlMu.RUnlock()

    if !exists || jsonlState.State == "" {
        return tmuxState
    }
    // needs_attention only from tmux
    if tmuxState == StateNeedsAttention {
        return StateNeedsAttention
    }
    // JSONL is primary for working/idle
    return jsonlState.State
}
```

- [ ] **Step 8: Build and verify**

```bash
cd agent && go build ./...
```

Expected: compiles successfully.

- [ ] **Step 9: Commit**

```bash
git add agent/server.go agent/main.go agent/poller.go
git commit -m "feat(agent): wire JSONL watcher into server with state merging and new WS messages"
```

---

## Chunk 3: Dashboard — Backend (DB, Message Handling)

### Task 3.1: Prisma migration — Session and SessionSnapshot

**Files:**
- Modify: `dashboard/prisma/schema.prisma`

- [ ] **Step 1: Add new models to schema**

Append to `prisma/schema.prisma`:

```prisma
model Session {
  id              String    @id @default(cuid())
  tmuxSessionName String
  claudeSessionId String
  serverId        String
  userId          String
  workdir         String
  createdAt       DateTime  @default(now())
  endedAt         DateTime?

  user      User              @relation(fields: [userId], references: [id], onDelete: Cascade)
  server    Server            @relation(fields: [serverId], references: [id], onDelete: Cascade)
  snapshots SessionSnapshot[]

  @@unique([userId, serverId, claudeSessionId])
  @@index([userId, serverId])
}

model SessionSnapshot {
  id                String   @id @default(cuid())
  sessionId         String
  contextTokens     Int
  contextLimit      Int
  compactionCount   Int
  state             String
  inputTokens       Int
  outputTokens      Int
  cacheReadTokens   Int
  cacheCreateTokens Int
  timestamp         DateTime @default(now())

  session Session @relation(fields: [sessionId], references: [id], onDelete: Cascade)

  @@index([sessionId, timestamp])
}
```

- [ ] **Step 2: Add relations to existing models**

Add to `User` model: `sessions Session[]`
Add to `Server` model: `sessions Session[]`

- [ ] **Step 3: Generate and apply migration**

```bash
cd dashboard && npx prisma migrate dev --name add-session-models
```

- [ ] **Step 4: Verify generated client**

```bash
npx prisma generate
```

- [ ] **Step 5: Commit**

```bash
git add dashboard/prisma/
git commit -m "feat(dashboard): add Session and SessionSnapshot Prisma models"
```

### Task 3.2: Handle new message types in agent-manager

**Files:**
- Modify: `dashboard/src/lib/agent-manager.ts`
- Modify: `dashboard/src/lib/types.ts`

- [ ] **Step 1: Extend types**

In `src/lib/types.ts`, add to `SessionInfo` interface (or create if not typed yet):

```typescript
// Add to existing SessionInfo or equivalent
export interface JSONLSessionData {
  claudeSessionId?: string;
  currentActivity?: string;
  toolName?: string;
  model?: string;
  contextTokens?: number;
  contextLimit?: number;
  compactionCount?: number;
  sessionInputTokens?: number;
  sessionOutputTokens?: number;
  cacheReadTokens?: number;
  cacheCreateTokens?: number;
}

export interface SessionEvent {
  session: string;
  event: "error" | "rate_limit" | "compaction";
  message: string;
  timestamp: number;
}
```

- [ ] **Step 2: Handle session_state and session_event in AgentConnection**

In `agent-manager.ts`, in the message handler switch, add:

```typescript
case "session_state":
  this.handleSessionState(parsed);
  this.onEvent("sessions"); // reuse existing targeted update flow
  break;

case "session_event":
  this.handleSessionEvent(parsed);
  this.onEvent("session_event");
  break;

case "session_created":
  // Persist Session model to DB
  if (parsed.claude_session_id) {
    this.persistSession(parsed);
  }
  break;
```

Implement `handleSessionState`:

```typescript
private handleSessionState(msg: any) {
  const sessionName = msg.session_id;
  // Find matching session in this.sessions and merge JSONL data
  const session = this.sessions.find(s => s.id === sessionName);
  if (session) {
    session.claudeSessionId = msg.claude_session_id;
    session.currentActivity = msg.activity;
    session.toolName = msg.tool_name;
    session.model = msg.model;
    session.contextTokens = msg.context_tokens;
    session.contextLimit = msg.context_limit;
    session.compactionCount = msg.compaction_count;
    session.sessionInputTokens = msg.input_tokens;
    session.sessionOutputTokens = msg.output_tokens;
    session.cacheReadTokens = msg.cache_read_tokens;
    session.cacheCreateTokens = msg.cache_create_tokens;
  }
  // Throttled snapshot persistence
  this.throttledSnapshot(msg);
}
```

Implement `persistSession`:

```typescript
private async persistSession(msg: any) {
  if (!this.userId) return;
  try {
    await prisma.session.upsert({
      where: {
        userId_serverId_claudeSessionId: {
          userId: this.userId,
          serverId: this.serverId,
          claudeSessionId: msg.claude_session_id,
        },
      },
      update: {},
      create: {
        tmuxSessionName: msg.session_id,
        claudeSessionId: msg.claude_session_id,
        serverId: this.serverId,
        userId: this.userId,
        workdir: "", // will be filled from session data
      },
    });
  } catch (e) {
    console.error("Failed to persist session:", e);
  }
}
```

Implement throttled snapshot:

```typescript
private snapshotTimers = new Map<string, number>();

private throttledSnapshot(msg: any) {
  const key = msg.session_id;
  const now = Date.now();
  const lastTime = this.snapshotTimers.get(key) || 0;

  if (now - lastTime < 30_000) return; // 30s throttle
  this.snapshotTimers.set(key, now);

  this.saveSnapshot(msg);
}

private async saveSnapshot(msg: any) {
  if (!this.userId) return;
  const session = await prisma.session.findFirst({
    where: {
      userId: this.userId,
      serverId: this.serverId,
      claudeSessionId: msg.claude_session_id,
    },
  });
  if (!session) return;

  await prisma.sessionSnapshot.create({
    data: {
      sessionId: session.id,
      contextTokens: msg.context_tokens || 0,
      contextLimit: msg.context_limit || 200000,
      compactionCount: msg.compaction_count || 0,
      state: msg.session_state || "idle",
      inputTokens: msg.input_tokens || 0,
      outputTokens: msg.output_tokens || 0,
      cacheReadTokens: msg.cache_read_tokens || 0,
      cacheCreateTokens: msg.cache_create_tokens || 0,
    },
  });
}
```

- [ ] **Step 3: Add "session_event" to UpdateType and targeted update**

Add `"session_event"` to UpdateType and forward the event data:

```typescript
case "session_event":
  return { ...base, sessionEvent: this.lastSessionEvent };
```

- [ ] **Step 4: Build to verify compilation**

```bash
cd dashboard && npm run build
```

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/lib/agent-manager.ts dashboard/src/lib/types.ts
git commit -m "feat(dashboard): handle session_state and session_event messages, persist snapshots"
```

### Task 3.3: Forward new message types in server.ts

**Files:**
- Modify: `dashboard/server.ts`

- [ ] **Step 1: Update message forwarding**

The new `session_state` and `session_event` messages flow through the existing `onUserTargetedUpdate` mechanism, which already forwards arbitrary JSON to the browser WS. No changes needed to `server.ts` message proxy — it's already type-agnostic.

Verify by checking that targeted updates are forwarded as-is. If the existing code destructures specific fields, add the new ones.

- [ ] **Step 2: Build and verify**

```bash
cd dashboard && npm run build
```

- [ ] **Step 3: Commit (if changes were needed)**

```bash
git add dashboard/server.ts
git commit -m "feat(dashboard): ensure server.ts forwards session_state and session_event messages"
```

---

## Chunk 4: Dashboard — Frontend (Context Tracker UI, Notifications)

### Task 4.1: Extend useSessionState with JSONL data

**Files:**
- Modify: `dashboard/src/hooks/useSessionState.tsx`

- [ ] **Step 1: Extend SessionInfo processing**

In the `processServers` function, extend the session object with JSONL fields. In `applyTargetedUpdate`, merge `session_state` data by matching on session id.

Add handler for the new targeted update types in the existing `applyTargetedUpdate`:

```typescript
// When receiving targeted update with session_state data, merge into session:
if (update.sessions) {
  // existing logic...
  // After building session objects, merge JSONL data from sessionStateCache
}
```

Store JSONL data in a ref that persists across state updates:

```typescript
const jsonlDataRef = useRef<Record<string, JSONLSessionData>>({});

// In message handler, when receiving session_state targeted update:
if (update.sessionState) {
  const key = `${update.serverId}:${update.sessionState.session}`;
  jsonlDataRef.current[key] = update.sessionState;
}
```

When building `ServerStatus`, merge JSONL data into each session.

- [ ] **Step 2: Add session_event handling**

Forward session events to notification system via a callback:

```typescript
const sessionEventRef = useRef<((event: SessionEvent) => void) | null>(null);

// Expose setter for notification hook:
const onSessionEvent = useCallback((handler: (event: SessionEvent) => void) => {
  sessionEventRef.current = handler;
}, []);
```

- [ ] **Step 3: Build and verify**

```bash
cd dashboard && npm run build
```

- [ ] **Step 4: Commit**

```bash
git add dashboard/src/hooks/useSessionState.tsx
git commit -m "feat(dashboard): integrate JSONL session state into useSessionState hook"
```

### Task 4.2: Context Window sub-header strip

**Files:**
- Create: `dashboard/src/components/ContextBar.tsx`
- Modify: `dashboard/src/components/TerminalView.tsx`

- [ ] **Step 1: Create ContextBar component**

```tsx
// dashboard/src/components/ContextBar.tsx
"use client";

import { useState, useRef } from "react";
import type { JSONLSessionData } from "@/lib/types";

function getBarColor(percent: number): string {
  if (percent <= 50) return "#238636";
  if (percent <= 80) return `linear-gradient(90deg, #238636, #eab308)`;
  return `linear-gradient(90deg, #eab308, #da3633)`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return String(n);
}

export function ContextBar({ data }: { data: JSONLSessionData }) {
  const [showTooltip, setShowTooltip] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  if (!data.contextTokens || !data.contextLimit) return null;

  const percent = Math.min(100, Math.round((data.contextTokens / data.contextLimit) * 100));

  return (
    <div className="flex items-center gap-3 px-4 py-1 bg-[#0d1117] border-b border-surface-1 text-[11px]">
      {/* Model */}
      {data.model && (
        <>
          <span className="text-text-faint">{data.model.replace("claude-", "")}</span>
          <span className="text-[#21262d]">·</span>
        </>
      )}

      {/* Activity */}
      {data.currentActivity && (
        <span className="text-text-muted truncate max-w-[300px]">
          {data.currentActivity}
        </span>
      )}

      {/* Context bar - right aligned */}
      <div
        ref={containerRef}
        className="flex items-center gap-1.5 ml-auto cursor-pointer rounded px-1 hover:bg-[rgba(56,139,253,0.08)] relative"
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
      >
        <span className="text-text-faint">ctx</span>
        <div className="w-[100px] h-1 bg-[#21262d] rounded-sm overflow-hidden">
          <div
            className="h-full rounded-sm"
            style={{
              width: `${percent}%`,
              background: getBarColor(percent),
            }}
          />
        </div>
        <span className="text-text-muted">~{formatTokens(data.contextTokens)}/{formatTokens(data.contextLimit)}</span>
        {(data.compactionCount ?? 0) > 0 && (
          <>
            <span className="text-[#21262d]">·</span>
            <span className="text-text-faint">{data.compactionCount}× compact</span>
          </>
        )}

        {/* Hover tooltip */}
        {showTooltip && <ContextTooltip data={data} percent={percent} />}
      </div>
    </div>
  );
}

function ContextTooltip({ data, percent }: { data: JSONLSessionData; percent: number }) {
  // Rough breakdown estimation
  const total = data.contextTokens || 1;
  const claudeMd = 8000; // rough estimate
  const thinking = Math.round(total * 0.3);
  const toolOutputs = Math.round(total * 0.4);
  const messages = total - claudeMd - thinking - toolOutputs;

  const categories = [
    { name: "Tool outputs", tokens: toolOutputs, color: "#da3633", pct: toolOutputs / total },
    { name: "Thinking", tokens: thinking, color: "#a371f7", pct: thinking / total },
    { name: "Messages", tokens: Math.max(0, messages), color: "#58a6ff", pct: Math.max(0, messages) / total },
    { name: "CLAUDE.md", tokens: claudeMd, color: "#3fb950", pct: claudeMd / total },
  ];

  return (
    <div className="absolute top-full right-0 mt-1 w-[260px] bg-[#1c2128] border border-surface-1 rounded-lg p-3.5 shadow-xl z-50">
      <div className="flex justify-between items-center mb-2.5">
        <span className="text-xs text-text-primary font-semibold">Context Window</span>
        <span className="text-[11px]" style={{ color: percent > 80 ? "#da3633" : percent > 50 ? "#eab308" : "#238636" }}>
          {percent}%
        </span>
      </div>

      {/* Progress bar */}
      <div className="w-full h-2 bg-[#21262d] rounded overflow-hidden mb-2.5">
        <div
          className="h-full rounded"
          style={{ width: `${percent}%`, background: getBarColor(percent) }}
        />
      </div>

      <div className="text-xs text-text-primary mb-2.5">
        ~{formatTokens(data.contextTokens || 0)} / {formatTokens(data.contextLimit || 200000)} tokens
      </div>

      {/* Breakdown */}
      <div className="flex flex-col gap-1.5 text-[11px]">
        {categories.map((cat) => (
          <div key={cat.name} className="flex justify-between items-center">
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-sm" style={{ background: cat.color }} />
              <span className="text-text-muted">{cat.name}</span>
            </div>
            <span className="text-text-primary font-mono">~{formatTokens(cat.tokens)}</span>
          </div>
        ))}
      </div>

      {/* Stacked bar */}
      <div className="flex w-full h-1.5 rounded overflow-hidden mt-2.5 gap-px">
        {categories.map((cat) => (
          <div
            key={cat.name}
            style={{ width: `${Math.max(1, cat.pct * 100)}%`, background: cat.color }}
          />
        ))}
      </div>

      {/* Footer */}
      {(data.compactionCount ?? 0) > 0 && (
        <div className="mt-2.5 pt-2 border-t border-[#21262d] text-[11px] text-text-faint">
          Compacted {data.compactionCount} times
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add ContextBar to TerminalView**

In `TerminalView.tsx`, import and render ContextBar between header and terminal:

```tsx
import { ContextBar } from "./ContextBar";

// In the JSX, after the header div and before the terminal div:
{jsonlData && <ContextBar data={jsonlData} />}
```

The `jsonlData` prop needs to be threaded through from `useSessionState` → page → TerminalView. Add a `jsonlData?: JSONLSessionData` prop to TerminalView.

- [ ] **Step 3: Build and verify**

```bash
cd dashboard && npm run build
```

- [ ] **Step 4: Commit**

```bash
git add dashboard/src/components/ContextBar.tsx dashboard/src/components/TerminalView.tsx
git commit -m "feat(dashboard): add Context Window sub-header strip with hover tooltip"
```

### Task 4.3: New notification triggers

**Files:**
- Modify: `dashboard/src/hooks/useNotification.ts`
- Create: `dashboard/public/info.wav` (compaction notification sound)

- [ ] **Step 1: Add info sound for compaction**

Either create a subtle info sound or reuse done.wav at lower volume. For now, reuse:

```typescript
// In useNotificationSound.ts, add:
const playInfo = useCallback(() => {
  if (!infoRef.current) {
    infoRef.current = new Audio("/done.wav");
    infoRef.current.volume = 0.3;
  }
  infoRef.current.currentTime = 0;
  infoRef.current.play().catch(() => {});
}, []);
```

- [ ] **Step 2: Add session_event handling in useNotification**

In `useNotification.ts`, add handler for session events coming through the context:

```typescript
// Register session event handler
useEffect(() => {
  const handler = (event: SessionEvent) => {
    if (!soundEnabled.current) return;

    switch (event.event) {
      case "error":
        playAlert();
        showNotification("Tool error", event.message);
        break;
      case "rate_limit":
        playAlert();
        showNotification("Rate limited", event.message);
        break;
      case "compaction":
        playInfo();
        showNotification("Context compacted", event.message);
        break;
    }
  };

  onSessionEvent?.(handler);
}, [playAlert, playInfo, onSessionEvent]);
```

- [ ] **Step 3: Build and verify**

```bash
cd dashboard && npm run build
```

- [ ] **Step 4: Commit**

```bash
git add dashboard/src/hooks/useNotification.ts dashboard/src/hooks/useNotificationSound.ts
git commit -m "feat(dashboard): add notification triggers for errors, rate limits, and compaction"
```

---

## Chunk 5: Integration Testing & Polish

### Task 5.1: Agent integration test

**Files:**
- Create: `agent/integration_test.go`

- [ ] **Step 1: Write integration test for full JSONL → state → WS flow**

```go
// agent/integration_test.go
package main

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestFullFlow_JSONLWriteToStateDetection(t *testing.T) {
	dir := t.TempDir()

	// Setup session map
	sm := newSessionMap()
	sm.Set("cc-test-session", "test-uuid", "/tmp/project")

	// Create JSONL file at expected path
	encodedDir := filepath.Join(dir, encodeWorkdir("/tmp/project"))
	os.MkdirAll(encodedDir, 0755)
	jsonlPath := filepath.Join(encodedDir, "test-uuid.jsonl")

	// Setup watcher
	var receivedEvents []JSONLEvent
	eventCh := make(chan struct{}, 10)

	w, err := newJSONLWatcher(dir, func(events []JSONLEvent) {
		receivedEvents = append(receivedEvents, events...)
		eventCh <- struct{}{}
	})
	if err != nil {
		t.Fatalf("watcher error: %v", err)
	}
	defer w.Stop()
	w.WatchSession(jsonlPath)

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

	// Verify state detection
	entries := make([]*JSONLEntry, len(receivedEvents))
	for i, e := range receivedEvents {
		entries[i] = e.Entry
	}
	state := detectJSONLState(entries)
	if state != StateWorking {
		t.Errorf("expected working state, got %s", state)
	}

	// Verify model and context
	if entries[0].Model != "claude-opus-4-6" {
		t.Errorf("expected opus-4-6 model, got %s", entries[0].Model)
	}
	if entries[0].Usage.InputTokens != 50000 {
		t.Errorf("expected 50000 input tokens, got %d", entries[0].Usage.InputTokens)
	}
}
```

- [ ] **Step 2: Run integration test**

```bash
cd agent && go test -v -run TestFullFlow ./...
```

Expected: PASS.

- [ ] **Step 3: Run all agent tests**

```bash
cd agent && go test -v ./...
```

Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add agent/integration_test.go
git commit -m "test(agent): add integration test for JSONL watcher → state detection flow"
```

### Task 5.2: Dashboard build verification

**Files:** None (verification only)

- [ ] **Step 1: Full dashboard build**

```bash
cd dashboard && npm run build
```

Expected: builds successfully.

- [ ] **Step 2: Lint check**

```bash
cd dashboard && npm run lint
```

Expected: no errors.

- [ ] **Step 3: Agent cross-compile**

```bash
cd agent && make cross
```

Expected: builds for linux-amd64, linux-arm64, darwin-arm64.

### Task 5.3: Final commit and tag

- [ ] **Step 1: Verify all changes are committed**

```bash
git status
```

- [ ] **Step 2: Push release/v2 branch**

```bash
git push origin release/v2
```

- [ ] **Step 3: Tag alpha release**

```bash
git tag v2.0.0-alpha.1
git push origin v2.0.0-alpha.1
```

This triggers the release workflow, creating agent binaries and docker image for testing.

---

## Errata: Fixes from Plan Review

**Apply these corrections while implementing the corresponding tasks. Each fix references the task it applies to.**

### E1: Task 1.5 — Provide complete server.go call-site update (prevents compilation break)

Task 1.5 Step 4 is vague. Use this exact code for the `create_session` handler update in `server.go`. Find the `case "create_session":` block (around line 223) and update the `createTmuxSession` call:

```go
// Old:
// sessionID, err := createTmuxSession(name, workdir, config.HistoryLimit, msg.DangerouslySkipPermissions)
// New:
sessionID, claudeUUID, err := createTmuxSession(name, workdir, config.HistoryLimit, msg.DangerouslySkipPermissions)
if err != nil {
    s.sendMessage(conn, ServerMessage{Type: "error", Message: err.Error()})
    return
}

// Session mapping and JSONL watch will be added in Task 2.2.
// For now, just include claudeUUID in response:
s.sendMessage(conn, ServerMessage{
    Type:            "session_created",
    Session:         sessionID,
    Name:            name,
    ClaudeSessionID: claudeUUID,
})
```

This ensures the code compiles after Task 1.5 before Task 2.2 wires the session map.

### E2: Task 2.2 — Fix direct access to private SessionMap fields

`handleJSONLEvents` directly accesses `s.sessionMap.mu` and `s.sessionMap.sessions`. Replace with a proper public method. Add to `session_map.go`:

```go
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
```

Then in `handleJSONLEvents`, replace direct field access:

```go
// Old:
// s.sessionMap.mu.RLock()
// pathToSession := make(map[string]string)
// for name, mapping := range s.sessionMap.sessions { ... }
// s.sessionMap.mu.RUnlock()

// New:
pathToSession := s.sessionMap.PathPrefixMap(homeDir)
```

### E3: Task 2.2 — Add timestamp to session_event messages

Add `Timestamp` field to `ServerMessage`:

```go
Timestamp int64 `json:"timestamp,omitempty"`
```

In `broadcastSessionEvent`, set it:

```go
msg := ServerMessage{
    Type:      "session_event",
    Session:   tmuxName,
    Event:     event,
    Message:   message,
    Timestamp: time.Now().UnixMilli(),
}
```

### E4: Task 2.2 — Add session cleanup on kill

In the `case "kill_session":` handler in `server.go`, after killing the tmux session, clean up JSONL state:

```go
// After successful kill:
s.sessionMap.Delete(msg.SessionID)
s.jsonlMu.Lock()
delete(s.jsonlStates, msg.SessionID)
s.jsonlMu.Unlock()
```

### E5: Task 2.2 — Fix nested lock issue in processSessionEntries

The current code unlocks `jsonlMu` before broadcasting, which is correct but error-prone. Refactor to collect events first, then broadcast after unlock:

```go
func (s *Server) processSessionEntries(tmuxName string, entries []*JSONLEntry) {
    var events []struct{ event, message string } // collect events to broadcast

    s.jsonlMu.Lock()
    state, exists := s.jsonlStates[tmuxName]
    if !exists {
        state = &JSONLSessionState{Dedup: newDeduplicator()}
        s.jsonlStates[tmuxName] = state
    }

    for _, entry := range entries {
        if entry.Model != "" {
            state.Model = entry.Model
        }
        if entry.RequestID != "" {
            state.Dedup.Add(entry)
        }
        if entry.IsCompactSummary {
            state.CompactCount++
            events = append(events, struct{ event, message string }{"compaction", "Context was compacted"})
        }
        for _, block := range entry.ContentBlocks {
            if block.Type == "tool_result" && block.IsError {
                state.ErrorDetected = true
                events = append(events, struct{ event, message string }{"error", truncateStr(block.Content, 100)})
            }
            if block.Type == "tool_result" && containsRateLimit(block.Content) {
                state.RateLimited = true
                events = append(events, struct{ event, message string }{"rate_limit", "Rate limit detected"})
            }
        }
        state.Entries = append(state.Entries, entry)
        if len(state.Entries) > 20 {
            state.Entries = state.Entries[len(state.Entries)-20:]
        }
    }

    newState := detectJSONLState(state.Entries)
    if newState != "" {
        state.State = newState
    }
    if last := entries[len(entries)-1]; len(last.ContentBlocks) > 0 {
        lastBlock := last.ContentBlocks[len(last.ContentBlocks)-1]
        state.Activity, state.ToolName = deriveActivity(lastBlock)
    }

    // Copy state for broadcasting (avoid holding lock during I/O)
    stateCopy := *state
    s.jsonlMu.Unlock()

    // Broadcast outside of lock
    for _, evt := range events {
        s.broadcastSessionEvent(tmuxName, evt.event, evt.message)
    }
    s.broadcastSessionState(tmuxName, &stateCopy)
}
```

### E6: Task 3.2 — Fix `this.serverId` reference

In `agent-manager.ts`, `AgentConnection` does not have a `serverId` field. Use `this.config.id` instead. Replace all occurrences of `this.serverId` in Task 3.2 with `this.config.id`.

### E7: Task 3.2 — Fix session_created handling

The `session_created` message is sent to the individual WS subscriber (via `sendMessage(conn, ...)`), not broadcast. The `AgentConnection`'s main WS connection does receive it because the same connection that sends `create_session` receives the response. However, `persistSession` should be called from the `session_created` response path, not as a separate case.

In `handleMessage`, merge into existing logic:

```typescript
case "session_created":
    // Already handled by existing code. Additionally persist the Session model:
    if (parsed.claude_session_id && this.userId) {
        this.persistSession(parsed).catch(console.error);
    }
    break;
```

### E8: Task 3.2 — Complete handleSessionEvent method

Add to `AgentConnection`:

```typescript
private lastSessionEvent: SessionEvent | null = null;

private handleSessionEvent(msg: any) {
    this.lastSessionEvent = {
        session: msg.session_id,
        event: msg.event,
        message: msg.message,
        timestamp: msg.timestamp || Date.now(),
    };
}
```

### E9: Task 3.2 — Add snapshot pruning

Add a pruning method that runs after saving a snapshot:

```typescript
private async pruneSnapshots(sessionDbId: string) {
    const count = await prisma.sessionSnapshot.count({
        where: { sessionId: sessionDbId },
    });
    if (count > 100) {
        const oldest = await prisma.sessionSnapshot.findMany({
            where: { sessionId: sessionDbId },
            orderBy: { timestamp: "asc" },
            take: count - 100,
            select: { id: true },
        });
        await prisma.sessionSnapshot.deleteMany({
            where: { id: { in: oldest.map(s => s.id) } },
        });
    }
}
```

Call after `saveSnapshot`:

```typescript
private async saveSnapshot(msg: any) {
    // ... existing code ...
    await prisma.sessionSnapshot.create({ data: { ... } });
    await this.pruneSnapshots(session.id);
}
```

### E10: Task 3.2 — Add snapshot loading on reconnect

In `AgentConnection`, when first connecting (after `loadUsageFromDB`), also load latest snapshots:

```typescript
private async loadLatestSnapshots(): Promise<void> {
    if (!this.userId) return;
    const sessions = await prisma.session.findMany({
        where: { userId: this.userId, serverId: this.config.id },
        include: {
            snapshots: { orderBy: { timestamp: "desc" }, take: 1 },
        },
    });
    for (const session of sessions) {
        if (session.snapshots.length > 0) {
            const snap = session.snapshots[0];
            // Pre-populate JSONL data for the matching tmux session
            const tmuxSession = this.sessions.find(s => s.id === session.tmuxSessionName);
            if (tmuxSession) {
                tmuxSession.contextTokens = snap.contextTokens;
                tmuxSession.contextLimit = snap.contextLimit;
                tmuxSession.compactionCount = snap.compactionCount;
                tmuxSession.claudeSessionId = session.claudeSessionId;
            }
        }
    }
}
```

### E11: Task 4.2 — Add mobile hiding to ContextBar

The spec says "Hidden on mobile." Add at the start of the ContextBar component:

```tsx
import { useIsMobile } from "@/hooks/useIsMobile";

export function ContextBar({ data }: { data: JSONLSessionData }) {
    const isMobile = useIsMobile();
    if (isMobile) return null;
    // ... rest of component
```

### E12: Task 4.2 — Remove base watcher on top-level projects dir

In `main.go`, do NOT create a watcher on the entire `~/.claude/projects/` directory. Instead, create the watcher without a base directory and only add per-session directories via `WatchSession`:

```go
// Change newJSONLWatcher to not require an initial directory:
jsonlWatcher, err := newJSONLWatcher(handleJSONLEvents)
// Then for each session: jsonlWatcher.WatchSession(jsonlPath)
```

Update `newJSONLWatcher` signature in `jsonl_watcher.go` accordingly — remove the `dir` parameter and the initial `fsw.Add(dir)` call. Directories are added only via `WatchSession`.

### E13: Task 4.3 — Define showNotification helper

The plan references `showNotification` but it doesn't exist in the current codebase. In `useNotification.ts`, add:

```typescript
const showNotification = useCallback((title: string, body: string) => {
    if (!browserEnabled.current || Notification.permission !== "granted") return;
    new Notification(title, {
        body,
        icon: "/favicon.ico",
    });
}, []);
```

### E14: JSON field naming consistency

The Go agent sends `session_id` (from existing `ServerMessage.Session` json tag). The dashboard expects `session_id`. The spec TypeScript uses `session`. To avoid confusion:

- **Go JSON tags**: `session_id`, `claude_session_id`, `session_state`, `activity`, `tool_name`, `context_tokens`, `context_limit`, `compaction_count`, `input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_create_tokens`
- **Dashboard reads**: Use the same snake_case field names from `msg.session_id`, `msg.context_tokens`, etc.
- All field names in plan code are already using snake_case JSON. No changes needed, but implementers should be aware that TypeScript types use camelCase while JSON wire format uses snake_case.
