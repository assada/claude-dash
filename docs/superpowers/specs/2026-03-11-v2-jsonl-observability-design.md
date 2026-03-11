# v2.0.0 — JSONL-Powered Observability

## Overview

Major upgrade to Claude Dashboard. Adds JSONL-based session monitoring as the primary source for session state, context window tracking, and notifications. Tmux remains solely for terminal I/O.

Inspired by approaches from [claude-devtools](https://github.com/matt1398/claude-devtools) — adapted for our remote agent architecture.

## Architecture

```
Browser ←WS→ Dashboard (Next.js) ←WS→ Agent (Go)
                                        ├── tmux (PTY I/O only)
                                        │   └── terminal attach/detach/input/output/lastLine
                                        │   └── needs_attention detection (regex, kept as-is)
                                        └── JSONL watcher (NEW)
                                            ├── ~/.claude/projects/{path}/{uuid}.jsonl
                                            ├── ~/.claude/projects/{path}/{uuid}/subagents/*.jsonl
                                            └── incremental append-only parsing
```

### Responsibility Split

| Concern | Source (v1.x) | Source (v2.0) |
|---------|---------------|---------------|
| Terminal I/O | tmux PTY | tmux PTY (unchanged) |
| Session state | tmux regex (500ms poll) | Merged: JSONL activity + tmux `needs_attention` |
| `lastLine` display | tmux capture-pane | tmux capture-pane (unchanged) |
| Token usage (cost) | UsageScanner (10s) | UsageScanner (unchanged, for cost DB) |
| Token usage (real-time) | N/A | JSONL watcher (NEW, for context display) |
| Context window | N/A | JSONL watcher (NEW) |
| Notifications | state transitions only | state + errors + rate limits + compaction (NEW) |
| Activity info | N/A | JSONL watcher (NEW) |

### UsageScanner vs JSONL Watcher

Two systems parse JSONL files, for **different purposes**:

- **UsageScanner** (existing): Runs every 10s. Extracts `usage` entries for cost analytics. Writes to DB via `usage_entries` WS message. Tracks its own file offsets. **Unchanged in v2.**
- **JSONL Watcher** (new): Event-driven (fsnotify). Extracts state, context, activity, events. Sends real-time `session_state` WS messages. Tracks its own separate file offsets.

They coexist safely: each maintains independent offset maps, reads are non-destructive (append-only files), no write conflicts. Merging them would couple cost analytics to real-time state, which have different update frequencies and failure modes.

## Session Mapping: tmux ↔ JSONL

### Problem

tmux sessions (`cc-{timestamp}-{name}`) must be linked to JSONL files (`{uuid}.jsonl`). Claude Code does not expose its session UUID to parent processes.

### Solution: `--session-id <uuid>` flag

Claude Code supports `claude --session-id <uuid>` — we pre-assign the UUID at session creation.

1. Agent generates UUID v4
2. Launches `claude --session-id <uuid> [--dangerously-skip-permissions]` in tmux
3. JSONL file will be created at `~/.claude/projects/{encoded-workdir}/{uuid}.jsonl`
4. Mapping stored in DB (`Session` model) and cached in agent memory

**No legacy support.** Sessions created before v2.0.0 will not have JSONL mapping. This is acceptable — no production users yet.

### Path Encoding

Claude Code encodes workdir paths by replacing `/` with `-`:
- `/Users/me/projects/cp` → `-Users-me-projects-cp`
- Path: `~/.claude/projects/-Users-me-projects-cp/{uuid}.jsonl`

This encoding is lossy for paths containing dashes. We use the `cwd` field from JSONL entries as ground truth when needed.

### Session Creation Protocol Changes

Current `createTmuxSession` signature changes:

```go
// Before (v1.x)
func createTmuxSession(name, workdir string, skipPerms bool) (string, error)

// After (v2.0)
func createTmuxSession(name, workdir string, skipPerms bool) (sessionID string, claudeUUID string, err error)
```

The function generates UUID v4 internally and passes `--session-id <uuid>` to the claude command.

**WS protocol changes:**

`session_created` response gains a new field:

```typescript
// Agent → Dashboard
{
  type: "session_created",
  session: "cc-1234-myproject",      // tmux session name
  name: "myproject",
  claudeSessionId: "a1b2c3d4-..."   // NEW: UUID for JSONL mapping
}
```

Dashboard receives `claudeSessionId` and persists the `Session` model to DB.

### JSONL File Discovery Timing

The JSONL file does not exist until Claude Code makes its first API call (several seconds after launch).

1. Agent creates tmux session → session state = `starting` (from tmux detection, no JSONL yet)
2. `fsnotify` watcher on `~/.claude/projects/{encoded-workdir}/` receives CREATE event for `{uuid}.jsonl`
3. Watcher begins incremental parsing → state transitions to `working` or `idle` based on content
4. Until the JSONL file appears, tmux-based state detection is the sole source

## JSONL Entry Schema

Claude Code writes one JSON object per line. Key entry types:

### `assistant` entry (AI response)

```json
{
  "type": "assistant",
  "sessionId": "a1b2c3d4-...",
  "requestId": "req_abc123",
  "cwd": "/Users/me/projects/cp",
  "version": "2.1.72",
  "model": "claude-opus-4-6",
  "message": {
    "role": "assistant",
    "content": [
      { "type": "thinking", "thinking": "Let me analyze..." },
      { "type": "text", "text": "Here is the result..." },
      { "type": "tool_use", "id": "toolu_123", "name": "Read", "input": { "file_path": "/src/main.go" } }
    ]
  },
  "usage": {
    "input_tokens": 45000,
    "output_tokens": 1200,
    "cache_creation_input_tokens": 5000,
    "cache_read_input_tokens": 80000
  }
}
```

### `user` entry (user message or tool result)

```json
{
  "type": "user",
  "sessionId": "a1b2c3d4-...",
  "isMeta": true,
  "message": {
    "role": "user",
    "content": [
      {
        "type": "tool_result",
        "tool_use_id": "toolu_123",
        "content": "file contents here...",
        "is_error": false
      }
    ]
  }
}
```

When `isMeta: false`, content is a plain string (real user input).
When `isMeta: true`, content is an array with `tool_result` blocks.

### `summary` entry (compaction)

```json
{
  "type": "summary",
  "summary": "Conversation summary text...",
  "isCompactSummary": true
}
```

### `system` entry (metadata)

```json
{
  "type": "system",
  "turnDurationMs": 12345
}
```

### Fields We Parse

| Field | Where | Used For |
|-------|-------|----------|
| `type` | Root | Entry classification |
| `message.content[].type` | assistant | State detection (thinking/tool_use/text) |
| `message.content[].name` | assistant, tool_use | Activity display, tool name |
| `message.content[].input` | assistant, tool_use | Activity details (file_path, command) |
| `message.content[].is_error` | user, tool_result | Error notification trigger |
| `message.content[].content` | user, tool_result | Rate limit detection (pattern match) |
| `usage.input_tokens` | assistant | Context window fill level |
| `usage.output_tokens` | assistant | Token tracking |
| `usage.cache_*` | assistant | Token tracking |
| `model` | assistant | Model display, context limit lookup |
| `requestId` | assistant | Streaming deduplication |
| `isCompactSummary` | summary | Compaction detection |

### Incomplete Line Handling

The reader handles partially-written lines gracefully. If the last bytes read do not end with `\n`, buffer them and process on the next file change event. This handles the case where the agent reads while Claude Code is mid-write.

## JSONL Watcher (Go Agent)

### New Files

| File | Responsibility |
|------|---------------|
| `jsonl_watcher.go` | File watching, incremental reading, change detection |
| `jsonl_parser.go` | JSONL line parsing, streaming deduplication by requestId |
| `jsonl_state.go` | Activity-based session state detection, activity derivation |
| `session_map.go` | UUID ↔ tmux session mapping, path encoding helpers |

### Incremental Parsing

- Track `lastProcessedOffset` (bytes) and `pendingBuffer` (incomplete line) per file
- On file change, read only new bytes from last offset: `file.Seek(lastOffset, io.SeekStart)`
- Split on `\n`, prepend `pendingBuffer` to first chunk
- If last chunk doesn't end with `\n`, store in `pendingBuffer` for next read
- Parse only complete JSONL lines
- Detect file truncation (new size < last offset) → reset to 0, clear buffer

### Streaming Deduplication

Claude Code writes multiple JSONL entries per API response during streaming — same `requestId`, incrementally increasing `output_tokens`. Only the last entry per `requestId` is kept for **context window tracking** (gives final token count for that request).

**Session totals** (`inputTokens`, `outputTokens`, etc.) are computed by summing the deduplicated final entries across all requests. Each time a requestId's entry is updated (replaced by newer streaming entry), the session total is recalculated: `total = sum of lastByRequestID[*].usage`.

```go
type deduplicator struct {
    lastByRequestID map[string]*JSONLEntry
}

func (d *deduplicator) Add(entry *JSONLEntry) (isNew bool) {
    _, existed := d.lastByRequestID[entry.RequestID]
    d.lastByRequestID[entry.RequestID] = entry
    return !existed
}

func (d *deduplicator) SessionTotals() (input, output, cacheRead, cacheCreate int) {
    for _, e := range d.lastByRequestID {
        input += e.Usage.InputTokens
        output += e.Usage.OutputTokens
        cacheRead += e.Usage.CacheReadInputTokens
        cacheCreate += e.Usage.CacheCreationInputTokens
    }
    return
}
```

### File Watching Strategy

- **Linux**: `inotify` via `fsnotify` library on `~/.claude/projects/{encoded-workdir}/`
- **macOS**: `FSEvents` via `fsnotify` library (same API)
- **Debounce**: 100ms to coalesce rapid writes
- **Catch-up scan**: Every 30 seconds, check active session files for unprocessed growth (compensates for missed events — especially important on macOS where FSEvents reports events at directory level with lower granularity than Linux inotify)
- **Subagent watching**: Also watch `{uuid}/subagents/` directory for subagent activity

### Activity-Based State Detection

Replaces tmux regex-based detection for `working`/`idle`. Analyzes JSONL content blocks:

**Ending events** (session idle):
- `text` content block from assistant (final text output)
- User interruption (`toolUseResult === 'User rejected tool use'`)
- `ExitPlanMode` tool use

**Ongoing events** (session working):
- `thinking` block present
- `tool_use` block present
- `tool_result` block present
- Active subagent (files in `{uuid}/subagents/` being modified)

**Decision**: If any ongoing event exists after the last ending event → `working`. Otherwise → `idle`.

### State Merging

The agent produces a **merged state** combining JSONL and tmux signals:

```go
func mergedState(jsonlState, tmuxState SessionState) SessionState {
    // needs_attention only comes from tmux (prompt detection)
    if tmuxState == StateNeedsAttention {
        return StateNeedsAttention
    }
    // starting: no JSONL file yet, use tmux
    if jsonlState == "" {
        return tmuxState
    }
    // JSONL is primary for working/idle
    return jsonlState
}
```

The `session_state` WS message reports this merged state, not a purely JSONL-derived state.

### Current Activity Derivation

The `currentActivity` string is derived from the last content block in the most recent assistant entry:

```go
var activityMap = map[string]func(toolUse ToolUseBlock) string{
    "Read":       func(t) { return "Reading " + shortenPath(t.Input.FilePath) },
    "Edit":       func(t) { return "Editing " + shortenPath(t.Input.FilePath) },
    "Write":      func(t) { return "Writing " + shortenPath(t.Input.FilePath) },
    "MultiEdit":  func(t) { return "Editing " + shortenPath(t.Input.FilePath) },
    "Bash":       func(t) { return "Running " + truncate(t.Input.Command, 40) },
    "Glob":       func(t) { return "Searching " + truncate(t.Input.Pattern, 40) },
    "Grep":       func(t) { return "Searching for " + truncate(t.Input.Pattern, 30) },
    "Agent":      func(t) { return "Running subagent" },
    "Task":       func(t) { return "Running subagent" },
    "WebFetch":   func(t) { return "Fetching " + truncate(t.Input.URL, 40) },
    "WebSearch":  func(t) { return "Searching web" },
    "TodoWrite":  func(t) { return "Updating todos" },
    "TodoRead":   func(t) { return "Reading todos" },
}
// Default for unknown tools: "Using {toolName}"
```

For non-tool content blocks:
- `thinking` → "Thinking..."
- `text` → "" (idle, no activity to show)

### Subagent Handling

When main session's last entry is `tool_use` for `Task`/`Agent` (subagent spawn):
- Session state = `working` as long as subagent files are being written
- Activity display = "Running subagent"
- Token tracking: subagent tokens counted separately in cost analytics (existing UsageScanner behavior)
- Context window: only main session context shown (subagents have independent context)

## New WebSocket Message Types

### `session_state` (replaces role of `sessions` for state)

Sent by agent whenever merged state changes (debounced, not on every JSONL line).

```typescript
interface SessionStateMessage {
  type: "session_state";
  session: string;             // tmux session name
  claudeSessionId: string;     // UUID
  state: SessionState;         // Merged state (JSONL + tmux)
  currentActivity: string;     // "Reading src/lib/agent.ts", "Thinking..."
  toolName: string;            // Last tool: "Read", "Bash", "Edit", etc.
  model: string;               // "claude-opus-4-6" (sent once, then only on change)
  contextTokens: number;       // input_tokens from last usage entry (approximate context fill)
  contextLimit: number;        // Model context limit (200000, 1000000)
  compactionCount: number;     // Number of summary entries
  inputTokens: number;         // Session total (deduplicated sum)
  outputTokens: number;        // Session total (deduplicated sum)
  cacheReadTokens: number;     // Session total
  cacheCreateTokens: number;   // Session total
}
```

Note: `contextTokens` is approximate. `input_tokens` from the API includes system prompt + conversation + tool results, which is close to but not identical to actual context fill. Displayed with "~" prefix in UI.

### `session_event` (notification triggers)

Sent on discrete events that warrant user notification:

```typescript
interface SessionEventMessage {
  type: "session_event";
  session: string;             // tmux session name
  event: "error" | "rate_limit" | "compaction";
  message: string;             // Human-readable: "Build failed: exit code 1"
  timestamp: number;           // Unix ms
}
```

### Model Context Limits

```go
var modelContextLimits = map[string]int{
    "claude-opus-4-6":   1_000_000,
    "claude-opus-4-5":   200_000,
    "claude-sonnet-4-6": 1_000_000,
    "claude-sonnet-4-5": 200_000,
    "claude-haiku-4-5":  200_000,
}
// Default: 200_000 for unknown models
// Requires agent update when new models are released
```

## Dashboard Integration

### Message Flow

```
Agent                        Dashboard server.ts            Browser
  │                                │                          │
  │── session_state ──────────────►│── forward to WS ────────►│
  │── session_event ──────────────►│── forward to WS ────────►│
  │── sessions (tmux, existing) ──►│── forward (unchanged) ──►│
  │── usage_entries (existing) ───►│── forward (unchanged) ──►│
```

`server.ts` / `agent-manager.ts` forwards `session_state` and `session_event` messages to the browser WS connection the same way it currently forwards `sessions` and `usage_entries`. No special handling needed — the agent-to-browser proxy is message-type-agnostic.

### `useSessionState` hook changes

Extend `ServerStatus` to include JSONL-derived data:

```typescript
interface SessionInfo {
  // Existing fields (from tmux polling)
  id: string;
  name: string;
  state: SessionState;
  workdir: string;
  created: number;
  stateChangedAt: number;
  lastLine: string;

  // NEW fields (from session_state messages)
  claudeSessionId?: string;
  currentActivity?: string;
  toolName?: string;
  model?: string;
  contextTokens?: number;
  contextLimit?: number;
  compactionCount?: number;
}
```

The hook merges `session_state` messages into the existing `SessionInfo` by matching on `session` (tmux session name). Fields from `session_state` override when present.

### `useNotification` hook changes

Add handler for `session_event` messages:

```typescript
// In useNotification, alongside existing state-change detection:
case "session_event":
  const { event, message, session } = msg;
  if (event === "error") playAlert(); showBrowserNotif(`Tool error: ${message}`);
  if (event === "rate_limit") playAlert(); showBrowserNotif(`Rate limited: ${message}`);
  if (event === "compaction") playInfo(); showBrowserNotif(`Context compacted`);
```

### DB Persistence

Dashboard persists `Session` model on `session_created` (receives `claudeSessionId`). Snapshots are saved by the dashboard when it receives `session_state` messages, throttled to max once per 30s per session + on key events.

## Context Window Tracker UI

### Sub-header Strip

New row below the main session header. Always visible when session is open. Only renders when `contextTokens` data is available (i.e., JSONL watcher is active).

```
┌─────────────────────────────────────────────────────────────┐
│ ← Overview │ my-project  @ server-1          ● Working    ✕ │  ← existing header
├─────────────────────────────────────────────────────────────┤
│ opus-4-6 · Reading src/lib/agent.ts   ctx ████░░ ~134k/200k · 2× compact │  ← NEW
├─────────────────────────────────────────────────────────────┤
│                    [ terminal ]                              │
└─────────────────────────────────────────────────────────────┘
```

Hidden on mobile (insufficient width). Falls back gracefully when no JSONL data available.

### Context Bar Colors

| Range | Color | Meaning |
|-------|-------|---------|
| 0-50% | Green (#238636) | Healthy |
| 50-80% | Green→Yellow gradient | Getting full |
| 80-100% | Yellow→Red gradient | Critical, compaction soon |

### Hover Tooltip

On hover over context area, shows dropdown with:
- Large progress bar with percentage
- Approximate total: "~134k / 200k tokens"
- Breakdown by category with colored markers:
  - Tool outputs (red #da3633)
  - Thinking (purple #a371f7)
  - Messages (blue #58a6ff)
  - CLAUDE.md (green #3fb950)
- Stacked bar showing proportions
- Footer: compaction count

All numbers displayed with `~` prefix (estimates).

### Token Breakdown Estimation

Context breakdown categories are **estimated** from JSONL data:
- **CLAUDE.md**: Estimated from known CLAUDE.md file sizes (agent reads these once at session start, char/4)
- **Tool outputs**: Sum of estimated tokens from `tool_result` content (char/4)
- **Thinking**: Sum of estimated `thinking` block tokens (char/4)
- **Messages**: Remainder (contextTokens - tool outputs - thinking - CLAUDE.md)

These are rough estimates using char/4 heuristic (same as claude-devtools). Not exact.

## Notifications

### New Triggers from JSONL

| Trigger | Detection | Sound | Browser Notification |
|---------|-----------|-------|---------------------|
| Error in tool | `is_error: true` in tool_result | alert.wav | "Tool error in {sessionName}" |
| Rate limit | "rate limit" or "exceeded" pattern in tool_result content | alert.wav | "Rate limited: {sessionName}" |
| Compaction | New `summary` entry with `isCompactSummary: true` | new info sound | "Context compacted: {sessionName}" |

### Existing Triggers (unchanged)

| Trigger | Detection | Sound | Browser Notification |
|---------|-----------|-------|---------------------|
| Session done | working → idle | done.wav | "Session done" |
| Needs attention | any → needs_attention | alert.wav | "Needs attention" |

## Database Schema Changes

### New Models

```prisma
model Session {
  id              String    @id @default(cuid())
  tmuxSessionName String
  claudeSessionId String    // UUID passed via --session-id
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

Model name stored on `Session.model` is not needed — the `session_state` message carries it for real-time display, and we don't need it persisted (it doesn't change within a session and has no analytics value beyond real-time).

### Snapshot Strategy

- Save snapshot on **state changes** and **key events** (compaction, error, rate limit)
- Throttle: max 1 snapshot per 30 seconds per session even during rapid state changes
- Dashboard loads latest snapshot on reconnect for instant UI restore
- Pruning: keep last 24h or last 100 per session (whichever is less)

### Migration

- Add `Session` and `SessionSnapshot` models
- Add `sessions` relation to `User` and `Server` models
- Non-breaking: existing models unchanged

## Branch & CI Strategy

### Branch: `release/v2`

```
master (v1.x.x) ──────────────────────────►
       \
        └── release/v2 ────────────────────►
              │ (all v2 development here)
              │
              ├─ If successful: release/v2 becomes master, old master archived
              └─ If abandoned: cherry-pick individual improvements back to master as v1.x.x
```

### CI Changes

New workflow `ci-v2.yml`:

```yaml
name: CI v2
on:
  push:
    branches: [release/v2]

jobs:
  build-agent:
    # Same as release.yml build steps but no upload/release
  build-dashboard:
    # Docker build without push (just verify it builds)
  test-agent:
    # make test
```

Existing `release.yml` unchanged — triggers on `v*` tags for both v1.x and v2.x releases.

### Versioning

- Current: `v1.22.2`
- First v2 tag: `v2.0.0-alpha.1` (pre-release, for testing)
- Stable: `v2.0.0`

## Performance Considerations

1. **Incremental parsing only** — never re-read entire JSONL files
2. **Debounce file events** — 100ms coalesce, don't react to every byte
3. **Pending buffer** — handle partial lines without data loss
4. **Deduplication** — streaming entries with same requestId produce only one state update
5. **Snapshot throttle** — max 1 DB write per 30s per session
6. **Context breakdown** — estimated via char/4 heuristic, no tokenizer dependency
7. **Watch scope** — only watch directories for sessions we manage (not all of `~/.claude/`)
8. **Memory** — agent keeps only current state per session, history in DB snapshots
9. **macOS catch-up** — 30s scan compensates for FSEvents lower granularity

## Out of Scope for v2.0.0

- Subagent timeline visualization
- Configurable notification triggers (hardcoded set only)
- Token breakdown by exact tokenizer (estimates only)
- JSONL replay / session playback
- Cost analytics changes (existing UsageScanner stays)
- Legacy session mapping (pre-v2 sessions without --session-id)
