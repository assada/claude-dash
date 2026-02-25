//go:build darwin

package main

/*
#include <stdlib.h>
#include <mach/mach.h>
#include <mach/mach_host.h>
#include <mach/processor_info.h>
#include <mach/vm_statistics.h>
#include <sys/sysctl.h>
#include <sys/mount.h>

// mach_task_self() is a macro — wrap it for CGo.
static mach_port_t _mach_task_self() {
	return mach_task_self();
}
*/
import "C"

import (
	"os"
	"sync"
	"time"
	"unsafe"
)

var (
	prevCPUUser   uint64
	prevCPUSystem uint64
	prevCPUIdle   uint64
	cpuMu         sync.Mutex
	cpuInited     bool
)

func collectCPUPercent() float64 {
	cpuMu.Lock()
	defer cpuMu.Unlock()

	var count C.mach_msg_type_number_t
	var cpuLoad C.processor_cpu_load_info_t
	var numCPUs C.natural_t

	ret := C.host_processor_info(
		C.mach_host_self(),
		C.PROCESSOR_CPU_LOAD_INFO,
		&numCPUs,
		(*C.processor_info_array_t)(unsafe.Pointer(&cpuLoad)),
		&count,
	)
	if ret != C.KERN_SUCCESS {
		return 0
	}
	defer C.vm_deallocate(
		C._mach_task_self(),
		C.vm_address_t(uintptr(unsafe.Pointer(cpuLoad))),
		C.vm_size_t(count)*C.vm_size_t(unsafe.Sizeof(C.integer_t(0))),
	)

	var user, system, idle uint64
	cpus := unsafe.Slice(cpuLoad, int(numCPUs))
	for _, cpu := range cpus {
		user += uint64(cpu.cpu_ticks[C.CPU_STATE_USER]) + uint64(cpu.cpu_ticks[C.CPU_STATE_NICE])
		system += uint64(cpu.cpu_ticks[C.CPU_STATE_SYSTEM])
		idle += uint64(cpu.cpu_ticks[C.CPU_STATE_IDLE])
	}

	if !cpuInited {
		prevCPUUser, prevCPUSystem, prevCPUIdle = user, system, idle
		cpuInited = true
		return 0
	}

	du := user - prevCPUUser
	ds := system - prevCPUSystem
	di := idle - prevCPUIdle
	prevCPUUser, prevCPUSystem, prevCPUIdle = user, system, idle

	total := du + ds + di
	if total == 0 {
		return 0
	}
	return float64(du+ds) / float64(total) * 100
}

func collectMemInfo() (total, used uint64) {
	// Total memory via sysctl hw.memsize
	var memsize uint64
	size := C.size_t(unsafe.Sizeof(memsize))
	name := C.CString("hw.memsize")
	defer C.free(unsafe.Pointer(name))
	C.sysctlbyname(name, unsafe.Pointer(&memsize), &size, nil, 0)
	total = memsize

	// Used memory via Mach host_statistics64
	var vmstat C.vm_statistics64_data_t
	vmCount := C.mach_msg_type_number_t(C.HOST_VM_INFO64_COUNT)
	ret := C.host_statistics64(
		C.mach_host_self(),
		C.HOST_VM_INFO64,
		(*C.integer_t)(unsafe.Pointer(&vmstat)),
		&vmCount,
	)
	if ret == C.KERN_SUCCESS {
		pageSize := uint64(os.Getpagesize())
		used = (uint64(vmstat.active_count) + uint64(vmstat.wire_count) + uint64(vmstat.compressor_page_count)) * pageSize
	}
	return
}

func collectDiskInfo() (total, used uint64) {
	var stat C.struct_statfs
	path := C.CString("/")
	defer C.free(unsafe.Pointer(path))
	if C.statfs(path, &stat) == 0 {
		total = uint64(stat.f_blocks) * uint64(stat.f_bsize)
		avail := uint64(stat.f_bavail) * uint64(stat.f_bsize)
		used = total - avail
	}
	return
}

func collectUptime() uint64 {
	var tv C.struct_timeval
	size := C.size_t(unsafe.Sizeof(tv))
	name := C.CString("kern.boottime")
	defer C.free(unsafe.Pointer(name))
	if C.sysctlbyname(name, unsafe.Pointer(&tv), &size, nil, 0) == 0 {
		boot := time.Unix(int64(tv.tv_sec), int64(tv.tv_usec)*1000)
		return uint64(time.Since(boot).Seconds())
	}
	return 0
}

func collectLoadAvg() float64 {
	var load [3]C.double
	if C.getloadavg(&load[0], 3) > 0 {
		return float64(load[0])
	}
	return 0
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
