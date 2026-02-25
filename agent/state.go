package main

import (
	"regexp"
	"strings"
)

type SessionState string

const (
	StateIdle           SessionState = "idle"
	StateWorking        SessionState = "working"
	StateNeedsAttention SessionState = "needs_attention"
	StateStarting       SessionState = "starting"
	StateDead           SessionState = "dead"
)

var needsAttentionPatterns []*regexp.Regexp
var workingPatterns []*regexp.Regexp
var pagerNeedsAttentionPatterns []*regexp.Regexp
var startingPatterns []*regexp.Regexp

func init() {
	needsAttentionPatterns = []*regexp.Regexp{
		regexp.MustCompile(`(?i)do you want to proceed`),
		regexp.MustCompile(`\(y/?n\)`),
		regexp.MustCompile(`(?i)^.{0,5}(allow|deny)\b`),
		regexp.MustCompile(`(?i)accept.*reject|reject.*accept`),
		regexp.MustCompile(`(?i)press.*to continue`),
		regexp.MustCompile(`(?i)would you like`),
		regexp.MustCompile(`(?i)^error:|^ERROR`),
		regexp.MustCompile(`(?i)rate.?limit|exceeded`),
		regexp.MustCompile(`(?i)permission.*denied`),
		regexp.MustCompile(`(?i)do you want to`),
	}

	workingPatterns = []*regexp.Regexp{
		regexp.MustCompile(`[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]`),
		regexp.MustCompile(`(?i)^\s*[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]?\s*(thinking|reasoning)`),
		regexp.MustCompile(`(?i)^\s*[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]\s*(reading|writing|searching|running|executing)`),
		regexp.MustCompile(`(?i)^(bash|edit|multiedit|read|write|glob|grep|todoread|todowrite)\s*:`),
		regexp.MustCompile(`(?i)^\s*tool\s*:|using tool`),
		regexp.MustCompile(`(?i)esc to interrupt`),
	}

	pagerNeedsAttentionPatterns = []*regexp.Regexp{
		regexp.MustCompile(`(?i)press q`),
	}

	startingPatterns = []*regexp.Regexp{
		regexp.MustCompile(`(?i)claude code`),
		regexp.MustCompile(`(?i)starting|loading|initializing`),
		regexp.MustCompile(`╭─`),
	}
}

func detectState(paneText string) SessionState {
	lines := strings.Split(paneText, "\n")

	// Get last 8 non-empty lines for analysis
	var lastLines []string
	for i := len(lines) - 1; i >= 0 && len(lastLines) < 8; i-- {
		trimmed := strings.TrimSpace(lines[i])
		if trimmed != "" {
			lastLines = append(lastLines, trimmed)
		}
	}

	if len(lastLines) == 0 {
		return StateStarting
	}

	combined := strings.Join(lastLines, "\n")

	// Check pager that needs user action (press q)
	for _, pat := range pagerNeedsAttentionPatterns {
		if pat.MatchString(combined) {
			return StateNeedsAttention
		}
	}

	// Check needs attention patterns
	for _, pat := range needsAttentionPatterns {
		if pat.MatchString(combined) {
			return StateNeedsAttention
		}
	}

	// Check working patterns
	for _, pat := range workingPatterns {
		if pat.MatchString(combined) {
			return StateWorking
		}
	}

	// Check pager in working state (j/k to scroll)
	if regexp.MustCompile(`(?i)j/k.*scroll|q.*quit`).MatchString(combined) {
		return StateWorking
	}

	// Check if starting
	// Only if we see very few lines of content overall (startup screen)
	if len(lines) < 20 {
		for _, pat := range startingPatterns {
			if pat.MatchString(combined) {
				return StateStarting
			}
		}
	}

	// Default: idle
	return StateIdle
}
