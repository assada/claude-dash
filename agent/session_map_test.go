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
	sm := newSessionMap("")
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
	sm := newSessionMap("")
	sm.Set("cc-123-proj", "a1b2c3d4-uuid", "/Users/me/projects/cp")

	path := sm.JSONLPath("cc-123-proj", "/Users/me")
	expected := "/Users/me/.claude/projects/-Users-me-projects-cp/a1b2c3d4-uuid.jsonl"
	if path != expected {
		t.Errorf("expected %s, got %s", expected, path)
	}
}

func TestSessionMap_NotFound(t *testing.T) {
	sm := newSessionMap("")
	_, _, ok := sm.Get("nonexistent")
	if ok {
		t.Error("expected not found")
	}
}

func TestSessionMap_Delete(t *testing.T) {
	sm := newSessionMap("")
	sm.Set("cc-123-proj", "uuid", "/work")
	sm.Delete("cc-123-proj")
	_, _, ok := sm.Get("cc-123-proj")
	if ok {
		t.Error("expected not found after delete")
	}
}

func TestGetContextLimit_Default200k(t *testing.T) {
	// When max observed tokens is under 200k, assume 200k limit
	if getContextLimit(50000) != 200_000 {
		t.Error("should be 200k when observed < 200k")
	}
	if getContextLimit(199_999) != 200_000 {
		t.Error("should be 200k when observed just under limit")
	}
}

func TestGetContextLimit_Auto1M(t *testing.T) {
	// When max observed tokens exceeds 200k, auto-detect as 1M
	if getContextLimit(200_001) != 1_000_000 {
		t.Error("should be 1M when observed > 200k")
	}
	if getContextLimit(500_000) != 1_000_000 {
		t.Error("should be 1M when observed 500k")
	}
}

func TestGetContextLimit_ZeroTokens(t *testing.T) {
	if getContextLimit(0) != 200_000 {
		t.Error("should default to 200k with no data")
	}
}

func TestSessionMap_PathPrefixMap(t *testing.T) {
	sm := newSessionMap("")
	sm.Set("cc-1-proj", "uuid-aaa", "/Users/me/projects/cp")
	sm.Set("cc-2-work", "uuid-bbb", "/home/user/work")

	prefixes := sm.PathPrefixMap("/Users/me")
	if len(prefixes) != 2 {
		t.Fatalf("expected 2 prefixes, got %d", len(prefixes))
	}

	expected1 := "/Users/me/.claude/projects/-Users-me-projects-cp/uuid-aaa"
	if prefixes[expected1] != "cc-1-proj" {
		t.Errorf("expected cc-1-proj for prefix %s, got %s", expected1, prefixes[expected1])
	}

	expected2 := "/Users/me/.claude/projects/-home-user-work/uuid-bbb"
	if prefixes[expected2] != "cc-2-work" {
		t.Errorf("expected cc-2-work for prefix %s, got %s", expected2, prefixes[expected2])
	}
}
