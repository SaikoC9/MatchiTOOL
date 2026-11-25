package main

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"
)

func statLine(pid int, comm string, state string, ppid, pgid int, utime, stime, start uint64, rss int64) string {
	return fmt.Sprintf("%d (%s) %s %d %d %d 0 -1 4194304 0 0 0 0 %d %d 0 0 20 0 1 0 %d 1000 %d 0 0\n", pid, comm, state, ppid, pgid, pgid, utime, stime, start, rss)
}

func fakeProc(t *testing.T, root string, pid int, stat, environ string) {
	d := filepath.Join(root, "proc", strconv.Itoa(pid))
	os.MkdirAll(d, 0o755)
	os.WriteFile(d+"/stat", []byte(stat), 0o644)
	os.WriteFile(d+"/environ", []byte(environ), 0o644)
}

func TestParseStatOddName(t *testing.T) {
	p, ok := parseStat([]byte(statLine(1234, "my (weird) cmd", "S", 1, 1234, 5, 7, 99999, 250)))
	if !ok || p.PID != 1234 || p.Comm != "my (weird) cmd" || p.State != 'S' || p.PPID != 1 || p.PGID != 1234 || p.Ticks != 12 || p.Start != 99999 || p.RSSPages != 250 {
		t.Fatalf("bad parse: %+v ok=%v", p, ok)
	}
	for _, bad := range []string{"", "abc", "12 (x) S 1", "x (a) S 1 1 1 0 -1 0 0 0 0 0 1 1 0 0 20 0 1 0 5 1 1"} {
		if _, ok := parseStat([]byte(bad)); ok {
			t.Errorf("accepted %q", bad)
		}
	}
}

func TestParseTagAndName(t *testing.T) {
	if parseTag([]byte("A=1\x00MATCHI_PLUGIN=OpenWrt\x00B=2")) != "OpenWrt" {
		t.Error("tag not found")
	}
	if parseTag([]byte("XMATCHI_PLUGIN=a\x00")) != "" || parseTag([]byte("MATCHI_PLUGIN=a b\x00")) != "" || parseTag([]byte("MATCHI_PLUGIN=../x\x00")) != "" {
		t.Error("accepted a wrong tag")
	}
	if validName("") || validName(strings.Repeat("a", 41)) || !validName("AdGuard-Home_1.0") {
		t.Error("validName")
	}
}

// A read that never ends (like /proc/PID/cmdline on the MU300) must stop at the byte cap.
func TestReadCapStopsAtCap(t *testing.T) {
	b, err := readCap("/dev/zero", 1024)
	if err != nil || len(b) != 1024 {
		t.Fatalf("len=%d err=%v", len(b), err)
	}
}

// A read that never returns must stop at the deadline.
func TestReadBoundedDeadline(t *testing.T) {
	fifo := filepath.Join(t.TempDir(), "f")
	if err := syscall.Mkfifo(fifo, 0o600); err != nil {
		t.Skip("no fifo")
	}
	w, err := os.OpenFile(fifo, os.O_RDWR, 0) // keeps the pipe open and silent
	if err != nil {
		t.Fatal(err)
	}
	defer w.Close()
	t0 := time.Now()
	_, err = readBounded(fifo, 1024, 150*time.Millisecond)
	if err != errTimeout || time.Since(t0) > 2*time.Second {
		t.Fatalf("err=%v after %v", err, time.Since(t0))
	}
}

func TestBreach(t *testing.T) {
	l := limits{wall: 10 * time.Second, cpu: 5 * time.Second, memKB: 100 * 1024, procs: 3}
	cases := []struct {
		el time.Duration
		u  groupUse
		w  string
	}{
		{time.Second, groupUse{}, ""},
		{11 * time.Second, groupUse{}, "wall"},
		{time.Second, groupUse{cpu: 6 * time.Second}, "cpu"},
		{time.Second, groupUse{memKB: 101 * 1024}, "mem"},
		{time.Second, groupUse{procs: 4}, "procs"},
	}
	for _, c := range cases {
		if w, _, _ := breach(l, c.el, c.u); w != c.w {
			t.Errorf("%+v: got %q want %q", c, w, c.w)
		}
	}
	if w, _, _ := breach(limits{}, time.Hour, groupUse{cpu: time.Hour, memKB: 1 << 30, procs: 999}); w != "" {
		t.Error("zero means no limit")
	}
}

func TestKillSafety(t *testing.T) {
	cmd := exec.Command("sleep", "30")
	cmd.Start()
	defer func() { cmd.Process.Kill(); cmd.Wait() }()
	b, _ := readCap("/proc/"+strconv.Itoa(cmd.Process.Pid)+"/stat", maxStat)
	p, ok := parseStat(b)
	if !ok {
		t.Fatal("cannot read child")
	}
	if killIdentity("", cmd.Process.Pid, p.Start+1, syscall.SIGKILL) { // PID reused by someone else: wrong start time
		t.Fatal("killed a process with another start time")
	}
	if killIdentity("", 1, 0, syscall.SIGKILL) || killIdentity("", 2, 0, syscall.SIGKILL) || killIdentity("", os.Getpid(), 0, syscall.SIGKILL) {
		t.Fatal("signalled pid 1, 2 or self")
	}
	if !killIdentity("", cmd.Process.Pid, p.Start, syscall.SIGKILL) {
		t.Fatal("did not kill the right process")
	}
	cmd.Wait()
}

func TestRunWallLimitKillsGroup(t *testing.T) {
	superviseTick = 100 * time.Millisecond
	rc := cmdRun([]string{"--plugin", "T1", "--wall", "1", "--", "sh", "-c", "sleep 60 & sleep 60; wait"})
	if rc != 124 {
		t.Fatalf("exit %d, want 124", rc)
	}
}

func TestRunCPULimit(t *testing.T) {
	superviseTick = 100 * time.Millisecond
	t0 := time.Now()
	rc := cmdRun([]string{"--plugin", "T2", "--cpu", "1", "--", "sh", "-c", "while :; do :; done"})
	if rc != 124 || time.Since(t0) > 15*time.Second {
		t.Fatalf("exit %d after %v", rc, time.Since(t0))
	}
}

func TestRunExitCodeTagAndEnv(t *testing.T) {
	if rc := cmdRun([]string{"--plugin", "T3", "--", "sh", "-c", `[ "$MATCHI_PLUGIN" = T3 ] && exit 7`}); rc != 7 {
		t.Fatalf("exit %d, want 7 (tag set and exit code passed on)", rc)
	}
	t.Setenv("MATCHI_PLUGIN", "other")
	if rc := cmdRun([]string{"--plugin", "T4", "--", "sh", "-c", `[ "$MATCHI_PLUGIN" = T4 ]`}); rc != 0 {
		t.Fatal("an inherited tag must be replaced")
	}
	if cmdRun([]string{"--plugin", "bad name", "--", "true"}) != 2 || cmdRun([]string{"--plugin", "x"}) != 2 || cmdRun([]string{"--plugin", "x", "--", "/no/such"}) != 127 {
		t.Error("argument errors")
	}
}

func TestSizeDoesNotFollowOrCountTwice(t *testing.T) {
	d := t.TempDir()
	os.WriteFile(d+"/a", make([]byte, 64*1024), 0o644)
	os.Link(d+"/a", d+"/b") // same inode: counted once
	os.Symlink("/proc", d+"/link")
	kb, ok := dirSize(d, time.Now().Add(5*time.Second), 1000)
	if !ok || kb < 64 || kb > 200 {
		t.Fatalf("kb=%d ok=%v", kb, ok)
	}
	if _, ok := dirSize(d, time.Now().Add(-time.Second), 1); ok {
		t.Error("entry cap / deadline not reported as partial")
	}
}

func TestStuckHelper(t *testing.T) {
	tr := procInfo{PID: 9, Comm: "tr", State: 'R', Ticks: 100 * 40, Start: 100 * 100}
	if !stuckHelper(tr, 160, 20*time.Second) { // 60 s old, 40 s CPU
		t.Error("stuck tr not found")
	}
	if stuckHelper(tr, 105, 20*time.Second) { // 5 s old
		t.Error("young helper reaped")
	}
	tr.Ticks = 100
	if stuckHelper(tr, 160, 20*time.Second) { // old but idle
		t.Error("idle helper reaped")
	}
	if stuckHelper(procInfo{Comm: "sleep", Ticks: 99999, Start: 1}, 5000, time.Second) || stuckHelper(procInfo{Comm: "AdGuardHome", Ticks: 99999, Start: 1}, 5000, time.Second) {
		t.Error("only listed helpers may be reaped")
	}
}

func TestBudgets(t *testing.T) {
	m, err := parseBudgets("OpenWrt=60,Bypass=40.5")
	if err != nil || m["OpenWrt"] != 60 || m["Bypass"] != 40.5 {
		t.Fatal(m, err)
	}
	for _, bad := range []string{"x", "a=0", "a=b", "=5", "a b=5"} {
		if _, err := parseBudgets(bad); err == nil {
			t.Errorf("accepted %q", bad)
		}
	}
}

type calls struct {
	killed  []int
	reniced map[int]int
}

func hook(c *calls) func() {
	ok, or := killFn, reniceFn
	c.reniced = map[int]int{}
	killFn = func(root string, pid int, start uint64, sig syscall.Signal) bool {
		c.killed = append(c.killed, pid)
		return true
	}
	reniceFn = func(pid, n int) { c.reniced[pid] = n }
	return func() { killFn, reniceFn = ok, or }
}

func testCfg(root string, action string) cfg {
	cgr := filepath.Join(root, "cg")
	h := cgHost{cgr + "/cpu", cgr + "/mem", cgr + "/frz"}
	for _, d := range []string{h.cpu, h.mem, h.frz} {
		os.MkdirAll(d, 0o755)
	}
	return cfg{root: root, interval: 30 * time.Second, defBudget: 50, helperMax: 20 * time.Second, throttleAt: 2, escalateAt: 4, calmAt: 2,
		action: action, freezeRounds: 2, cg: h, cgOn: true, budgets: map[string]float64{}}
}

// Fake /proc: plugin "P" has a process using 100% of a core (3000 ticks per 30 s round); an untagged one does too and is ignored.
func TestWatchThrottleEscalateRelease(t *testing.T) {
	var c calls
	defer hook(&c)()
	root := t.TempDir()
	os.WriteFile(root+"/proc_uptime", nil, 0o644)
	os.MkdirAll(root+"/proc", 0o755)
	os.WriteFile(root+"/proc/uptime", []byte("1000.0 0\n"), 0o644)
	w := newWatcher(testCfg(root, "kill"))
	now := time.Unix(1000, 0)
	set := func(ticks uint64) {
		fakeProc(t, root, 500, statLine(500, "worker", "R", 1, 500, ticks, 0, 100, 1000), "A=b\x00MATCHI_PLUGIN=P\x00")
		fakeProc(t, root, 600, statLine(600, "other", "R", 1, 600, ticks, 0, 100, 1000), "A=b\x00")
	}
	step := func(ticks uint64) report {
		set(ticks)
		now = now.Add(30 * time.Second)
		return w.round(now)
	}
	r := step(0) // baseline round: no judgement
	if len(r.Plugins) != 1 || r.Plugins[0].CPU != 0 || r.Plugins[0].State != "ok" {
		t.Fatalf("baseline: %+v", r.Plugins)
	}
	r = step(3000)
	if r.Plugins[0].CPU != 100 || r.Plugins[0].Strikes != 1 || r.Plugins[0].State != "ok" {
		t.Fatalf("round 2: %+v", r.Plugins[0])
	}
	r = step(6000)
	if r.Plugins[0].State != "throttled" || c.reniced[500] != 19 {
		t.Fatalf("not throttled: %+v %v", r.Plugins[0], c.reniced)
	}
	if b, _ := os.ReadFile(w.c.cg.dir(w.c.cg.cpu, "P") + "/cpu.shares"); string(b) != "2" {
		t.Errorf("cpu.shares = %q", b)
	}
	if _, ok := c.reniced[600]; ok {
		t.Error("touched an untagged process")
	}
	step(9000)
	r = step(12000) // 4th strike: kill is allowed
	if r.Plugins[0].State != "killed" || len(c.killed) != 1 || c.killed[0] != 500 {
		t.Fatalf("kill: %+v %v", r.Plugins[0], c.killed)
	}
	// calm again
	step(12000)
	step(12000)
	r = step(12000)
	if r.Plugins[0].State != "ok" || r.Plugins[0].CPU != 0 {
		t.Fatalf("calm: %+v", r.Plugins[0])
	}
	if len(r.Actions) < 2 || r.Actions[0].What != "throttle" {
		t.Fatalf("actions: %+v", r.Actions)
	}
}

func TestWatchThrottleOnlyNeverKills(t *testing.T) {
	var c calls
	defer hook(&c)()
	root := t.TempDir()
	os.MkdirAll(root+"/proc", 0o755)
	os.WriteFile(root+"/proc/uptime", []byte("1000.0 0\n"), 0o644)
	w := newWatcher(testCfg(root, "throttle"))
	now := time.Unix(1000, 0)
	for i := 0; i < 10; i++ {
		fakeProc(t, root, 500, statLine(500, "worker", "R", 1, 500, uint64(i)*3000, 0, 100, 1000), "MATCHI_PLUGIN=P\x00")
		now = now.Add(30 * time.Second)
		w.round(now)
	}
	if len(c.killed) != 0 {
		t.Fatal("default action must never kill a plugin")
	}
}

func TestWatchFreezeThaw(t *testing.T) {
	var c calls
	defer hook(&c)()
	root := t.TempDir()
	os.MkdirAll(root+"/proc", 0o755)
	os.WriteFile(root+"/proc/uptime", []byte("1000.0 0\n"), 0o644)
	cf := testCfg(root, "freeze")
	os.MkdirAll(cf.cg.dir(cf.cg.frz, "P"), 0o755)
	w := newWatcher(cf)
	now := time.Unix(1000, 0)
	var last report
	for i := 0; i < 6; i++ {
		fakeProc(t, root, 500, statLine(500, "worker", "R", 1, 500, uint64(i)*3000, 0, 100, 1000), "MATCHI_PLUGIN=P\x00")
		now = now.Add(30 * time.Second)
		last = w.round(now)
	}
	if b, _ := os.ReadFile(cf.cg.dir(cf.cg.frz, "P") + "/freezer.state"); string(b) != "FROZEN" || last.Plugins[0].State != "frozen" {
		t.Fatalf("not frozen: state=%q %+v", b, last.Plugins[0])
	}
}

func TestWatchReapsStuckHelperOfPlugin(t *testing.T) {
	var c calls
	defer hook(&c)()
	root := t.TempDir()
	os.MkdirAll(root+"/proc", 0o755)
	os.WriteFile(root+"/proc/uptime", []byte("1000.0 0\n"), 0o644)
	// plugin script (tagged) -> stuck tr (untagged child, busy 80 s of 100 s) ; plus an unrelated stuck tr under init
	fakeProc(t, root, 700, statLine(700, "sh", "S", 1, 700, 1, 1, 90000, 100), "MATCHI_PLUGIN=AdGuard\x00")
	fakeProc(t, root, 701, statLine(701, "tr", "R", 700, 700, 8000, 0, 90000, 10), "")
	fakeProc(t, root, 800, statLine(800, "tr", "R", 1, 800, 8000, 0, 90000, 10), "")
	w := newWatcher(testCfg(root, "throttle"))
	r := w.round(time.Unix(2000, 0))
	if len(c.killed) != 1 || c.killed[0] != 701 || len(r.Actions) != 1 || r.Actions[0].What != "kill-helper" || r.Actions[0].Plugin != "AdGuard" {
		t.Fatalf("killed=%v actions=%+v", c.killed, r.Actions)
	}
}

func TestReportFileAtomicJSON(t *testing.T) {
	p := filepath.Join(t.TempDir(), "d", "report.json")
	if err := writeReport(p, report{V: 1, Plugins: []pluginRow{{Name: "P"}}}); err != nil {
		t.Fatal(err)
	}
	b, _ := os.ReadFile(p)
	var r report
	if json.Unmarshal(b, &r) != nil || r.V != 1 || r.Plugins[0].Name != "P" {
		t.Fatalf("bad report %s", b)
	}
	if _, err := os.Stat(p + ".tmp"); err == nil {
		t.Error("temp file left behind")
	}
}

func TestDispatch(t *testing.T) {
	if dispatch(nil) != 2 || dispatch([]string{"nope"}) != 2 || dispatch([]string{"version"}) != 0 {
		t.Error("dispatch")
	}
	if dispatch([]string{"watch", "--action", "explode"}) != 2 || dispatch([]string{"size"}) != 2 {
		t.Error("argument checks")
	}
}

// Boot case: a plugin process first seen with no tag (environ not ready yet) must show up once its tag can be read, without the guard
// being restarted. A process whose environ never carries a tag but whose parent does is counted for the parent's plugin.
func TestWatchTagSeenLaterAndInherited(t *testing.T) {
	var c calls
	defer hook(&c)()
	root := t.TempDir()
	os.MkdirAll(root+"/proc", 0o755)
	os.WriteFile(root+"/proc/uptime", []byte("1000.0 0\n"), 0o644)
	w := newWatcher(testCfg(root, "throttle"))
	fakeProc(t, root, 500, statLine(500, "AdGuardHome", "S", 1, 500, 1, 0, 99000, 1000), "A=b\x00") // young, no tag yet
	r := w.round(time.Unix(1000, 0))
	if len(r.Plugins) != 0 {
		t.Fatalf("no tag yet, expected no plugin rows: %+v", r.Plugins)
	}
	fakeProc(t, root, 500, statLine(500, "AdGuardHome", "S", 1, 500, 1, 0, 99000, 1000), "A=b\x00MATCHI_PLUGIN=AdGuard\x00")
	fakeProc(t, root, 501, statLine(501, "child", "S", 500, 500, 1, 0, 99500, 100), "") // environment cleared, parent is tagged
	r = w.round(time.Unix(1030, 0))
	if len(r.Plugins) != 1 || r.Plugins[0].Name != "AdGuard" || r.Plugins[0].Procs != 2 {
		t.Fatalf("expected AdGuard with 2 processes: %+v", r.Plugins)
	}
}

// An OLD process without a tag is asked again only every oldRetryGap sweeps (cost), but it is asked again.
func TestWatchOldUntaggedRetried(t *testing.T) {
	var c calls
	defer hook(&c)()
	root := t.TempDir()
	os.MkdirAll(root+"/proc", 0o755)
	os.WriteFile(root+"/proc/uptime", []byte("100000.0 0\n"), 0o644)
	w := newWatcher(testCfg(root, "throttle"))
	fakeProc(t, root, 500, statLine(500, "x", "S", 1, 500, 1, 0, 100, 1000), "")
	w.round(time.Unix(1000, 0))
	fakeProc(t, root, 500, statLine(500, "x", "S", 1, 500, 1, 0, 100, 1000), "MATCHI_PLUGIN=Late\x00")
	var r report
	for i := 1; i <= 11; i++ {
		r = w.round(time.Unix(1000+int64(30*i), 0))
	}
	if len(r.Plugins) != 1 || r.Plugins[0].Name != "Late" {
		t.Fatalf("old process never re-read: %+v", r.Plugins)
	}
}

// A busy process with no plugin tag is listed in "others" (top 5, 10 % of a core or more); a tagged one and an idle one are not.
func TestWatchOthersListsBusyUntagged(t *testing.T) {
	var c calls
	defer hook(&c)()
	root := t.TempDir()
	os.MkdirAll(root+"/proc", 0o755)
	os.WriteFile(root+"/proc/uptime", []byte("1000.0 0\n"), 0o644)
	w := newWatcher(testCfg(root, "throttle"))
	set := func(ticks uint64) {
		fakeProc(t, root, 900, statLine(900, "hog", "R", 1, 900, ticks, 0, 100, 1000), "A=b\x00")
		fakeProc(t, root, 901, statLine(901, "idle", "S", 1, 901, 1, 0, 100, 1000), "A=b\x00")
		fakeProc(t, root, 902, statLine(902, "plug", "R", 1, 902, ticks, 0, 100, 1000), "MATCHI_PLUGIN=P\x00")
	}
	set(0)
	w.round(time.Unix(1000, 0))
	set(1500) // 50 % of a core over 30 s
	r := w.round(time.Unix(1030, 0))
	if len(r.Others) != 1 || r.Others[0].PID != 900 || r.Others[0].Comm != "hog" || r.Others[0].CPU < 49 || r.Others[0].CPU > 51 {
		t.Fatalf("others=%+v", r.Others)
	}
}

func TestRoundsFor(t *testing.T) {
	for _, c := range [][4]int{{20, 1, 2, 20}, {20, 5, 2, 4}, {20, 10, 2, 2}, {20, 30, 2, 2}, {60, 1, 6, 60}, {60, 10, 6, 6}, {60, 30, 6, 6}} {
		if got := roundsFor(c[0], c[1], c[2]); got != c[3] {
			t.Errorf("roundsFor(%d,%d,%d)=%d want %d", c[0], c[1], c[2], got, c[3])
		}
	}
}

// Untagged runaway: a spinner that changes PID (and so "core") every sweep still adds up by name; a protected name is never killed.
func TestWatchRunawayKillsUntaggedByName(t *testing.T) {
	var c calls
	defer hook(&c)()
	root := t.TempDir()
	os.MkdirAll(root+"/proc", 0o755)
	os.WriteFile(root+"/proc/uptime", []byte("1000.0 0\n"), 0o644)
	cf := testCfg(root, "throttle")
	cf.runawayPct, cf.runawayAt, cf.protect = 90, 2, map[string]bool{}
	w := newWatcher(cf)
	set := func(ticks uint64) {
		fakeProc(t, root, 900, statLine(900, "spin", "R", 1, 900, ticks, 0, 100, 1000), "A=b\x00")
		fakeProc(t, root, 901, statLine(901, "system_server", "R", 1, 901, ticks, 0, 100, 1000), "A=b\x00")
		fakeProc(t, root, 902, statLine(902, "calm", "S", 1, 902, ticks/100, 0, 100, 1000), "A=b\x00")
	}
	set(0)
	w.round(time.Unix(1000, 0))
	set(3000) // 100 % of a core
	w.round(time.Unix(1030, 0))
	if len(c.killed) != 0 {
		t.Fatalf("killed after one sweep: %v", c.killed)
	}
	set(6000)
	r := w.round(time.Unix(1060, 0))
	if len(c.killed) != 1 || c.killed[0] != 900 {
		t.Fatalf("killed=%v actions=%+v", c.killed, r.Actions)
	}
}

func TestWatchRunawayOffByDefaultAndBurstsIgnored(t *testing.T) {
	var c calls
	defer hook(&c)()
	root := t.TempDir()
	os.MkdirAll(root+"/proc", 0o755)
	os.WriteFile(root+"/proc/uptime", []byte("1000.0 0\n"), 0o644)
	w := newWatcher(testCfg(root, "kill")) // runaway off
	for i := 0; i < 6; i++ {
		fakeProc(t, root, 900, statLine(900, "spin", "R", 1, 900, uint64(i)*3000, 0, 100, 1000), "A=b\x00")
		w.round(time.Unix(1000+int64(i)*30, 0))
	}
	if len(c.killed) != 0 {
		t.Fatal("runaway kill is off unless asked for")
	}
	cf := testCfg(root, "throttle")
	cf.runawayPct, cf.runawayAt = 90, 3
	w = newWatcher(cf)
	for i, tk := range []uint64{0, 3000, 3000, 6000, 6000, 9000} { // busy, idle, busy, idle, busy: never 3 in a row
		fakeProc(t, root, 900, statLine(900, "burst", "R", 1, 900, tk, 0, 100, 1000), "A=b\x00")
		w.round(time.Unix(2000+int64(i)*30, 0))
	}
	if len(c.killed) != 0 {
		t.Fatalf("burst killed: %v", c.killed)
	}
}
