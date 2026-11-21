package main

import (
	"errors"
	"os"
	"strconv"
	"strings"
	"time"
)

// Bounded /proc access. Nothing here reads to end-of-file: a read stops at a byte cap, and reads that can hang (environ) also stop at a
// deadline. This is the rule that keeps a /proc/PID/cmdline that never ends (seen on the MU300 kernel) from pinning a CPU.

const (
	clkTck      = 100 // USER_HZ on Linux and Android
	maxStat     = 1024
	maxEnviron  = 16384
	readTimeout = 300 * time.Millisecond
	tagVar      = "MATCHI_PLUGIN"
)

var errTimeout = errors.New("read timed out")

// procInfo is one line of /proc/PID/stat.
type procInfo struct {
	PID, PPID, PGID int
	Comm            string
	State           byte
	Ticks           uint64 // utime + stime
	Start           uint64 // start time in ticks since boot: with PID it identifies a process for good
	RSSPages        int64
}

// readCap reads at most max bytes and never waits for end-of-file.
func readCap(path string, max int) ([]byte, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	buf := make([]byte, max)
	n := 0
	for n < max {
		m, err := f.Read(buf[n:])
		n += m
		if err != nil || m == 0 {
			break
		}
	}
	return buf[:n], nil
}

// readBounded is readCap with a deadline. On timeout the reader is abandoned (it ends when the read returns).
func readBounded(path string, max int, d time.Duration) ([]byte, error) {
	type res struct {
		b   []byte
		err error
	}
	ch := make(chan res, 1)
	go func() { b, err := readCap(path, max); ch <- res{b, err} }()
	select {
	case r := <-ch:
		return r.b, r.err
	case <-time.After(d):
		return nil, errTimeout
	}
}

// parseStat reads /proc/PID/stat. The name sits between the first "(" and the LAST ")" because it may hold spaces and brackets.
func parseStat(b []byte) (procInfo, bool) {
	s := string(b)
	l, r := strings.IndexByte(s, '('), strings.LastIndexByte(s, ')')
	if l < 1 || r < l {
		return procInfo{}, false
	}
	var p procInfo
	var err error
	if p.PID, err = strconv.Atoi(strings.TrimSpace(s[:l])); err != nil {
		return procInfo{}, false
	}
	p.Comm = s[l+1 : r]
	f := strings.Fields(s[r+1:]) // f[0] is field 3 (state), so field n is f[n-3]
	if len(f) < 22 {
		return procInfo{}, false
	}
	p.State = f[0][0]
	num := func(n int) uint64 { v, _ := strconv.ParseUint(f[n-3], 10, 64); return v }
	p.PPID, p.PGID = int(num(4)), int(num(5))
	p.Ticks = num(14) + num(15)
	p.Start = num(22)
	if len(f) > 21 {
		v, _ := strconv.ParseInt(f[21], 10, 64) // field 24
		p.RSSPages = v
	}
	return p, true
}

// scanProcs lists every process with one small read each.
func scanProcs(root string) []procInfo {
	d, err := os.Open(root + "/proc")
	if err != nil {
		return nil
	}
	names, _ := d.Readdirnames(-1)
	d.Close()
	out := make([]procInfo, 0, len(names))
	for _, n := range names {
		if n == "" || n[0] < '1' || n[0] > '9' {
			continue
		}
		b, err := readCap(root+"/proc/"+n+"/stat", maxStat)
		if err != nil {
			continue
		}
		if p, ok := parseStat(b); ok {
			out = append(out, p)
		}
	}
	return out
}

func readUptime(root string) float64 {
	b, err := readCap(root+"/proc/uptime", 64)
	if err != nil {
		return 0
	}
	f := strings.Fields(string(b))
	if len(f) == 0 {
		return 0
	}
	v, _ := strconv.ParseFloat(f[0], 64)
	return v
}

// validName: a plugin name is letters, digits, "_", "." or "-", 1 to 40 characters (never a path or a shell word).
func validName(s string) bool {
	if s == "" || len(s) > 40 {
		return false
	}
	for _, c := range s {
		if !(c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c == '_' || c == '.' || c == '-') {
			return false
		}
	}
	return true
}

// parseTag finds MATCHI_PLUGIN=NAME in an environ block; "" when absent or the name is not valid.
func parseTag(env []byte) string {
	for _, e := range strings.Split(string(env), "\x00") {
		if strings.HasPrefix(e, tagVar+"=") {
			if v := e[len(tagVar)+1:]; validName(v) {
				return v
			}
			return ""
		}
	}
	return ""
}

func readTag(root string, pid int) string {
	b, err := readBounded(root+"/proc/"+strconv.Itoa(pid)+"/environ", maxEnviron, readTimeout)
	if err != nil {
		return ""
	}
	return parseTag(b)
}
