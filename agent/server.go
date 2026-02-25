package main

import (
	"encoding/base64"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"os"
	"runtime"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

// Client → Agent messages
type ClientMessage struct {
	Type      string `json:"type"`
	SessionID string `json:"session_id,omitempty"`
	Workdir   string `json:"workdir,omitempty"`
	Name      string `json:"name,omitempty"`
	Data      string `json:"data,omitempty"` // base64
	Cols      int    `json:"cols,omitempty"`
	Rows      int    `json:"rows,omitempty"`
}

// Agent → Client messages
type ServerMessage struct {
	Type     string         `json:"type"`
	Sessions []*SessionInfo `json:"sessions,omitempty"`
	Session  string         `json:"session_id,omitempty"`
	Name     string         `json:"name,omitempty"`
	Data     string         `json:"data,omitempty"`
	Hostname string         `json:"hostname,omitempty"`
	OS       string         `json:"os,omitempty"`
	Dirs     []string       `json:"dirs,omitempty"`
	Message  string         `json:"message,omitempty"`
}

type Server struct {
	config     *Config
	poller     *Poller
	scrollback *ScrollbackManager
	upgrader   websocket.Upgrader

	mu          sync.Mutex
	subscribers map[*websocket.Conn]bool
}

func newServer(config *Config, poller *Poller, scrollback *ScrollbackManager) *Server {
	s := &Server{
		config:      config,
		poller:      poller,
		scrollback:  scrollback,
		subscribers: make(map[*websocket.Conn]bool),
		upgrader: websocket.Upgrader{
			CheckOrigin: func(r *http.Request) bool { return true },
		},
	}

	poller.onChange = func(sessions []*SessionInfo) {
		s.broadcastSessions(sessions)
	}

	return s
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
	if !checkAuth(r, s.config.Token) {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	conn, err := s.upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("ws upgrade: %v", err)
		return
	}
	defer conn.Close()

	s.addSubscriber(conn)
	defer s.removeSubscriber(conn)

	// Send initial state
	sessions := s.poller.GetSessions()
	s.sendMessage(conn, ServerMessage{Type: "sessions", Sessions: sessions})

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
			name := msg.Name
			if name == "" {
				name = "session"
			}
			sessionID, err := createTmuxSession(name, workdir, s.config.HistoryLimit)
			if err != nil {
				s.sendError(conn, err.Error())
				continue
			}
			s.poller.TrackSession(sessionID, workdir)
			s.sendMessage(conn, ServerMessage{
				Type:    "session_created",
				Session: sessionID,
				Name:    sessionID,
			})

		case "kill_session":
			if msg.SessionID == "" {
				s.sendError(conn, "session_id required")
				continue
			}
			if err := killTmuxSession(msg.SessionID); err != nil {
				s.sendError(conn, err.Error())
			}

		case "clear_dead_sessions":
			// Get dead session IDs before clearing
			sessions := s.poller.GetSessions()
			for _, sess := range sessions {
				if sess.State == StateDead {
					s.scrollback.RemoveScrollback(sess.ID)
				}
			}
			s.poller.ClearDeadSessions()
			// Broadcast updated state immediately
			s.broadcastSessions(s.poller.GetSessions())

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

		case "get_scrollback":
			if msg.SessionID == "" {
				s.sendError(conn, "session_id required")
				continue
			}
			text, err := s.scrollback.GetScrollback(msg.SessionID)
			if err != nil {
				s.sendError(conn, err.Error())
				continue
			}
			encoded := base64.StdEncoding.EncodeToString([]byte(text))
			s.sendMessage(conn, ServerMessage{
				Type: "scrollback",
				Data: encoded,
			})

		case "machine_info":
			hostname, _ := os.Hostname()
			s.sendMessage(conn, ServerMessage{
				Type:     "machine_info",
				Hostname: hostname,
				OS:       runtime.GOOS + "/" + runtime.GOARCH,
				Dirs:     s.config.ExpandWorkdirs(),
			})

		default:
			s.sendError(conn, "unknown message type: "+msg.Type)
		}
	}
}

func (s *Server) readPTY(conn *websocket.Conn, terminal *TerminalSession) {
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

func (s *Server) sendMessage(conn *websocket.Conn, msg ServerMessage) {
	data, err := json.Marshal(msg)
	if err != nil {
		return
	}
	conn.WriteMessage(websocket.TextMessage, data)
}

func (s *Server) sendError(conn *websocket.Conn, message string) {
	s.sendMessage(conn, ServerMessage{Type: "error", Message: message})
}

func (s *Server) addSubscriber(conn *websocket.Conn) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.subscribers[conn] = true
}

func (s *Server) removeSubscriber(conn *websocket.Conn) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.subscribers, conn)
}

func (s *Server) broadcastSessions(sessions []*SessionInfo) {
	s.mu.Lock()
	subs := make([]*websocket.Conn, 0, len(s.subscribers))
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
		conn.WriteMessage(websocket.TextMessage, data)
	}
}
