// agent/jsonl_parser.go
package main

import (
	"encoding/json"
	"strings"
)

// JSONLEntry represents a parsed line from Claude Code's JSONL session log.
type JSONLEntry struct {
	Type             string         `json:"type"` // "assistant", "user", "summary", "system"
	SessionID        string         `json:"sessionId"`
	RequestID        string         `json:"requestId"`
	Model            string         `json:"model"`
	CWD              string         `json:"cwd"`
	IsMeta           bool           `json:"isMeta"`
	IsCompactSummary bool           `json:"isCompactSummary"`
	Usage            UsageData      `json:"usage"`
	ContentBlocks    []ContentBlock // extracted from message.content
	ToolUseResult    string         `json:"-"` // extracted from user meta content
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
	Content   string                 `json:"-"`                   // tool_result content (string or extracted)
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
	Role    string          `json:"role"`
	Content json.RawMessage `json:"content"`
	Model   string          `json:"model"`
	Usage   UsageData       `json:"usage"`
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

	// Claude Code stores model and usage inside message, not at top level
	if entry.Model == "" && msg.Model != "" {
		entry.Model = msg.Model
	}
	if entry.Usage.InputTokens == 0 && msg.Usage.InputTokens > 0 {
		entry.Usage = msg.Usage
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

// ContextTokens returns the total context window fill from the most recent API call.
// This is input_tokens + cache_read + cache_creation (all contribute to context size).
func (d *Deduplicator) ContextTokens() int {
	if len(d.order) == 0 {
		return 0
	}
	lastReqID := d.order[len(d.order)-1]
	u := d.lastByRequestID[lastReqID].Usage
	return u.InputTokens + u.CacheReadInputTokens + u.CacheCreationInputTokens
}
