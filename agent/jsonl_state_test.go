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
