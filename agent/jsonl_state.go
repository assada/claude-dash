// agent/jsonl_state.go
package main

import (
	"fmt"
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
			// Text is "ending" only when stop_reason is set (response complete).
			// During streaming, stop_reason is empty → still working.
			if entry.StopReason != "" {
				return "ending"
			}
			return "ongoing" // still streaming text
		}
		if entry.Type == "user" && !entry.IsMeta {
			// Real user message → Claude will start working now
			return "ongoing"
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
	// If the path is long, show only last 3 components
	parts := strings.Split(p, "/")
	if len(parts) > 3 {
		return strings.Join(parts[len(parts)-3:], "/")
	}
	return p
}

func truncateStr(s string, max int) string {
	if len(s) <= max {
		return s
	}
	return s[:max]
}
