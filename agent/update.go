package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"time"
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

	client := &http.Client{Timeout: 30 * time.Second}

	resp, err := client.Get("https://api.github.com/repos/" + updateRepo + "/releases/latest")
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

	dlResp, err := client.Get(downloadURL)
	if err != nil {
		tmpFile.Close()
		return fmt.Errorf("download binary: %w", err)
	}
	defer dlResp.Body.Close()

	written, err := io.Copy(tmpFile, dlResp.Body)
	if err != nil {
		tmpFile.Close()
		return fmt.Errorf("write binary: %w", err)
	}
	tmpFile.Close()

	const minBinarySize int64 = 1 * 1024 * 1024 // 1 MB
	if written < minBinarySize {
		return fmt.Errorf("downloaded file too small (%d bytes), likely not a valid binary", written)
	}
	log.Printf("self-update: downloaded %d bytes", written)

	// Verify SHA256 checksum against checksums.txt from release
	binaryName := "ccdash-agent-" + suffix
	if err := verifyChecksum(client, release, binaryName, tmpPath); err != nil {
		return fmt.Errorf("checksum verification failed: %w", err)
	}

	if err := os.Chmod(tmpPath, 0755); err != nil {
		return fmt.Errorf("chmod: %w", err)
	}

	// Replace current binary
	execPath, err := os.Executable()
	if err != nil {
		return fmt.Errorf("get executable path: %w", err)
	}

	if err := replaceBinary(tmpPath, execPath); err != nil {
		return err
	}

	return nil
}

func verifyChecksum(client *http.Client, release githubRelease, binaryName, filePath string) error {
	// Find checksums.txt in release assets
	var checksumsURL string
	for _, asset := range release.Assets {
		if asset.Name == "checksums.txt" {
			checksumsURL = asset.BrowserDownloadURL
			break
		}
	}
	if checksumsURL == "" {
		log.Println("self-update: no checksums.txt in release, skipping verification")
		return nil
	}

	resp, err := client.Get(checksumsURL)
	if err != nil {
		return fmt.Errorf("download checksums.txt: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("read checksums.txt: %w", err)
	}

	// Parse expected checksum for our binary
	var expectedHash string
	for _, line := range strings.Split(string(body), "\n") {
		parts := strings.Fields(line)
		if len(parts) == 2 && parts[1] == binaryName {
			expectedHash = parts[0]
			break
		}
	}
	if expectedHash == "" {
		return fmt.Errorf("no checksum found for %s in checksums.txt", binaryName)
	}

	// Compute actual hash
	f, err := os.Open(filePath)
	if err != nil {
		return fmt.Errorf("open file for hashing: %w", err)
	}
	defer f.Close()

	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return fmt.Errorf("hash file: %w", err)
	}
	actualHash := hex.EncodeToString(h.Sum(nil))

	if actualHash != expectedHash {
		return fmt.Errorf("SHA256 mismatch: expected %s, got %s", expectedHash, actualHash)
	}

	log.Printf("self-update: checksum verified (%s)", actualHash[:12])
	return nil
}

func replaceBinary(tmpPath, execPath string) error {
	// Try 1: direct rename (atomic, same filesystem)
	if err := os.Rename(tmpPath, execPath); err == nil {
		log.Println("self-update: replaced binary via rename")
		return nil
	}

	// Try 2: direct copy (cross-device fallback)
	if err := directCopy(tmpPath, execPath); err == nil {
		log.Println("self-update: replaced binary via copy")
		return nil
	}

	// Try 3: sudo (when binary is in root-owned directory)
	if err := sudoCopy(tmpPath, execPath); err == nil {
		log.Println("self-update: replaced binary via sudo")
		return nil
	}

	return fmt.Errorf("replace binary: all methods failed (rename, copy, sudo) — check permissions on %s", execPath)
}

func directCopy(srcPath, dstPath string) error {
	src, err := os.Open(srcPath)
	if err != nil {
		return err
	}
	defer src.Close()

	dst, err := os.OpenFile(dstPath, os.O_WRONLY|os.O_TRUNC, 0755)
	if err != nil {
		return err
	}

	if _, err := io.Copy(dst, src); err != nil {
		dst.Close()
		return err
	}
	return dst.Close()
}

func sudoCopy(srcPath, dstPath string) error {
	log.Println("self-update: trying sudo for binary replacement")

	out, err := exec.Command("sudo", "-n", "cp", "-f", srcPath, dstPath).CombinedOutput()
	if err != nil {
		return fmt.Errorf("sudo cp: %s: %w", strings.TrimSpace(string(out)), err)
	}

	out, err = exec.Command("sudo", "-n", "chmod", "0755", dstPath).CombinedOutput()
	if err != nil {
		return fmt.Errorf("sudo chmod: %s: %w", strings.TrimSpace(string(out)), err)
	}

	return nil
}
