//go:build darwin && !cgo

package main

import (
	"os/exec"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

var (
	prevLoadSample float64
	cpuMu          sync.Mutex
	cpuInited      bool
)

func sysctl(name string) string {
	out, err := exec.Command("sysctl", "-n", name).Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

func collectCPUPercent() float64 {
	// Without CGo we approximate CPU from load average
	cpuMu.Lock()
	defer cpuMu.Unlock()

	load := collectLoadAvg()
	if !cpuInited {
		prevLoadSample = load
		cpuInited = true
		return 0
	}
	prevLoadSample = load

	numCPU := float64(runtime.NumCPU())
	pct := load / numCPU * 100
	if pct > 100 {
		pct = 100
	}
	return pct
}

func collectMemInfo() (total, used uint64) {
	// Total via sysctl
	if v := sysctl("hw.memsize"); v != "" {
		total, _ = strconv.ParseUint(v, 10, 64)
	}

	// Used via vm_stat
	out, err := exec.Command("vm_stat").Output()
	if err != nil || total == 0 {
		return
	}

	pageSize := uint64(syscall.Getpagesize())
	var active, wired, compressed uint64
	for _, line := range strings.Split(string(out), "\n") {
		if v, ok := parseVmStatLine(line, "Pages active"); ok {
			active = v
		} else if v, ok := parseVmStatLine(line, "Pages wired down"); ok {
			wired = v
		} else if v, ok := parseVmStatLine(line, "Pages occupied by compressor"); ok {
			compressed = v
		}
	}
	used = (active + wired + compressed) * pageSize
	return
}

func parseVmStatLine(line, prefix string) (uint64, bool) {
	if !strings.HasPrefix(line, prefix) {
		return 0, false
	}
	parts := strings.Split(line, ":")
	if len(parts) < 2 {
		return 0, false
	}
	s := strings.TrimSpace(parts[1])
	s = strings.TrimSuffix(s, ".")
	v, err := strconv.ParseUint(s, 10, 64)
	if err != nil {
		return 0, false
	}
	return v, true
}

func collectDiskInfo() (total, used uint64) {
	var stat syscall.Statfs_t
	if err := syscall.Statfs("/", &stat); err != nil {
		return 0, 0
	}
	total = stat.Blocks * uint64(stat.Bsize)
	avail := stat.Bavail * uint64(stat.Bsize)
	used = total - avail
	return
}

func collectUptime() uint64 {
	// kern.boottime returns "{ sec = 1234567890, usec = 0 } ..."
	raw := sysctl("kern.boottime")
	if raw == "" {
		return 0
	}
	// Parse sec value
	idx := strings.Index(raw, "sec = ")
	if idx < 0 {
		return 0
	}
	rest := raw[idx+6:]
	end := strings.IndexByte(rest, ',')
	if end < 0 {
		return 0
	}
	sec, err := strconv.ParseInt(rest[:end], 10, 64)
	if err != nil {
		return 0
	}
	boot := time.Unix(sec, 0)
	return uint64(time.Since(boot).Seconds())
}

func collectLoadAvg() float64 {
	// vm.loadavg returns "{ 1.23 4.56 7.89 }"
	raw := sysctl("vm.loadavg")
	raw = strings.Trim(raw, "{ }")
	fields := strings.Fields(raw)
	if len(fields) < 1 {
		return 0
	}
	load, _ := strconv.ParseFloat(fields[0], 64)
	return load
}

// CollectMetrics gathers system CPU, memory, disk, uptime and load metrics.
func CollectMetrics() Metrics {
	memTotal, memUsed := collectMemInfo()
	diskTotal, diskUsed := collectDiskInfo()
	return Metrics{
		CpuPercent: collectCPUPercent(),
		MemTotal:   memTotal,
		MemUsed:    memUsed,
		DiskTotal:  diskTotal,
		DiskUsed:   diskUsed,
		UptimeSecs: collectUptime(),
		LoadAvg:    collectLoadAvg(),
	}
}
