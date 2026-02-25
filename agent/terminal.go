package main

import (
	"fmt"
	"os"
	"os/exec"
	"sync"

	"github.com/creack/pty"
)

type TerminalSession struct {
	mu        sync.Mutex
	ptyFile   *os.File
	cmd       *exec.Cmd
	sessionID string
	closed    bool
}

func newTerminalSession() *TerminalSession {
	return &TerminalSession{}
}

func (t *TerminalSession) Attach(sessionID string, cols, rows uint16) error {
	t.mu.Lock()
	defer t.mu.Unlock()

	if t.ptyFile != nil {
		return fmt.Errorf("already attached to %s", t.sessionID)
	}

	if cols == 0 {
		cols = 200
	}
	if rows == 0 {
		rows = 50
	}

	cmd := exec.Command("tmux", "attach-session", "-t", sessionID)
	cmd.Env = append(os.Environ(), "TERM=xterm-256color")

	ptmx, err := pty.StartWithSize(cmd, &pty.Winsize{
		Cols: cols,
		Rows: rows,
	})
	if err != nil {
		return fmt.Errorf("pty start: %w", err)
	}

	t.ptyFile = ptmx
	t.cmd = cmd
	t.sessionID = sessionID
	t.closed = false
	return nil
}

func (t *TerminalSession) Write(data []byte) (int, error) {
	t.mu.Lock()
	f := t.ptyFile
	t.mu.Unlock()

	if f == nil {
		return 0, fmt.Errorf("not attached")
	}
	return f.Write(data)
}

func (t *TerminalSession) Read(buf []byte) (int, error) {
	t.mu.Lock()
	f := t.ptyFile
	t.mu.Unlock()

	if f == nil {
		return 0, fmt.Errorf("not attached")
	}
	return f.Read(buf)
}

func (t *TerminalSession) Resize(cols, rows uint16) error {
	t.mu.Lock()
	f := t.ptyFile
	t.mu.Unlock()

	if f == nil {
		return fmt.Errorf("not attached")
	}
	return pty.Setsize(f, &pty.Winsize{Cols: cols, Rows: rows})
}

func (t *TerminalSession) Detach() error {
	t.mu.Lock()
	defer t.mu.Unlock()

	if t.ptyFile == nil || t.closed {
		return nil
	}

	t.closed = true

	// Send tmux detach key sequence (Ctrl-B D)
	t.ptyFile.Write([]byte{0x02}) // Ctrl-B
	t.ptyFile.Write([]byte("d"))  // d

	t.ptyFile.Close()
	t.ptyFile = nil

	if t.cmd != nil && t.cmd.Process != nil {
		t.cmd.Process.Kill()
		t.cmd.Wait()
	}
	t.cmd = nil
	t.sessionID = ""
	return nil
}

func (t *TerminalSession) Close() error {
	t.mu.Lock()
	defer t.mu.Unlock()

	if t.ptyFile == nil || t.closed {
		return nil
	}

	t.closed = true
	t.ptyFile.Close()
	t.ptyFile = nil

	if t.cmd != nil && t.cmd.Process != nil {
		t.cmd.Process.Kill()
		t.cmd.Wait()
	}
	t.cmd = nil
	return nil
}

func (t *TerminalSession) IsAttached() bool {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.ptyFile != nil && !t.closed
}

