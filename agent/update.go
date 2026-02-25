package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"runtime"
	"strings"
)

const updateRepo = "assada/claude-dash"

type githubRelease struct {
	TagName string `json:"tag_name"`
	Assets  []struct {
		Name               string `json:"name"`
		BrowserDownloadURL string `json:"browser_download_url"`
	} `json:"assets"`
}

func selfUpdate() error {
	suffix := runtime.GOOS + "-" + runtime.GOARCH

	resp, err := http.Get("https://api.github.com/repos/" + updateRepo + "/releases/latest")
	if err != nil {
		return fmt.Errorf("fetch release: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return fmt.Errorf("github API returned %d", resp.StatusCode)
	}

	var release githubRelease
	if err := json.NewDecoder(resp.Body).Decode(&release); err != nil {
		return fmt.Errorf("parse release: %w", err)
	}

	var downloadURL string
	for _, asset := range release.Assets {
		if strings.Contains(asset.Name, suffix) {
			downloadURL = asset.BrowserDownloadURL
			break
		}
	}
	if downloadURL == "" {
		return fmt.Errorf("no binary for %s in release %s", suffix, release.TagName)
	}

	// Download to temp file
	tmpFile, err := os.CreateTemp("", "ccdash-agent-update-*")
	if err != nil {
		return fmt.Errorf("create temp: %w", err)
	}
	tmpPath := tmpFile.Name()
	defer os.Remove(tmpPath)

	dlResp, err := http.Get(downloadURL)
	if err != nil {
		tmpFile.Close()
		return fmt.Errorf("download binary: %w", err)
	}
	defer dlResp.Body.Close()

	if _, err := io.Copy(tmpFile, dlResp.Body); err != nil {
		tmpFile.Close()
		return fmt.Errorf("write binary: %w", err)
	}
	tmpFile.Close()

	if err := os.Chmod(tmpPath, 0755); err != nil {
		return fmt.Errorf("chmod: %w", err)
	}

	// Replace current binary
	execPath, err := os.Executable()
	if err != nil {
		return fmt.Errorf("get executable path: %w", err)
	}

	// Try direct rename (same filesystem)
	if err := os.Rename(tmpPath, execPath); err != nil {
		// Cross-device: read+write
		src, err2 := os.Open(tmpPath)
		if err2 != nil {
			return fmt.Errorf("open temp: %w", err2)
		}
		defer src.Close()
		dst, err2 := os.OpenFile(execPath, os.O_WRONLY|os.O_TRUNC, 0755)
		if err2 != nil {
			return fmt.Errorf("open dest (may need sudo): %w", err2)
		}
		if _, err2 := io.Copy(dst, src); err2 != nil {
			dst.Close()
			return fmt.Errorf("copy binary: %w", err2)
		}
		dst.Close()
	}

	return nil
}
