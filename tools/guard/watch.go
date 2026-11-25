package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
)

// Helpers that are disposable: a plugin script starts them for one short job. One that has run longer than helper-max and used a
// quarter of that time as CPU is stuck (the `tr` on /proc/PID/cmdline). `sleep` is not in the list: it uses no CPU.
var helpers = map[string]bool{"tr": true, "du": true, "grep": true, "cat": true, "awk": true, "cut": true, "find": true}

type cfg struct {
	root         string
	interval     time.Duration
	rounds       int
	report       string
	budgets      map[string]float64 // percent of ONE core (800 = all 8 cores)
	defBudget    float64
	helperMax    time.Duration
	throttleAt   int    // consecutive rounds over budget before throttling
	escalateAt   int    // consecutive rounds over budget before freeze/kill
	calmAt       int    // consecutive rounds under budget before release
	action       string // throttle | freeze | kill  (the strongest action allowed)
	freezeRounds int
	runawayPct   float64         // untagged processes: percent of ONE core (summed per program name) that counts as runaway, 0 = off
	runawayAt    int             // consecutive sweeps at or over runawayPct before the process is killed
	protect      map[string]bool // exact program names that are never killed as runaway
	cg           cgHost
	cgOn         bool
}

type key struct {
	pid   int
	start uint64
}

type plugState struct {
	strikes, calm, frozenFor int
	state                    string
	touched                  map[key]bool
}

type action struct {
	TS     int64  `json:"ts"`
	What   string `json:"what"`
	Plugin string `json:"plugin,omitempty"`
	PID    int    `json:"pid,omitempty"`
	Comm   string `json:"comm,omitempty"`
	Why    string `json:"why"`
}

// otherRow is a busy process that carries no plugin tag. othersMin is the share of one core that makes it worth listing.
type otherRow struct {
	PID   int     `json:"pid"`
	Comm  string  `json:"comm"`
	CPU   float64 `json:"cpu_pct"`
	RSSKB int64   `json:"rss_kb"`
}

const (
	othersMinPct = 10.0
	othersMax    = 5
)

type pluginRow struct {
	Name    string  `json:"name"`
	CPU     float64 `json:"cpu_pct"`
	Budget  float64 `json:"budget_pct"`
	RSSKB   int64   `json:"rss_kb"`
	Procs   int     `json:"procs"`
	State   string  `json:"state"`
	Strikes int     `json:"strikes"`
}

// report is the JSON the host and the web panel read (v1).
type report struct {
	V        int         `json:"v"`
	TS       int64       `json:"ts"`
	Interval int         `json:"interval_s"`
	Round    int         `json:"round"`
	Cost     int64       `json:"scan_ms"`
	Procs    int         `json:"procs_seen"`
	Plugins  []pluginRow `json:"plugins"`
	Others   []otherRow  `json:"others"`
	Actions  []action    `json:"actions"`
}

type watcher struct {
	c       cfg
	prev    map[key]uint64
	tags    map[key]string  // tag of every process seen in the last sweep (own tag, or the one inherited from a tagged ancestor)
	own     map[key]tagMemo // what reading the environ of a process gave; see tagFor
	plugins map[string]*plugState
	runaway map[string]int // consecutive sweeps each untagged program name has been over the runaway limit
	actions []action
	last    time.Time
	now     time.Time // start of the sweep in progress
	n       int
}

func newWatcher(c cfg) *watcher {
	return &watcher{c: c, prev: map[key]uint64{}, tags: map[key]string{}, own: map[key]tagMemo{}, plugins: map[string]*plugState{}, runaway: map[string]int{}}
}

func (w *watcher) act(what, plugin string, p *procInfo, why string) {
	a := action{TS: time.Now().Unix(), What: what, Plugin: plugin, Why: why}
	if p != nil {
		a.PID, a.Comm = p.PID, p.Comm
	}
	w.actions = append(w.actions, a)
	if len(w.actions) > 20 {
		w.actions = w.actions[len(w.actions)-20:]
	}
}

type usage struct {
	ticks uint64
	rss   int64
	procs []procInfo
}

// tagMemo is what the last read of one process's environ gave. A found tag never changes and is kept. "No tag" is NOT final: at boot
// a process can be seen before its environment is complete (between fork and exec), or the read can time out while the phone is busy
// starting everything. Remembering that forever left plugins started by boot.sh invisible until the guard was switched off and on
// (which emptied the memory). So an empty answer is asked again: every sweep while the process is young, every 10th sweep later.
type tagMemo struct {
	tag string
	at  time.Time
}

// Time based, so the cost does not grow when the sweep is every second: a process younger than youngSecs is asked again after youngRetry
// (or at the next sweep when sweeps are further apart), an older one without a tag after oldRetrySecs.
const (
	youngSecs    = 300
	youngRetry   = 5 * time.Second
	oldRetrySecs = 300 * time.Second
)

func (w *watcher) tagFor(k key, p *procInfo, up float64) tagMemo {
	if m, ok := w.own[k]; ok {
		if m.tag != "" {
			return m
		}
		gap := oldRetrySecs
		if up-float64(p.Start)/clkTck < youngSecs {
			gap = youngRetry
		}
		if w.now.Sub(m.at) < gap-time.Second/2 {
			return m
		}
	}
	return tagMemo{tag: readTag(w.c.root, p.PID), at: w.now}
}

func (w *watcher) budget(name string) float64 {
	if b, ok := w.c.budgets[name]; ok {
		return b
	}
	return w.c.defBudget
}

func (w *watcher) round(now time.Time) report {
	t0 := time.Now()
	procs := scanProcs(w.c.root)
	up := readUptime(w.c.root)
	w.n++
	w.now = now
	baseline := w.last.IsZero()
	secs := now.Sub(w.last).Seconds()
	me := selfPID()

	cur := map[key]uint64{}
	tags := map[key]string{}
	own := map[key]tagMemo{}
	byPID := map[int]*procInfo{}
	for i := range procs {
		p := &procs[i]
		byPID[p.PID] = p
		if p.PID <= 2 || p.PPID == 2 || p.PID == me {
			continue
		}
		k := key{p.PID, p.Start}
		m := w.tagFor(k, p, up)
		own[k] = m
		tags[k] = m.tag
		cur[k] = p.Ticks
	}
	w.own = own
	// A process that carries no tag of its own (its environment was cleared, e.g. by su or env -i) still belongs to the plugin whose
	// tagged process started it. Parents are looked up through the pid table, up to 6 steps.
	for i := range procs {
		p := &procs[i]
		k := key{p.PID, p.Start}
		if _, ok := cur[k]; !ok || tags[k] != "" {
			continue
		}
		q := byPID[p.PPID]
		for d := 0; d < 6 && q != nil && q.PID > 2; d++ {
			if t := tags[key{q.PID, q.Start}]; t != "" {
				tags[k] = t
				break
			}
			q = byPID[q.PPID]
		}
	}
	w.tags = tags
	agg := map[string]*usage{}
	busy := []otherRow{}
	free := []freeProc{}
	for i := range procs {
		p := &procs[i]
		k := key{p.PID, p.Start}
		tag := tags[k]
		if _, ok := cur[k]; !ok {
			continue
		}
		if tag == "" {
			// Not a plugin process (or one the guard cannot attribute): still reported when it is busy, so nothing can hide from the table.
			if pv, seen := w.prev[k]; seen && !baseline && secs > 0 && p.Ticks >= pv {
				pct := float64(p.Ticks-pv) / (secs * clkTck) * 100
				free = append(free, freeProc{*p, pct})
				if pct >= othersMinPct {
					busy = append(busy, otherRow{p.PID, p.Comm, round1(pct), p.RSSPages * int64(os.Getpagesize()) / 1024})
				}
			}
			continue
		}
		u := agg[tag]
		if u == nil {
			u = &usage{}
			agg[tag] = u
		}
		d := p.Ticks
		if pv, seen := w.prev[k]; seen && p.Ticks >= pv {
			d = p.Ticks - pv
		}
		u.ticks += d
		u.rss += p.RSSPages * int64(os.Getpagesize()) / 1024
		u.procs = append(u.procs, *p)
	}
	w.prev = cur

	// 1. stuck helpers that belong to a plugin (tagged, or a parent within 6 steps is tagged)
	for i := range procs {
		p := &procs[i]
		if !stuckHelper(*p, up, w.c.helperMax) || !w.owned(p, byPID, 6) {
			continue
		}
		name := w.ownerName(p, byPID)
		if killFn(w.c.root, p.PID, p.Start, 9) {
			w.act("kill-helper", name, p, fmt.Sprintf("%s ran %ds at %d%% CPU", p.Comm, int(up-float64(p.Start)/clkTck), int(100*float64(p.Ticks)/clkTck/(up-float64(p.Start)/clkTck))))
		}
	}

	// 1b. runaway programs that carry no plugin tag
	w.judgeRunaway(free)

	// 2. per-plugin budget
	rows := []pluginRow{}
	names := make([]string, 0, len(agg))
	for n := range agg {
		names = append(names, n)
	}
	for n, ps := range w.plugins { // a plugin that went quiet is still handled (thaw, release)
		if _, ok := agg[n]; !ok && ps.state != "ok" {
			names = append(names, n)
		}
	}
	sort.Strings(names)
	for _, name := range names {
		u := agg[name]
		if u == nil {
			u = &usage{}
		}
		ps := w.plugins[name]
		if ps == nil {
			ps = &plugState{state: "ok", touched: map[key]bool{}}
			w.plugins[name] = ps
		}
		pct := 0.0
		if !baseline && secs > 0 {
			pct = float64(u.ticks) / (secs * clkTck) * 100
		}
		w.judge(name, ps, u, pct)
		rows = append(rows, pluginRow{name, round1(pct), w.budget(name), u.rss, len(u.procs), ps.state, ps.strikes})
	}
	sort.Slice(busy, func(i, j int) bool { return busy[i].CPU > busy[j].CPU })
	if len(busy) > othersMax {
		busy = busy[:othersMax]
	}
	w.last = now
	return report{V: 1, TS: now.Unix(), Interval: int(w.c.interval / time.Second), Round: w.n, Cost: time.Since(t0).Milliseconds(),
		Procs: len(procs), Plugins: rows, Others: busy, Actions: append([]action{}, w.actions...)}
}

// freeProc is an untagged process and the share of one core it used since the last sweep.
type freeProc struct {
	p   procInfo
	pct float64
}

// Programs (and name prefixes) that are never killed as runaway: the system, the radio, the network, root itself and MatchiTOOL.
var protectedNames = map[string]bool{
	"init": true, "zygote": true, "zygote64": true, "system_server": true, "surfaceflinger": true, "servicemanager": true,
	"hwservicemanager": true, "vndservicemanager": true, "vold": true, "netd": true, "adbd": true, "logd": true, "ueventd": true,
	"lmkd": true, "rild": true, "qmuxd": true, "netmgrd": true, "wpa_supplicant": true, "hostapd": true, "dnsmasq": true,
	"su": true, "magiskd": true, "magisk": true, "ksud": true, "matchi-guard": true, "com.matchi.tool": true, "installd": true,
	"keystore": true, "keystore2": true, "healthd": true, "thermal-engine": true, "thermald": true, "tombstoned": true, "statsd": true,
}
var protectedPrefixes = []string{"android.", "vendor.", "com.android.", "com.matchi", "qti", "qcom", "mdm", "ims", "kworker", "ksoftirqd"}

func protectedName(c cfg, comm string) bool {
	if protectedNames[comm] || c.protect[comm] {
		return true
	}
	for _, pre := range protectedPrefixes {
		if strings.HasPrefix(comm, pre) {
			return true
		}
	}
	return false
}

// judgeRunaway kills a program that keeps the CPU busy without belonging to a plugin: the share of ONE core is summed over every
// process with the same name, so a spinner that moves to another core, forks, or comes back under a new PID still adds up. It must be
// at or over the limit for runawayAt sweeps in a row. Only the members that use 10 % or more are killed, one by one (PID + start time).
func (w *watcher) judgeRunaway(free []freeProc) {
	if w.c.runawayPct <= 0 {
		return
	}
	sum := map[string]float64{}
	for _, f := range free {
		sum[f.p.Comm] += f.pct
	}
	for comm := range w.runaway {
		if sum[comm] < w.c.runawayPct {
			delete(w.runaway, comm)
		}
	}
	for comm, pct := range sum {
		if pct < w.c.runawayPct || protectedName(w.c, comm) {
			continue
		}
		w.runaway[comm]++
		if w.runaway[comm] < w.c.runawayAt {
			continue
		}
		for i := range free {
			f := &free[i]
			if f.p.Comm != comm || f.pct < othersMinPct {
				continue
			}
			if killFn(w.c.root, f.p.PID, f.p.Start, 9) {
				w.act("kill-runaway", "", &f.p, fmt.Sprintf("%s used %d%% of a core for %d sweeps", comm, int(pct), w.runaway[comm]))
			}
		}
		delete(w.runaway, comm)
	}
}

func round1(f float64) float64 { return float64(int(f*10+0.5)) / 10 }

func stuckHelper(p procInfo, up float64, max time.Duration) bool {
	if !helpers[p.Comm] || p.State == 'Z' {
		return false
	}
	age := up - float64(p.Start)/clkTck
	return age >= max.Seconds() && age > 0 && float64(p.Ticks)/clkTck >= 0.25*age
}

func (w *watcher) ownerName(p *procInfo, byPID map[int]*procInfo) string {
	for i := 0; i < 7 && p != nil; i++ {
		if t := w.tags[key{p.PID, p.Start}]; t != "" {
			return t
		}
		p = byPID[p.PPID]
	}
	return ""
}

func (w *watcher) owned(p *procInfo, byPID map[int]*procInfo, depth int) bool {
	_ = depth
	return w.ownerName(p, byPID) != ""
}

func (w *watcher) judge(name string, ps *plugState, u *usage, pct float64) {
	over := pct > w.budget(name)
	if over {
		ps.strikes++
		ps.calm = 0
	} else {
		ps.strikes = 0
		ps.calm++
	}
	switch ps.state {
	case "frozen":
		ps.frozenFor++
		if ps.frozenFor >= w.c.freezeRounds {
			if w.c.cgOn {
				w.c.cg.freeze(name, false)
			}
			ps.state, ps.strikes, ps.frozenFor = "throttled", 0, 0
			w.act("thaw", name, nil, "freeze time over")
		}
		return
	case "ok", "killed":
		ps.state = "ok"
		if ps.strikes >= w.c.throttleAt {
			ps.state = "throttled"
			w.throttle(name, ps, u, fmt.Sprintf("%d%% CPU, budget %d%% for %d rounds", int(pct), int(w.budget(name)), ps.strikes))
		}
	case "throttled":
		w.throttle(name, ps, u, "") // new processes of a throttled plugin get the same treatment
		if ps.calm >= w.c.calmAt {
			w.release(name, ps, u)
			return
		}
		if over && ps.strikes >= w.c.escalateAt {
			w.escalate(name, ps, u, pct)
		}
	}
}

func (w *watcher) throttle(name string, ps *plugState, u *usage, why string) {
	first := why != ""
	for i := range u.procs {
		p := &u.procs[i]
		k := key{p.PID, p.Start}
		if ps.touched[k] {
			continue
		}
		reniceFn(p.PID, 19)
		if w.c.cgOn {
			w.c.cg.join(w.c.cg.cpu, name, p.PID)
		}
		ps.touched[k] = true
	}
	if first {
		if w.c.cgOn {
			w.c.cg.setShares(name, 2)
		}
		w.act("throttle", name, nil, why)
	}
}

func (w *watcher) release(name string, ps *plugState, u *usage) {
	for i := range u.procs {
		p := &u.procs[i]
		if ps.touched[key{p.PID, p.Start}] {
			reniceFn(p.PID, 0)
		}
	}
	if w.c.cgOn {
		w.c.cg.setShares(name, 1024)
	}
	ps.touched, ps.state, ps.strikes = map[key]bool{}, "ok", 0
	w.act("release", name, nil, "back under budget")
}

func (w *watcher) escalate(name string, ps *plugState, u *usage, pct float64) {
	why := fmt.Sprintf("still %d%% CPU after throttle", int(pct))
	switch w.c.action {
	case "freeze":
		if !w.c.cgOn {
			return
		}
		for i := range u.procs {
			w.c.cg.join(w.c.cg.frz, name, u.procs[i].PID)
		}
		if w.c.cg.freeze(name, true) == nil {
			ps.state, ps.frozenFor = "frozen", 0
			w.act("freeze", name, nil, why)
		}
	case "kill":
		for i := range u.procs {
			p := &u.procs[i]
			if killFn(w.c.root, p.PID, p.Start, 9) {
				w.act("kill", name, p, why)
			}
		}
		ps.state, ps.strikes = "killed", 0
	}
}

func writeReport(path string, r report) error {
	b, _ := json.Marshal(r)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, append(b, '\n'), 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

func parseBudgets(s string) (map[string]float64, error) {
	m := map[string]float64{}
	if s == "" {
		return m, nil
	}
	for _, kv := range strings.Split(s, ",") {
		i := strings.IndexByte(kv, '=')
		if i < 1 || !validName(kv[:i]) {
			return nil, fmt.Errorf("bad budget %q (want NAME=PERCENT)", kv)
		}
		v, err := strconv.ParseFloat(kv[i+1:], 64)
		if err != nil || v <= 0 {
			return nil, fmt.Errorf("bad budget %q (want NAME=PERCENT)", kv)
		}
		m[kv[:i]] = v
	}
	return m, nil
}

func parseProtect(s string) map[string]bool {
	m := map[string]bool{}
	for _, n := range strings.Split(s, ",") {
		if n = strings.TrimSpace(n); n != "" {
			m[n] = true
		}
	}
	return m
}

func cmdWatch(args []string) int {
	fs := flag.NewFlagSet("watch", flag.ContinueOnError)
	every := fs.Int("interval", 30, "seconds between rounds")
	rounds := fs.Int("rounds", 0, "stop after N rounds, 0 = run until stopped")
	rep := fs.String("report", "/data/local/tmp/matchi-guard/report.json", "report file (JSON, replaced every round)")
	budgets := fs.String("budget", "", "NAME=PERCENT,... CPU budget per plugin, percent of one core")
	def := fs.Float64("default-budget", 80, "budget for plugins not listed, percent of one core")
	hmax := fs.Int("helper-max", 20, "seconds before a busy helper (tr du grep cat awk cut find) of a plugin counts as stuck")
	act := fs.String("action", "throttle", "strongest action: throttle | freeze | kill")
	noCg := fs.Bool("no-cgroup", false, "use nice only, no cgroups")
	killAfter := fs.Int("kill-after", 60, "seconds a plugin must stay over budget before freeze/kill (with --action freeze|kill)")
	runPct := fs.Float64("runaway", 0, "kill an untagged program that uses this percent of ONE core (summed per program name) for --runaway-secs, 0 = off")
	runSecs := fs.Int("runaway-secs", 30, "seconds a program must stay over --runaway before it is killed")
	protect := fs.String("protect", "", "NAME,... extra program names that --runaway never kills")
	if fs.Parse(args) != nil || fs.NArg() != 0 || (*act != "throttle" && *act != "freeze" && *act != "kill") || *every < 1 || *def <= 0 || *killAfter < 1 || *runPct < 0 || *runSecs < 1 {
		fmt.Fprintln(os.Stderr, "usage: matchi-guard watch [--interval S] [--rounds N] [--report FILE] [--budget NAME=PCT,...] [--default-budget PCT] [--helper-max S] [--action throttle|freeze|kill] [--kill-after S] [--runaway PCT] [--runaway-secs S] [--protect NAME,...] [--no-cgroup]")
		return 2
	}
	b, err := parseBudgets(*budgets)
	if err != nil {
		fmt.Fprintln(os.Stderr, "matchi-guard:", err)
		return 2
	}
	w := newWatcher(cfg{interval: time.Duration(*every) * time.Second, budgets: b, defBudget: *def, helperMax: time.Duration(*hmax) * time.Second,
		throttleAt: roundsFor(20, *every, 2), escalateAt: roundsFor(*killAfter, *every, 3), calmAt: roundsFor(20, *every, 2), action: *act, freezeRounds: 2, runawayPct: *runPct, runawayAt: roundsFor(*runSecs, *every, 2), protect: parseProtect(*protect), cg: defaultCg(), cgOn: !*noCg})
	reniceFn(0, 10) // the guard itself must be cheap
	for i := 0; *rounds == 0 || i < *rounds; i++ {
		if i > 0 {
			time.Sleep(w.c.interval)
		}
		r := w.round(time.Now())
		if err := writeReport(*rep, r); err != nil {
			fmt.Fprintln(os.Stderr, "matchi-guard: report:", err)
		}
	}
	return 0
}

// roundsFor turns a wait in seconds into a number of sweeps (never fewer than min): at a 1 s sweep a 2-second burst must not count as
// "over budget for 2 rounds", so the limits stay about the same in real time (20 s to slow a plugin, 60 s to escalate, 20 s to release).
func roundsFor(secs, interval, min int) int {
	n := (secs + interval - 1) / interval
	if n < min {
		return min
	}
	return n
}
