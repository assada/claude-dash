package main

// Metrics holds system-level telemetry collected periodically.
type Metrics struct {
	CpuPercent float64
	MemTotal   uint64
	MemUsed    uint64
	DiskTotal  uint64
	DiskUsed   uint64
	UptimeSecs uint64
	LoadAvg    float64
}
