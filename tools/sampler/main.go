// matchi-sampler: prints one line per second with CPU, core speed, temperatures, load, uptime and memory, for the Live panel.
//
//	matchi-sampler [-rounds 3600] [-sleep 1] [-sys-every 5]
//
// It does what the shell loop in LiveSampler.kt (LiveScript.body) does, with the same reads in the same order, and prints the
// same line, so the Kotlin parser does not change:
//
//	@L1|c:;cpu 1 2 3 4 5 6 7 8;cpu0 ...|f:;0 1 936000 1800000;1 0 0 1800000|z:;soc-thmzone=45000;mdm-q6=51000|s:0.1 0.2 0.3 100.5 4000000 2000000
//
// Sections are separated by "|", entries by ";" (a leading ";" is normal). "s:" is empty on rounds that skip it. The differences
// from the shell loop are only that it starts no process per round (no sleep, read or echo children) and keeps no state between
// rounds. The rules that look odd are the shell's, copied on purpose so both give the same line on the same device:
//   - at most 16 thermal zones, in the order of the shell glob (thermal_zone0, thermal_zone1, thermal_zone10, ...);
//   - a zone whose temp cannot be read is skipped (the F50 has two such zones) and does not count toward the 16;
//   - a zone type that is empty or has a character outside [A-Za-z0-9_.-] is called zone<N>, N counting the zones kept so far;
//   - the highest core number comes from cpu/possible (the text after the last "-" or ","), 7 when unreadable, at most 15.
//
// When the reader of its output goes away, the next write fails and it exits, so it never keeps running without the app.
// Source is in this repository, stdlib only, built by .github/workflows/build-sampler.yml.
package main

import (
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
)

const version = "matchi-sampler 1.0 (MatchiTOOL)"

const (
	tag       = "@L1"
	maxZones  = 16
	maxCore   = 15
	defaultMx = 7
)

var zoneName = regexp.MustCompile(`^[A-Za-z0-9_.-]+$`)

// firstLine returns the first line of a file with surrounding blanks removed, like the shell's `read x < file`.
// ok is false when the file cannot be read or is empty.
func firstLine(path string) (string, bool) {
	b, err := os.ReadFile(path)
	if err != nil || len(b) == 0 {
		return "", false
	}
	s := string(b)
	if i := strings.IndexByte(s, '\n'); i >= 0 {
		s = s[:i]
	}
	return strings.TrimSpace(s), true
}

// lastCore is the highest core number to look at.
func lastCore(root string) int {
	p := "7"
	if v, ok := firstLine(root + "/sys/devices/system/cpu/possible"); ok {
		p = v
	}
	if i := strings.LastIndexAny(p, "-,"); i >= 0 {
		p = p[i+1:]
	}
	n, err := strconv.Atoi(p)
	if err != nil || p == "" || strings.Trim(p, "0123456789") != "" {
		return defaultMx
	}
	if n > maxCore {
		return maxCore
	}
	return n
}

// cpuRows is "c:": the "cpu" rows at the top of /proc/stat, each behind a ";". Reading stops at the first row that is not a cpu row.
func cpuRows(root string) string {
	b, err := os.ReadFile(root + "/proc/stat")
	if err != nil {
		return ""
	}
	var sb strings.Builder
	for _, l := range strings.Split(string(b), "\n") {
		l = strings.TrimSpace(l)
		if !strings.HasPrefix(l, "cpu") {
			break
		}
		sb.WriteString(";" + l)
	}
	return sb.String()
}

// coreSpeeds is "f:": one entry per core, "id online current-kHz max-kHz".
func coreSpeeds(root string, mx int) string {
	cpu := root + "/sys/devices/system/cpu"
	var sb strings.Builder
	for n := 0; n <= mx; n++ {
		d := fmt.Sprintf("%s/cpu%d", cpu, n)
		online, cur, max := "1", "", ""
		if st, err := os.Stat(d); err != nil || !st.IsDir() {
			online = "0"
		} else {
			if v, ok := firstLine(d + "/online"); ok {
				online = v
			}
			if v, ok := firstLine(d + "/cpufreq/cpuinfo_max_freq"); ok {
				max = v
			}
			if online == "1" {
				if v, ok := firstLine(d + "/cpufreq/scaling_cur_freq"); ok {
					cur = v
				}
			}
		}
		if cur == "" {
			cur = "0"
		}
		if max == "" {
			max = "0"
		}
		fmt.Fprintf(&sb, ";%d %s %s %s", n, online, cur, max)
	}
	return sb.String()
}

// zones is "z:": "name=milli-degrees" for up to 16 readable thermal zones.
func zones(root string) string {
	paths, _ := filepath.Glob(root + "/sys/class/thermal/thermal_zone*")
	var sb strings.Builder
	kept := 0
	for _, t := range paths {
		if kept >= maxZones {
			break
		}
		v, ok := firstLine(t + "/temp")
		if !ok {
			continue
		}
		k, _ := firstLine(t + "/type")
		if !zoneName.MatchString(k) {
			k = fmt.Sprintf("zone%d", kept)
		}
		fmt.Fprintf(&sb, ";%s=%s", k, v)
		kept++
	}
	return sb.String()
}

// system is "s:": load 1/5/15, uptime seconds, MemTotal and MemAvailable in kB.
func system(root string) string {
	var a, b, e, u string
	if s, ok := firstLine(root + "/proc/loadavg"); ok {
		f := strings.Fields(s)
		if len(f) > 0 {
			a = f[0]
		}
		if len(f) > 1 {
			b = f[1]
		}
		if len(f) > 2 {
			e = f[2]
		}
	}
	if s, ok := firstLine(root + "/proc/uptime"); ok {
		if f := strings.Fields(s); len(f) > 0 {
			u = f[0]
		}
	}
	mt, ma := "0", "0"
	if m, err := os.ReadFile(root + "/proc/meminfo"); err == nil {
		for _, l := range strings.Split(string(m), "\n") {
			f := strings.Fields(l)
			if len(f) < 2 {
				continue
			}
			if f[0] == "MemTotal:" {
				mt = f[1]
			} else if f[0] == "MemAvailable:" {
				ma = f[1]
				break
			}
		}
	}
	return a + " " + b + " " + e + " " + u + " " + mt + " " + ma
}

// round builds the line for round r (counting from 0). The "s:" part is read on every sysEvery-th round only.
func round(root string, r, sysEvery int) string {
	s := ""
	if sysEvery > 0 && r%sysEvery == 0 {
		s = system(root)
	}
	return tag + "|c:" + cpuRows(root) + "|f:" + coreSpeeds(root, lastCore(root)) + "|z:" + zones(root) + "|s:" + s
}

// run prints up to rounds lines, one every sleep, and stops when a write fails.
func run(out *os.File, root string, rounds, sysEvery int, sleep time.Duration) {
	for r := 0; r < rounds; r++ {
		if _, err := out.WriteString(round(root, r, sysEvery) + "\n"); err != nil {
			return
		}
		time.Sleep(sleep)
	}
}

func main() {
	rounds := flag.Int("rounds", 3600, "number of lines to print, then exit (the app starts a new reader)")
	sleep := flag.Int("sleep", 1, "seconds between lines")
	every := flag.Int("sys-every", 5, "read load, uptime and memory on every Nth line (0 = never)")
	root := flag.String("root", "", "prefix for /proc and /sys (tests only)")
	ver := flag.Bool("version", false, "print the version and exit")
	flag.Parse()
	if *ver {
		fmt.Println(version)
		return
	}
	if *rounds < 1 || *sleep < 0 || *every < 0 {
		fmt.Fprintln(os.Stderr, "matchi-sampler: -rounds must be at least 1, -sleep and -sys-every not negative")
		os.Exit(1)
	}
	run(os.Stdout, *root, *rounds, *every, time.Duration(*sleep)*time.Second)
}
