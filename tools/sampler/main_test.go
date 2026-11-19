package main

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
)

// The values below were read on a ZTE F50 (MU300, Android 13) on 2026-11-19.
const f50Stat = `cpu  37669 2994 45288 4765435 3711 4216 5044 0 0 0
cpu0 5020 502 7838 589265 991 1797 1989 0 0 0
cpu1 4560 635 6065 593681 608 810 763 0 0 0
cpu2 4288 525 5126 595794 462 620 696 0 0 0
cpu3 4010 439 4532 597427 451 470 511 0 0 0
cpu4 4818 283 4871 597845 301 138 313 0 0 0
cpu5 4727 174 4857 598176 317 115 207 0 0 0
cpu6 4510 290 5021 598159 320 120 212 0 0 0
cpu7 5732 144 6974 595084 257 142 349 0 0 0
intr 1 2 3
`

// Core: online, current, max (kHz).
var f50Cores = [8][3]string{
	{"1", "614400", "2002000"}, {"1", "614400", "2002000"}, {"1", "614400", "2002000"}, {"1", "614400", "2002000"},
	{"1", "768000", "2301000"}, {"1", "1536000", "2301000"}, {"1", "1157000", "2301000"}, {"1", "1872000", "2210000"},
}

// Thermal zones in the order `ls` / a shell glob prints them. An empty temp stands for a zone whose temp file gives "Invalid argument".
var f50Zones = [][2]string{
	{"chg-thmzone", "53668"}, {"nr-thmzone", "51610"}, {"mid6-thmzone", "59291"}, {"apcpu0-thmzone", "57160"},
	{"lit0-thmzone", "57650"}, {"lit1-thmzone", "57860"}, {"lit2-thmzone", "56920"}, {"lit3-thmzone", "56660"},
	{"gpu-thmzone", "56690"}, {"apcpu1-thmzone", "57870"}, {"ai0-thmzone", "56628"}, {"ai1-thmzone", "56389"},
	{"pa-thmzone", "50478"}, {"mm-thmzone", "57345"}, {"lte-thmzone", "56878"}, {"nr0-thmzone", "56867"},
	{"nr1-thmzone", "56639"}, {"osctsen-thmzone", ""}, {"outtsen-thmzone", ""}, {"board-thmzone", "53256"},
	{"soc-thmzone", "59963"}, {"big7mid4-thmzone", "59981"}, {"big7-thmzone", "59963"}, {"mid5mid6-thmzone", "58326"},
	{"mid4-thmzone", "58812"}, {"mid5-thmzone", "58569"},
}

func write(t *testing.T, path, text string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(text), 0o644); err != nil {
		t.Fatal(err)
	}
}

// f50Tree writes the F50 files under a temporary root. The 26 zone directories are numbered so that their glob order is the list order.
func f50Tree(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	write(t, root+"/proc/stat", f50Stat)
	write(t, root+"/proc/loadavg", "8.28 8.21 8.22 1/1688 28567\n")
	write(t, root+"/proc/uptime", "6088.68 47726.09\n")
	write(t, root+"/proc/meminfo", "MemTotal:        1503044 kB\nMemFree:          144276 kB\nMemAvailable:     616768 kB\nBuffers: 1 kB\n")
	cpu := root + "/sys/devices/system/cpu"
	write(t, cpu+"/possible", "0-7\n")
	for n, c := range f50Cores {
		d := fmt.Sprintf("%s/cpu%d", cpu, n)
		write(t, d+"/online", c[0]+"\n")
		write(t, d+"/cpufreq/scaling_cur_freq", c[1]+"\n")
		write(t, d+"/cpufreq/cpuinfo_max_freq", c[2]+"\n")
	}
	// Directory names thermal_zone0..25 sorted as text give the order of the list above.
	names := make([]string, len(f50Zones))
	for i := range names {
		names[i] = fmt.Sprintf("thermal_zone%d", i)
	}
	sort.Strings(names)
	for i, z := range f50Zones {
		d := root + "/sys/class/thermal/" + names[i]
		write(t, d+"/type", z[0]+"\n")
		if z[1] == "" {
			if err := os.MkdirAll(d+"/temp", 0o755); err != nil { // reading a directory fails, like the F50's "Invalid argument"
				t.Fatal(err)
			}
		} else {
			write(t, d+"/temp", z[1]+"\n")
		}
	}
	return root
}

func TestF50Golden(t *testing.T) {
	root := f50Tree(t)
	want := "@L1|c:;cpu  37669 2994 45288 4765435 3711 4216 5044 0 0 0;cpu0 5020 502 7838 589265 991 1797 1989 0 0 0;" +
		"cpu1 4560 635 6065 593681 608 810 763 0 0 0;cpu2 4288 525 5126 595794 462 620 696 0 0 0;" +
		"cpu3 4010 439 4532 597427 451 470 511 0 0 0;cpu4 4818 283 4871 597845 301 138 313 0 0 0;" +
		"cpu5 4727 174 4857 598176 317 115 207 0 0 0;cpu6 4510 290 5021 598159 320 120 212 0 0 0;" +
		"cpu7 5732 144 6974 595084 257 142 349 0 0 0" +
		"|f:;0 1 614400 2002000;1 1 614400 2002000;2 1 614400 2002000;3 1 614400 2002000;" +
		"4 1 768000 2301000;5 1 1536000 2301000;6 1 1157000 2301000;7 1 1872000 2210000" +
		"|z:;chg-thmzone=53668;nr-thmzone=51610;mid6-thmzone=59291;apcpu0-thmzone=57160;lit0-thmzone=57650;lit1-thmzone=57860;" +
		"lit2-thmzone=56920;lit3-thmzone=56660;gpu-thmzone=56690;apcpu1-thmzone=57870;ai0-thmzone=56628;ai1-thmzone=56389;" +
		"pa-thmzone=50478;mm-thmzone=57345;lte-thmzone=56878;nr0-thmzone=56867" +
		"|s:8.28 8.21 8.22 6088.68 1503044 616768"
	if got := round(root, 0, 5); got != want {
		t.Errorf("round 0\n got: %s\nwant: %s", got, want)
	}
}

func TestSysOnlyEveryNthRound(t *testing.T) {
	root := f50Tree(t)
	for r, want := range []bool{true, false, false, false, false, true, false} {
		line := round(root, r, 5)
		if got := !strings.HasSuffix(line, "|s:"); got != want {
			t.Errorf("round %d: system part present = %v, want %v", r, got, want)
		}
	}
	if line := round(root, 0, 0); !strings.HasSuffix(line, "|s:") {
		t.Errorf("sys-every 0 must never read the system part: %s", line)
	}
}

func TestZoneRules(t *testing.T) {
	root := f50Tree(t)
	z := zones(root)
	if n := strings.Count(z, ";"); n != maxZones {
		t.Errorf("zones kept = %d, want %d", n, maxZones)
	}
	for _, bad := range []string{"nr1-thmzone", "osctsen", "outtsen", "board-thmzone"} {
		if strings.Contains(z, bad) {
			t.Errorf("%s must not be in the first 16 readable zones: %s", bad, z)
		}
	}
	// A name with a character the page would not accept becomes zone<N>, N = zones kept so far.
	r2 := t.TempDir()
	write(t, r2+"/sys/class/thermal/thermal_zone0/type", "soc-thermal\n")
	write(t, r2+"/sys/class/thermal/thermal_zone0/temp", "45000\n")
	write(t, r2+"/sys/class/thermal/thermal_zone1/type", "bad name;x\n")
	write(t, r2+"/sys/class/thermal/thermal_zone1/temp", "46000\n")
	write(t, r2+"/sys/class/thermal/thermal_zone2/temp", "47000\n") // no type file
	if got, want := zones(r2), ";soc-thermal=45000;zone1=46000;zone2=47000"; got != want {
		t.Errorf("zones = %q, want %q", got, want)
	}
}

func TestLastCore(t *testing.T) {
	for _, c := range []struct{ possible, want string }{
		{"0-7", "7"}, {"0-3", "3"}, {"0,2-5", "5"}, {"0", "0"}, {"0-99", "15"}, {"x", "7"}, {"", "7"}, {"0-", "7"},
	} {
		root := t.TempDir()
		write(t, root+"/sys/devices/system/cpu/possible", c.possible+"\n")
		if got := fmt.Sprint(lastCore(root)); got != c.want {
			t.Errorf("possible=%q: last core %s, want %s", c.possible, got, c.want)
		}
	}
	if got := lastCore(t.TempDir()); got != 7 {
		t.Errorf("no possible file: last core %d, want 7", got)
	}
}

func TestMissingAndOfflineCores(t *testing.T) {
	root := t.TempDir()
	cpu := root + "/sys/devices/system/cpu"
	write(t, cpu+"/possible", "0-2\n")
	write(t, cpu+"/cpu0/cpufreq/cpuinfo_max_freq", "2000000\n") // no online file: counts as online; no current speed file: 0
	write(t, cpu+"/cpu1/online", "0\n")                         // offline: the current speed is not read
	write(t, cpu+"/cpu1/cpufreq/scaling_cur_freq", "999\n")
	write(t, cpu+"/cpu1/cpufreq/cpuinfo_max_freq", "2000000\n")
	// cpu2 does not exist
	if got, want := coreSpeeds(root, 2), ";0 1 0 2000000;1 0 0 2000000;2 0 0 0"; got != want {
		t.Errorf("cores = %q, want %q", got, want)
	}
}

func TestMissingFilesGiveEmptyParts(t *testing.T) {
	line := round(t.TempDir(), 0, 5)
	if !strings.HasPrefix(line, "@L1|c:|f:;0 0 0 0;1 0 0 0;") || !strings.Contains(line, "|z:|s:  ") {
		t.Errorf("unexpected line for an empty root: %s", line)
	}
}
