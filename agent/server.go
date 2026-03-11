package main

import (
	"encoding/base64"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

// JSONLSessionState tracks JSONL-derived state for a single tmux session.
type JSONLSessionState struct {
	Entries        []*JSONLEntry // last 20 entries for state detection
	Dedup          *Deduplicator
	State          SessionState
	Activity       string
	ToolName       string
	Model          string
	CompactCount   int
	ErrorDetected  bool
	RateLimited    bool
	MaxInputTokens int // track max for context limit auto-detection
}

// safeConn wraps a websocket.Conn with a mutex to prevent concurrent writes.
type safeConn struct {
	*websocket.Conn
	wmu sync.Mutex
}

func (c *safeConn) safeWrite(messageType int, data []byte) error {
	c.wmu.Lock()
	defer c.wmu.Unlock()
	c.Conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
	err := c.Conn.WriteMessage(messageType, data)
	c.Conn.SetWriteDeadline(time.Time{})
	return err
}

// Client → Agent messages
type ClientMessage struct {
	Type                       string `json:"type"`
	SessionID                  string `json:"session_id,omitempty"`
	Workdir                    string `json:"workdir,omitempty"`
	Name                       string `json:"name,omitempty"`
	Data                       string `json:"data,omitempty"` // base64
	Cols                       int    `json:"cols,omitempty"`
	Rows                       int    `json:"rows,omitempty"`
	DangerouslySkipPermissions bool   `json:"dangerously_skip_permissions,omitempty"`
}

// Agent → Client messages
type ServerMessage struct {
	Type            string         `json:"type"`
	Sessions        []*SessionInfo `json:"sessions"`
	Session         string         `json:"session_id,omitempty"`
	Name            string         `json:"name,omitempty"`
	ClaudeSessionID string         `json:"claude_session_id,omitempty"`
	Data            string         `json:"data,omitempty"`
	Hostname        string         `json:"hostname,omitempty"`
	OS              string         `json:"os,omitempty"`
	Version         string         `json:"version,omitempty"`
	Dirs            []string       `json:"dirs,omitempty"`
	Message         string         `json:"message,omitempty"`

	// System metrics (included with machine_info)
	CpuPercent float64 `json:"cpu_percent,omitempty"`
	MemTotal   uint64  `json:"mem_total,omitempty"`
	MemUsed    uint64  `json:"mem_used,omitempty"`
	DiskTotal  uint64  `json:"disk_total,omitempty"`
	DiskUsed   uint64  `json:"disk_used,omitempty"`
	UptimeSecs uint64  `json:"uptime_secs,omitempty"`
	LoadAvg    float64 `json:"load_avg,omitempty"`

	// JSONL-derived session state fields
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
	Timestamp         int64  `json:"timestamp,omitempty"`
}

// UsageMessage is sent to subscribers when new usage entries are available.
type UsageMessage struct {
	Type    string       `json:"type"`
	Entries []UsageEntry `json:"entries"`
}

type Server struct {
	config   *Config
	poller   *Poller
	usage    *UsageScanner
	upgrader websocket.Upgrader

	mu          sync.Mutex
	subscribers map[*safeConn]bool

	sessionMap   *SessionMap
	jsonlWatcher *JSONLWatcher
	jsonlStates  map[string]*JSONLSessionState
	jsonlMu      sync.RWMutex
}

func newServer(config *Config, poller *Poller) *Server {
	s := &Server{
		config:      config,
		poller:      poller,
		subscribers: make(map[*safeConn]bool),
		upgrader: websocket.Upgrader{
			CheckOrigin: func(_ *http.Request) bool {
				return true // Auth handled post-upgrade via first WS message
			},
		},
	}

	poller.onChange = func(sessions []*SessionInfo) {
		s.broadcastSessions(sessions)
	}

	// Usage scanner — reads JSONL logs and broadcasts new entries.
	s.usage = newUsageScanner(poller)
	s.usage.onChange = func(entries []UsageEntry) {
		s.broadcastUsageEntries(entries)
	}
	s.usage.Start(10 * time.Second)

	go s.metricsBroadcastLoop()

	return s
}

func (s *Server) isAllowedWorkdir(workdir string) bool {
	dirs := s.config.ExpandWorkdirs()
	if len(dirs) == 0 {
		return true // no restriction configured
	}
	clean := filepath.Clean(workdir)
	for _, allowed := range dirs {
		allowedClean := filepath.Clean(allowed)
		if clean == allowedClean || strings.HasPrefix(clean, allowedClean+string(filepath.Separator)) {
			return true
		}
	}
	return false
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/ws", s.handleWebSocket)
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
	})
	return mux
}

func (s *Server) handleWebSocket(w http.ResponseWriter, r *http.Request) {
	raw, err := s.upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("ws upgrade: %v", err)
		return
	}
	defer raw.Close()

	conn := &safeConn{Conn: raw}

	// First message must be auth
	if s.config.Token != "" {
		_, data, err := conn.ReadMessage()
		if err != nil {
			return
		}
		var msg ClientMessage
		if err := json.Unmarshal(data, &msg); err != nil || msg.Type != "auth" || msg.Data != s.config.Token {
			s.sendError(conn, "unauthorized")
			return
		}
	}

	isFirstSubscriber := s.subscriberCount() == 0
	s.addSubscriber(conn)
	defer s.removeSubscriber(conn)

	// Send initial state
	sessions := s.poller.GetSessions()
	s.sendMessage(conn, ServerMessage{Type: "sessions", Sessions: sessions})

	// Rescan usage files only for the first subscriber so it gets historical data.
	// Subsequent connections reuse the already-scanned offsets.
	if isFirstSubscriber {
		go s.usage.RescanAll()
	}

	var terminal *TerminalSession

	defer func() {
		if terminal != nil {
			terminal.Close()
		}
	}()

	for {
		_, data, err := conn.ReadMessage()
		if err != nil {
			return
		}

		var msg ClientMessage
		if err := json.Unmarshal(data, &msg); err != nil {
			s.sendError(conn, "invalid message")
			continue
		}

		switch msg.Type {
		case "list_sessions":
			sessions := s.poller.GetSessions()
			s.sendMessage(conn, ServerMessage{Type: "sessions", Sessions: sessions})

		case "create_session":
			workdir := msg.Workdir
			if workdir == "" {
				home, _ := os.UserHomeDir()
				workdir = home
			}
			// Expand ~ to home directory (exec.Command doesn't do shell expansion)
			if len(workdir) > 0 && workdir[0] == '~' {
				home, _ := os.UserHomeDir()
				workdir = home + workdir[1:]
			}
			if !s.isAllowedWorkdir(workdir) {
				s.sendError(conn, "workdir not allowed")
				continue
			}
			name := msg.Name
			if name == "" {
				name = "session"
			}
			sessionID, claudeUUID, err := createTmuxSession(name, workdir, s.config.HistoryLimit, msg.DangerouslySkipPermissions)
			if err != nil {
				log.Printf("create_session error: %v", err)
				s.sendError(conn, "failed to create session")
				continue
			}
			s.poller.TrackSession(sessionID, workdir)
			s.sessionMap.Set(sessionID, claudeUUID, workdir)

			// Start watching JSONL file for this session
			homeDir, _ := os.UserHomeDir()
			jsonlPath := s.sessionMap.JSONLPath(sessionID, homeDir)
			if s.jsonlWatcher != nil && jsonlPath != "" {
				s.jsonlWatcher.WatchSession(jsonlPath)
			}

			s.sendMessage(conn, ServerMessage{
				Type:            "session_created",
				Session:         sessionID,
				Name:            name,
				ClaudeSessionID: claudeUUID,
			})

		case "kill_session":
			if msg.SessionID == "" {
				s.sendError(conn, "session_id required")
				continue
			}
			log.Printf("kill_session: %q", msg.SessionID)
			if err := killTmuxSession(msg.SessionID); err != nil {
				log.Printf("kill_session error: %v", err)
				s.sendError(conn, "failed to kill session")
			} else {
				log.Printf("kill_session: success")
				s.poller.RemoveSession(msg.SessionID)
				s.sessionMap.Delete(msg.SessionID)
				s.jsonlMu.Lock()
				delete(s.jsonlStates, msg.SessionID)
				s.jsonlMu.Unlock()
				s.broadcastSessions(s.poller.GetSessions())
			}

		case "attach":
			if msg.SessionID == "" {
				s.sendError(conn, "session_id required")
				continue
			}
			if terminal != nil {
				terminal.Close()
			}
			terminal = newTerminalSession()
			cols := uint16(msg.Cols)
			rows := uint16(msg.Rows)
			if err := terminal.Attach(msg.SessionID, cols, rows); err != nil {
				s.sendError(conn, err.Error())
				terminal = nil
				continue
			}
			// Start reading from PTY
			go s.readPTY(conn, terminal)

		case "detach":
			if terminal != nil {
				terminal.Detach()
				terminal = nil
			}

		case "input":
			if terminal == nil {
				continue
			}
			decoded, err := base64.StdEncoding.DecodeString(msg.Data)
			if err != nil {
				continue
			}
			terminal.Write(decoded)

		case "resize":
			if terminal == nil {
				continue
			}
			if msg.Cols > 0 && msg.Rows > 0 {
				terminal.Resize(uint16(msg.Cols), uint16(msg.Rows))
			}

		case "machine_info":
			hostname, _ := os.Hostname()
			m := CollectMetrics()
			s.sendMessage(conn, ServerMessage{
				Type:       "machine_info",
				Hostname:   hostname,
				OS:         runtime.GOOS + "/" + runtime.GOARCH,
				Version:    version,
				Dirs:       s.config.ExpandWorkdirs(),
				CpuPercent: m.CpuPercent,
				MemTotal:   m.MemTotal,
				MemUsed:    m.MemUsed,
				DiskTotal:  m.DiskTotal,
				DiskUsed:   m.DiskUsed,
				UptimeSecs: m.UptimeSecs,
				LoadAvg:    m.LoadAvg,
			})

		case "self_update":
			go func() {
				log.Println("Self-update requested via WebSocket")
				s.sendMessage(conn, ServerMessage{Type: "update_status", Message: "downloading"})
				if err := selfUpdate(); err != nil {
					log.Printf("Self-update failed: %v", err)
					s.sendMessage(conn, ServerMessage{Type: "update_status", Message: "error: " + err.Error()})
					return
				}
				s.sendMessage(conn, ServerMessage{Type: "update_status", Message: "restarting"})
				log.Println("Self-update complete, exiting for restart")
				os.Exit(0)
			}()

		default:
			s.sendError(conn, "unknown message type: "+msg.Type)
		}
	}
}

func (s *Server) readPTY(conn *safeConn, terminal *TerminalSession) {
	// Buffer PTY output and flush at most every 16ms to reduce flickering
	buf := make([]byte, 32*1024)
	var accumulated []byte
	flushTicker := time.NewTicker(16 * time.Millisecond)
	defer flushTicker.Stop()

	dataCh := make(chan []byte, 64)
	doneCh := make(chan struct{})

	// Reader goroutine
	go func() {
		defer close(doneCh)
		for {
			n, err := terminal.Read(buf)
			if n > 0 {
				chunk := make([]byte, n)
				copy(chunk, buf[:n])
				dataCh <- chunk
			}
			if err != nil {
				if err != io.EOF && terminal.IsAttached() {
					log.Printf("pty read: %v", err)
				}
				return
			}
		}
	}()

	flush := func() {
		if len(accumulated) == 0 {
			return
		}
		encoded := base64.StdEncoding.EncodeToString(accumulated)
		s.sendMessage(conn, ServerMessage{
			Type: "output",
			Data: encoded,
		})
		accumulated = accumulated[:0]
	}

	for {
		select {
		case chunk, ok := <-dataCh:
			if !ok {
				flush()
				return
			}
			accumulated = append(accumulated, chunk...)
			// If buffer is large enough, flush immediately
			if len(accumulated) > 16*1024 {
				flush()
			}
		case <-flushTicker.C:
			flush()
		case <-doneCh:
			// Drain remaining
			for {
				select {
				case chunk := <-dataCh:
					accumulated = append(accumulated, chunk...)
				default:
					flush()
					return
				}
			}
		}
	}
}

func (s *Server) sendMessage(conn *safeConn, msg ServerMessage) {
	data, err := json.Marshal(msg)
	if err != nil {
		return
	}
	conn.safeWrite(websocket.TextMessage, data)
}

func (s *Server) sendError(conn *safeConn, message string) {
	s.sendMessage(conn, ServerMessage{Type: "error", Message: message})
}

func (s *Server) subscriberCount() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.subscribers)
}

func (s *Server) addSubscriber(conn *safeConn) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.subscribers[conn] = true
}

func (s *Server) removeSubscriber(conn *safeConn) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.subscribers, conn)
}

func (s *Server) metricsBroadcastLoop() {
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()

	// Prime the CPU delta tracker so the first real broadcast has data.
	CollectMetrics()

	for range ticker.C {
		s.broadcastMachineInfo()
	}
}

func (s *Server) broadcastMachineInfo() {
	hostname, _ := os.Hostname()
	m := CollectMetrics()

	msg := ServerMessage{
		Type:       "machine_info",
		Hostname:   hostname,
		OS:         runtime.GOOS + "/" + runtime.GOARCH,
		Version:    version,
		Dirs:       s.config.ExpandWorkdirs(),
		CpuPercent: m.CpuPercent,
		MemTotal:   m.MemTotal,
		MemUsed:    m.MemUsed,
		DiskTotal:  m.DiskTotal,
		DiskUsed:   m.DiskUsed,
		UptimeSecs: m.UptimeSecs,
		LoadAvg:    m.LoadAvg,
	}

	data, err := json.Marshal(msg)
	if err != nil {
		return
	}

	s.mu.Lock()
	subs := make([]*safeConn, 0, len(s.subscribers))
	for conn := range s.subscribers {
		subs = append(subs, conn)
	}
	s.mu.Unlock()

	for _, conn := range subs {
		if err := conn.safeWrite(websocket.TextMessage, data); err != nil {
			conn.Close()
		}
	}
}

func (s *Server) broadcastUsageEntries(entries []UsageEntry) {
	msg := UsageMessage{Type: "usage_entries", Entries: entries}
	data, err := json.Marshal(msg)
	if err != nil {
		return
	}

	s.mu.Lock()
	subs := make([]*safeConn, 0, len(s.subscribers))
	for conn := range s.subscribers {
		subs = append(subs, conn)
	}
	s.mu.Unlock()

	for _, conn := range subs {
		if err := conn.safeWrite(websocket.TextMessage, data); err != nil {
			conn.Close()
		}
	}
}

func (s *Server) broadcastSessions(sessions []*SessionInfo) {
	s.mu.Lock()
	subs := make([]*safeConn, 0, len(s.subscribers))
	for conn := range s.subscribers {
		subs = append(subs, conn)
	}
	s.mu.Unlock()

	msg := ServerMessage{Type: "sessions", Sessions: sessions}
	data, err := json.Marshal(msg)
	if err != nil {
		return
	}

	for _, conn := range subs {
		if err := conn.safeWrite(websocket.TextMessage, data); err != nil {
			conn.Close()
		}
	}
}

func (s *Server) broadcastSessionState(tmuxName string, state *JSONLSessionState) {
	claudeUUID, _, _ := s.sessionMap.Get(tmuxName)
	input, output, cacheRead, cacheCreate := state.Dedup.SessionTotals()
	contextTokens := state.Dedup.ContextTokens()

	msg := ServerMessage{
		Type:              "session_state",
		Session:           tmuxName,
		ClaudeSessionID:   claudeUUID,
		SessionState:      string(state.State),
		Activity:          state.Activity,
		ToolName:          state.ToolName,
		ContextTokens:     contextTokens,
		ContextLimit:      getContextLimit(state.MaxInputTokens),
		CompactionCount:   state.CompactCount,
		InputTokens:       input,
		OutputTokens:      output,
		CacheReadTokens:   cacheRead,
		CacheCreateTokens: cacheCreate,
	}

	s.mu.Lock()
	subs := make([]*safeConn, 0, len(s.subscribers))
	for conn := range s.subscribers {
		subs = append(subs, conn)
	}
	s.mu.Unlock()

	log.Printf("[jsonl] broadcastSessionState: session=%s state=%s ctx=%d/%d activity=%q subs=%d", tmuxName, state.State, contextTokens, getContextLimit(state.MaxInputTokens), state.Activity, len(subs))

	data, err := json.Marshal(msg)
	if err != nil {
		return
	}
	for _, conn := range subs {
		if err := conn.safeWrite(websocket.TextMessage, data); err != nil {
			conn.Close()
		}
	}
}

func (s *Server) broadcastSessionEvent(tmuxName string, event, message string) {
	msg := ServerMessage{
		Type:      "session_event",
		Session:   tmuxName,
		Event:     event,
		Message:   message,
		Timestamp: time.Now().UnixMilli(),
	}

	s.mu.Lock()
	subs := make([]*safeConn, 0, len(s.subscribers))
	for conn := range s.subscribers {
		subs = append(subs, conn)
	}
	s.mu.Unlock()

	data, err := json.Marshal(msg)
	if err != nil {
		return
	}
	for _, conn := range subs {
		if err := conn.safeWrite(websocket.TextMessage, data); err != nil {
			conn.Close()
		}
	}
}

func (s *Server) handleJSONLEvents(events []JSONLEvent, homeDir string) {
	pathToSession := s.sessionMap.PathPrefixMap(homeDir)

	bySession := make(map[string][]*JSONLEntry)
	for _, evt := range events {
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
	var pendingEvents []struct{ event, message string }

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
		// Track max input tokens for context limit detection
		if entry.Usage.InputTokens > state.MaxInputTokens {
			state.MaxInputTokens = entry.Usage.InputTokens
		}
		if entry.IsCompactSummary {
			state.CompactCount++
			pendingEvents = append(pendingEvents, struct{ event, message string }{"compaction", "Context was compacted"})
		}
		for _, block := range entry.ContentBlocks {
			if block.Type == "tool_result" && block.IsError {
				state.ErrorDetected = true
				pendingEvents = append(pendingEvents, struct{ event, message string }{"error", truncateStr(block.Content, 100)})
			}
			if block.Type == "tool_result" && containsRateLimit(block.Content) {
				state.RateLimited = true
				pendingEvents = append(pendingEvents, struct{ event, message string }{"rate_limit", "Rate limit detected"})
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

	stateCopy := *state
	s.jsonlMu.Unlock()

	for _, evt := range pendingEvents {
		s.broadcastSessionEvent(tmuxName, evt.event, evt.message)
	}
	s.broadcastSessionState(tmuxName, &stateCopy)
}

func containsRateLimit(content string) bool {
	lower := strings.ToLower(content)
	return strings.Contains(lower, "rate limit") || strings.Contains(lower, "rate_limit") ||
		(strings.Contains(lower, "exceeded") && strings.Contains(lower, "limit"))
}
