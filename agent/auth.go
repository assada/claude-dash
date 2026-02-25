package main

import (
	"net/http"
	"strings"
)

func checkAuth(r *http.Request, token string) bool {
	if token == "" {
		return true // No auth configured
	}

	// Check Authorization header
	auth := r.Header.Get("Authorization")
	if strings.HasPrefix(auth, "Bearer ") {
		if strings.TrimPrefix(auth, "Bearer ") == token {
			return true
		}
	}

	// Check query parameter (for WebSocket clients that can't set headers)
	if r.URL.Query().Get("token") == token {
		return true
	}

	return false
}
