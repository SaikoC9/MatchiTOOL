package main

import (
	"strconv"
	"syscall"
)

// Safe kill rules (see DESIGN.md):
//  1. A process is named by PID + start time. Right before the signal the start time is read again; if it differs the PID now belongs
//     to another process and nothing is sent.
//  2. PID 1, PID 2, kernel threads (parent 2) and the guard itself are never signalled.
//  3. Signals go to single processes, never to "-1" or to a group we did not measure.
func killIdentity(root string, pid int, start uint64, sig syscall.Signal) bool {
	if pid <= 2 || pid == selfPID() {
		return false
	}
	b, err := readCap(root+"/proc/"+strconv.Itoa(pid)+"/stat", maxStat)
	if err != nil {
		return false
	}
	p, ok := parseStat(b)
	if !ok || p.Start != start || p.PPID == 2 {
		return false
	}
	return syscall.Kill(pid, sig) == nil
}

var killFn = killIdentity
var reniceFn = func(pid, n int) { _ = syscall.Setpriority(syscall.PRIO_PROCESS, pid, n) }
