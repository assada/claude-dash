//go:build linux

package main

import (
	"bufio"
	"os"
	"strconv"
	"strings"
	"sync"
	"syscall"
)

var (
	prevCPUUser   uint64
	prevCPUNice   uint64
	prevCPUSystem uint64
	prevCPUIdle   uint64
	prevCPUIowait uint64
	cpuMu         sync.Mutex
	cpuInited     bool
)

func collectCPUPercent() float64 {
	cpuMu.Lock()
	defer cpuMu.Unlock()

	f, err := os.Open("/proc/stat")
	if err != nil {
		return 0
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	if !scanner.Scan() {
		return 0
	}
	// First line: "cpu  user nice system idle iowait irq softirq steal ..."
	fields := strings.Fields(scanner.Text())
	if len(fields) < 5 || fields[0] != "cpu" {
		return 0
	}

	user, _ := strconv.ParseUint(fields[1], 10, 64)
	nice, _ := strconv.ParseUint(fields[2], 10, 64)
	system, _ := strconv.ParseUint(fields[3], 10, 64)
	idle, _ := strconv.ParseUint(fields[4], 10, 64)
	var iowait uint64
	if len(fields) > 5 {
		iowait, _ = strconv.ParseUint(fields[5], 10, 64)
	}

	if !cpuInited {
		prevCPUUser, prevCPUNice, prevCPUSystem, prevCPUIdle, prevCPUIowait = user, nice, system, idle, iowait
		cpuInited = true
		return 0
	}

	du := (user + nice) - (prevCPUUser + prevCPUNice)
	ds := system - prevCPUSystem
	di := (idle + iowait) - (prevCPUIdle + prevCPUIowait)
	prevCPUUser, prevCPUNice, prevCPUSystem, prevCPUIdle, prevCPUIowait = user, nice, system, idle, iowait

	total := du + ds + di
	if total == 0 {
		return 0
	}
	return float64(du+ds) / float64(total) * 100
}

func collectMemInfo() (total, used uint64) {
	var info syscall.Sysinfo_t
	if err := syscall.Sysinfo(&info); err != nil {
		return 0, 0
	}
	unit := uint64(info.Unit)
	total = info.Totalram * unit
	free := info.Freeram * unit
	buffers := info.Bufferram * unit
	used = total - free - buffers
	return
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
	var info syscall.Sysinfo_t
	if err := syscall.Sysinfo(&info); err != nil {
		return 0
	}
	return uint64(info.Uptime)
}

func collectLoadAvg() float64 {
	data, err := os.ReadFile("/proc/loadavg")
	if err != nil {
		return 0
	}
	fields := strings.Fields(string(data))
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
